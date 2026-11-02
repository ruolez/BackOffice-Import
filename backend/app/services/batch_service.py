"""Monthly batch runs: saved rules turn each sales report file into invoices,
invoice copies and purchase orders across databases in one go."""

import json
import logging
import traceback
from datetime import datetime
from typing import Any, Callable, Dict, List, Optional, Tuple

from app.models import db, BatchRule, BatchRun, BatchRunFile, BatchRunStep, BatchLog, DatabaseConfig
from app.services.database_service import DatabaseService
from app.services.invoice_service import InvoiceService
from app.services.purchase_order_service import PurchaseOrderService
from app.services.invoice_copy_service import InvoiceCopyService

logger = logging.getLogger(__name__)

STEP_TYPES = ('invoice', 'po', 'copy')
STEP_LABELS = {'invoice': 'Invoice', 'po': 'Purchase order', 'copy': 'Copy invoice'}
RETRYABLE_STATUSES = ('pending', 'failed', 'blocked')
EXECUTABLE_RUN_STATUSES = ('draft', 'completed_with_errors', 'interrupted')

ServiceFactory = Callable[[DatabaseConfig], Any]


class StepError(Exception):
    def __init__(self, message: str, details: Optional[Dict[str, Any]] = None):
        super().__init__(message)
        self.details = details or {}


def document_kind(step_type: str) -> str:
    return 'po' if step_type == 'po' else 'invoice'


def match_rule_for_filename(filename: str, rules: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """Rule whose match text appears in the file name (case-insensitive); the longest match wins"""
    name = (filename or '').lower()
    best, best_len = None, 0
    for rule in rules:
        text = (rule.get('match_text') or '').strip().lower()
        if text and text in name and len(text) > best_len:
            best, best_len = rule, len(text)
    return best


def clean_rule_steps(steps: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    cleaned = []
    for step in steps or []:
        item = {
            'id': str(step.get('id') or ''),
            'type': step.get('type'),
            'database_config_id': _to_int(step.get('database_config_id')),
            'party_id': _to_int(step.get('party_id')),
            'party_label': str(step.get('party_label') or '')[:255],
        }
        if item['type'] == 'copy':
            item['source_step_id'] = str(step.get('source_step_id') or '')
        cleaned.append(item)
    return cleaned


def validate_rule(name: str, steps: List[Dict[str, Any]], allowed_config_ids: set) -> List[str]:
    errors = []
    if not (name or '').strip():
        errors.append('Rule name is required')
    if not steps:
        errors.append('Add at least one step')

    earlier: Dict[str, Dict[str, Any]] = {}
    for number, step in enumerate(steps or [], start=1):
        label = f'Step {number}'
        if not step.get('id') or step['id'] in earlier:
            errors.append(f'{label}: missing or duplicate step id')
        if step.get('type') not in STEP_TYPES:
            errors.append(f'{label}: unknown step type')
            continue
        if step.get('database_config_id') not in allowed_config_ids:
            errors.append(f'{label}: choose a database')
        if step.get('party_id') is None:
            errors.append(f"{label}: choose a {'supplier' if step['type'] == 'po' else 'customer'}")
        if step['type'] == 'copy':
            source = earlier.get(step.get('source_step_id'))
            if source is None or source.get('type') != 'invoice':
                errors.append(f'{label}: a copy must use an invoice step listed above it')
        if step.get('id'):
            earlier[step['id']] = step
    return errors


def project_document_numbers(steps: List[Dict[str, Any]]) -> Dict[Any, int]:
    """Number each step that will still run is expected to get.

    Steps are given in run order; numbers are MAX+1 per database and document kind,
    so steps sharing a series take consecutive numbers."""
    next_by_series: Dict[Tuple[Any, str], int] = {}
    projected = {}
    for step in steps:
        if step['status'] not in RETRYABLE_STATUSES or step.get('base_number') is None:
            continue
        series = (step['database_config_id'], document_kind(step['type']))
        number = max(next_by_series.get(series, 0), step['base_number'])
        projected[step['id']] = number
        next_by_series[series] = number + 1
    return projected


def _to_int(value) -> Optional[int]:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _document_number(step_type: str, document: Dict[str, Any]) -> str:
    return str(document['po_number'] if step_type == 'po' else document['invoice_number'])


def _document_header(document: Dict[str, Any]) -> Dict[str, Any]:
    return {k: v for k, v in document.items() if k not in ('lines', 'summary')}


def _summary(step_type: str, document: Dict[str, Any], missing: List[Dict[str, Any]], products_added: int) -> Dict[str, Any]:
    total = document.get('po_total') if step_type == 'po' else document.get('invoice_total')
    return {
        'lines': document.get('no_lines', 0),
        'total': round(float(total or 0), 2),
        'party_name': document.get('business_name') or '',
        'account_no': document.get('account_no') or '',
        'missing_upcs': [
            {'upc': m.get('upc'), 'qty': m.get('qty'), 'row': m.get('row_number'), 'description': m.get('description')}
            for m in missing
        ],
        'products_added': products_added,
    }


def _excel_document(step_type: str, db_service, rows: List[Dict[str, Any]], party_id: int):
    if step_type == 'po':
        ok, party, message = db_service.get_supplier_by_id(party_id)
        processor = PurchaseOrderService(db_service)
    else:
        ok, party, message = db_service.get_customer_by_id(party_id)
        processor = InvoiceService(db_service)
    if not ok:
        raise StepError(message)

    ok, items, message = db_service.get_items_by_upcs([row['UPC'] for row in rows])
    if not ok:
        raise StepError(message)

    ok, document, missing, message = processor.process_excel_data(rows, items, party)
    if not ok:
        raise StepError(message, {'missing_upcs': missing})
    return document, missing


def _copy_document(source_service, dest_service, source_lines: List[Dict[str, Any]], source_number,
                   customer_id: int, add_products: bool):
    """Same result as the Copy Invoice tool. With add_products=False (preview) nothing is written:
    products missing in the destination are counted as if they had been added."""
    upcs = list(dict.fromkeys(str(line['ProductUPC']) for line in source_lines if line.get('ProductUPC')))
    if not upcs:
        raise StepError('The source invoice has no line items with UPCs')

    ok, customer, message = dest_service.get_customer_by_id(customer_id)
    if not ok:
        raise StepError(f'Customer not found in the destination: {message}')

    ok, dest_items, message = dest_service.get_items_by_upcs(upcs)
    if not ok:
        raise StepError(message)

    found = {str(item.get('ProductUPC', '')) for item in dest_items}
    absent = [upc for upc in upcs if upc not in found]
    products_added = 0
    if absent:
        ok, source_items, message = source_service.get_full_items_by_upcs(absent)
        if not ok:
            raise StepError(f'Could not read products from the source database: {message}')
        if not add_products:
            dest_items = dest_items + [{**item, 'ProductID': None} for item in source_items]
            products_added = len(source_items)
        elif source_items:
            ok, products_added, message = dest_service.insert_items(source_items)
            if not ok:
                raise StepError(f'Could not add missing products to the destination: {message}')
            ok, dest_items, message = dest_service.get_items_by_upcs(upcs)
            if not ok:
                raise StepError(message)

    ok, next_number, message = dest_service.get_next_invoice_number()
    if not ok:
        raise StepError(message)

    ok, document, missing, message = InvoiceCopyService().build_copy_preview(
        source_lines, dest_items, customer, next_number, str(source_number)
    )
    if not ok:
        raise StepError(message, {'missing_upcs': missing})
    return document, missing, products_added


def step_title(step: BatchRunStep) -> str:
    return f'{STEP_LABELS.get(step.type, step.type)} → {step.database_name or "?"}'


def add_log(run: BatchRun, level: str, message: str, run_file: BatchRunFile = None,
            step: BatchRunStep = None, details: Any = None):
    if details is not None and not isinstance(details, str):
        details = json.dumps(details, default=str, indent=2)
    db.session.add(BatchLog(
        run_id=run.id,
        run_file_id=run_file.id if run_file else (step.run_file_id if step else None),
        run_step_id=step.id if step else None,
        level=level,
        message=message,
        details=details,
    ))
    log_fn = {'error': logger.error, 'warning': logger.warning}.get(level, logger.info)
    log_fn(f'[batch run {run.id}] {message}')


def user_configs(user_id: int) -> Dict[int, DatabaseConfig]:
    return {c.id: c for c in DatabaseConfig.query.filter_by(user_id=user_id).all()}


def plan_file(run_file: BatchRunFile, rule: BatchRule, configs: Dict[int, DatabaseConfig],
              service_for: ServiceFactory = DatabaseService):
    """(Re)build the file's steps from its rule and dry-run each one. Nothing is written to SQL Server.
    A step whose preview fails starts excluded, so it only runs if the user ticks it back on."""
    run = run_file.run
    for old in list(run_file.steps):
        run_file.steps.remove(old)
    db.session.flush()

    run_file.rule_id = rule.id
    run_file.rule_name = rule.name
    rows = json.loads(run_file.rows_json or '[]')
    documents: Dict[str, Dict[str, Any]] = {}
    steps_by_key: Dict[str, BatchRunStep] = {}

    for position, spec in enumerate(json.loads(rule.steps_json or '[]')):
        config = configs.get(spec.get('database_config_id'))
        step = BatchRunStep(
            run_id=run_file.run_id,
            position=position,
            step_key=spec['id'],
            type=spec['type'],
            database_config_id=spec.get('database_config_id'),
            database_name=config.name if config else '(deleted database)',
            party_id=spec.get('party_id'),
            party_label=spec.get('party_label'),
            source_step_key=spec.get('source_step_id'),
            status='pending',
        )
        run_file.steps.append(step)
        steps_by_key[step.step_key] = step
        db.session.flush()

        try:
            if config is None:
                raise StepError('The database used by this rule no longer exists')
            service = service_for(config)
            if step.type == 'copy':
                source_step = steps_by_key.get(step.source_step_key)
                source_document = documents.get(step.source_step_key)
                if source_step is None or source_document is None:
                    raise StepError('The invoice it copies could not be prepared')
                source_service = service_for(configs[source_step.database_config_id])
                document, missing, added = _copy_document(
                    source_service, service, source_document['lines'], source_step.base_number,
                    step.party_id, add_products=False
                )
            else:
                document, missing = _excel_document(step.type, service, rows, step.party_id)
                added = 0
            documents[step.step_key] = document
            step.base_number = int(_document_number(step.type, document))
            step.preview_json = json.dumps(_summary(step.type, document, missing, added), default=str)
            if missing:
                add_log(run, 'warning',
                        f'{run_file.filename} › {step_title(step)}: {len(missing)} UPC(s) not found, those lines will be skipped',
                        step=step, details=[m.get('upc') for m in missing])
        except StepError as e:
            step.status = 'excluded'
            step.message = str(e)
            step.preview_json = json.dumps({'error': str(e), **e.details}, default=str)
            add_log(run, 'warning', f'{run_file.filename} › {step_title(step)}: preview failed: {e}',
                    step=step, details=e.details or None)
        except Exception as e:
            step.status = 'excluded'
            step.message = f'Unexpected error: {e}'
            step.preview_json = json.dumps({'error': step.message})
            add_log(run, 'error', f'{run_file.filename} › {step_title(step)}: preview crashed: {e}',
                    step=step, details=traceback.format_exc())


def _execute_step(step: BatchRunStep, rows: List[Dict[str, Any]], steps_by_key: Dict[str, BatchRunStep],
                  configs: Dict[int, DatabaseConfig], service_for: ServiceFactory):
    config = configs.get(step.database_config_id)
    if config is None:
        raise StepError('The database for this step no longer exists')
    service = service_for(config)

    if step.type == 'copy':
        source = steps_by_key[step.source_step_key]
        source_config = configs.get(source.database_config_id)
        if source_config is None:
            raise StepError('The source database no longer exists')
        source_service = service_for(source_config)
        ok, data, message = source_service.get_invoice_with_details(source.doc_id)
        if not ok:
            raise StepError(f'Could not read invoice #{source.doc_number} from {source.database_name}: {message}')
        document, missing, added = _copy_document(
            source_service, service, data['details'], source.doc_number, step.party_id, add_products=True
        )
    else:
        document, missing = _excel_document(step.type, service, rows, step.party_id)
        added = 0

    if step.type == 'po':
        ok, doc_id, message = service.create_purchase_order(_document_header(document), document['lines'])
    else:
        ok, doc_id, message = service.create_invoice(_document_header(document), document['lines'])
    if not ok:
        raise StepError(message)

    return _document_number(step.type, document), int(doc_id), _summary(step.type, document, missing, added)


def execute_run(run_id: int, service_for: ServiceFactory = DatabaseService):
    """Create every pending/failed/blocked step of a run. The caller has already set status='running'."""
    run = db.session.get(BatchRun, run_id)
    try:
        configs = user_configs(run.user_id)
        todo = sum(1 for f in run.files if not f.error for s in f.steps if s.status in RETRYABLE_STATUSES)
        add_log(run, 'info', f'Run started: {todo} document(s) to create')
        db.session.commit()

        for run_file in run.files:
            if run_file.error:
                continue
            rows = json.loads(run_file.rows_json or '[]')
            steps_by_key = {s.step_key: s for s in run_file.steps}
            for step in run_file.steps:
                if step.status not in RETRYABLE_STATUSES:
                    continue
                _run_one_step(run, run_file, step, rows, steps_by_key, configs, service_for)

        all_steps = [s for f in run.files if not f.error for s in f.steps if s.status != 'excluded']
        ok = all(s.status == 'success' for s in all_steps)
        run.status = 'completed' if ok else 'completed_with_errors'
        run.finished_at = datetime.utcnow()
        created = sum(1 for s in all_steps if s.status == 'success')
        add_log(run, 'info' if ok else 'warning',
                f'Run finished: {created} of {len(all_steps)} document(s) created')
        db.session.commit()
    except Exception as e:
        db.session.rollback()
        run = db.session.get(BatchRun, run_id)
        for run_file in run.files:
            for step in run_file.steps:
                if step.status == 'running':
                    step.status = 'interrupted'
                    step.message = 'The run stopped while this step was running. Check the database to see whether it was created.'
        run.status = 'interrupted'
        run.finished_at = datetime.utcnow()
        add_log(run, 'error', f'Run stopped unexpectedly: {e}', details=traceback.format_exc())
        db.session.commit()


def _run_one_step(run, run_file, step, rows, steps_by_key, configs, service_for):
    where = f'{run_file.filename} › {step_title(step)}'
    if step.type == 'copy':
        source = steps_by_key.get(step.source_step_key)
        if source is None or source.status != 'success':
            step.status = 'blocked'
            step.message = 'Skipped: the invoice it copies was not created'
            add_log(run, 'warning', f'{where}: {step.message}', step=step)
            db.session.commit()
            return

    step.status = 'running'
    step.started_at = datetime.utcnow()
    step.message = None
    db.session.commit()

    try:
        number, doc_id, summary = _execute_step(step, rows, steps_by_key, configs, service_for)
        step.status = 'success'
        step.doc_number = number
        step.doc_id = doc_id
        step.preview_json = json.dumps(summary, default=str)
        step.message = f"Created {'PO' if step.type == 'po' else 'invoice'} #{number}"
        add_log(run, 'info', f'{where}: {step.message} for {step.party_label or summary["party_name"]} '
                             f'({summary["lines"]} lines, total {summary["total"]:.2f})', step=step)
        if summary['products_added']:
            add_log(run, 'info', f'{where}: added {summary["products_added"]} missing product(s) to {step.database_name}',
                    step=step)
        if summary['missing_upcs']:
            add_log(run, 'warning', f'{where}: {len(summary["missing_upcs"])} UPC(s) not found, lines skipped',
                    step=step, details=[m['upc'] for m in summary['missing_upcs']])
    except StepError as e:
        step.status = 'failed'
        step.message = str(e)
        add_log(run, 'error', f'{where}: {e}', step=step, details=e.details or None)
    except Exception as e:
        step.status = 'failed'
        step.message = f'Unexpected error: {e}'
        add_log(run, 'error', f'{where}: unexpected error: {e}', step=step, details=traceback.format_exc())
    finally:
        step.finished_at = datetime.utcnow()
        db.session.commit()


def recover_interrupted_runs():
    """Runs left 'running' by a server restart can never finish; mark them so they can be checked and retried."""
    for run in BatchRun.query.filter_by(status='running').all():
        for run_file in run.files:
            for step in run_file.steps:
                if step.status == 'running':
                    step.status = 'interrupted'
                    step.message = 'The server stopped while this step was running. Check the database to see whether it was created.'
        run.status = 'interrupted'
        run.finished_at = datetime.utcnow()
        add_log(run, 'error', 'The server restarted during this run; remaining steps can be retried')
    db.session.commit()


def _iso(value: Optional[datetime]) -> Optional[str]:
    return value.isoformat() + 'Z' if value else None


def serialize_rule(rule: BatchRule) -> Dict[str, Any]:
    return {
        'id': rule.id,
        'name': rule.name,
        'match_text': rule.match_text or '',
        'steps': json.loads(rule.steps_json or '[]'),
        'created_at': _iso(rule.created_at),
        'updated_at': _iso(rule.updated_at),
    }


def serialize_run(run: BatchRun, include_files: bool = True, include_logs: bool = False) -> Dict[str, Any]:
    steps = [s for f in run.files if not f.error for s in f.steps]
    counts: Dict[str, int] = {}
    for s in steps:
        counts[s.status] = counts.get(s.status, 0) + 1

    result = {
        'id': run.id,
        'status': run.status,
        'created_at': _iso(run.created_at),
        'started_at': _iso(run.started_at),
        'finished_at': _iso(run.finished_at),
        'file_count': len(run.files),
        'file_errors': sum(1 for f in run.files if f.error),
        'counts': counts,
    }

    if include_files:
        projected = project_document_numbers([
            {'id': s.id, 'type': s.type, 'database_config_id': s.database_config_id,
             'status': s.status, 'base_number': s.base_number}
            for s in steps
        ])
        result['files'] = [{
            'id': f.id,
            'filename': f.filename,
            'rule_id': f.rule_id,
            'rule_name': f.rule_name,
            'row_count': len(json.loads(f.rows_json or '[]')),
            'error': f.error,
            'warnings': json.loads(f.warnings_json or '[]'),
            'steps': [{
                'id': s.id,
                'key': s.step_key,
                'type': s.type,
                'label': STEP_LABELS.get(s.type, s.type),
                'database_config_id': s.database_config_id,
                'database_name': s.database_name,
                'party_label': s.party_label,
                'source_step_key': s.source_step_key,
                'status': s.status,
                'preview': json.loads(s.preview_json or '{}'),
                'projected_number': projected.get(s.id),
                'doc_number': s.doc_number,
                'message': s.message,
                'finished_at': _iso(s.finished_at),
            } for s in f.steps],
        } for f in run.files]

    if include_logs:
        result['logs'] = [serialize_log(log) for log in run.logs]
    return result


def serialize_log(log: BatchLog) -> Dict[str, Any]:
    return {
        'id': log.id,
        'level': log.level,
        'message': log.message,
        'details': log.details,
        'step_id': log.run_step_id,
        'created_at': _iso(log.created_at),
    }


def format_run_log(run: BatchRun) -> str:
    lines = [f'Batch run #{run.id} — status: {run.status}', f'Created: {_iso(run.created_at)}', '']
    for log in run.logs:
        lines.append(f'{_iso(log.created_at)} [{log.level.upper()}] {log.message}')
        if log.details:
            lines.extend('    ' + line for line in log.details.splitlines())
    return '\n'.join(lines) + '\n'
