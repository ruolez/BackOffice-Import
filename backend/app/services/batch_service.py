"""Monthly batch runs: saved rules turn each sales report file into invoices,
invoice copies and purchase orders across databases in one go."""

import json
import logging
import time
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
RETRYABLE_STATUSES = ('pending', 'failed', 'blocked', 'interrupted')
EXECUTABLE_RUN_STATUSES = ('draft', 'completed_with_errors', 'on_hold', 'cancelled', 'interrupted')

MAX_ATTEMPTS = 3
RETRY_DELAYS = (3, 10)  # seconds to wait before attempt 2 and 3

# SQLSTATEs / driver texts of failures that may succeed when tried again:
# connection problems, timeouts and deadlocks. Anything else is treated as permanent.
TRANSIENT_MARKERS = (
    '08001', '08s01', '08004', 'hyt00', 'hyt01', '40001', 'deadlock', 'timeout expired', 'login timeout',
    'communication link failure', 'tcp provider', 'connection is busy', 'connection reset',
    'adaptive server is unavailable', 'unable to connect',
)

ServiceFactory = Callable[[DatabaseConfig], Any]


def is_transient_error(message: str) -> bool:
    text = (message or '').lower()
    return any(marker in text for marker in TRANSIENT_MARKERS)


class StepError(Exception):
    def __init__(self, message: str, details: Optional[Dict[str, Any]] = None, transient: Optional[bool] = None):
        super().__init__(message)
        self.details = details or {}
        self.transient = is_transient_error(message) if transient is None else transient


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
    descriptions = {row.get('row_number'): row.get('description') for row in rows if row.get('description')}
    for entry in missing:
        entry.setdefault('description', descriptions.get(entry.get('row_number')))
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
    """(Re)build the file's steps from its rule and dry-run each one. Nothing is written to SQL Server."""
    for old in list(run_file.steps):
        run_file.steps.remove(old)
    db.session.flush()

    run_file.rule_id = rule.id
    run_file.rule_name = rule.name
    for position, spec in enumerate(json.loads(rule.steps_json or '[]')):
        config = configs.get(spec.get('database_config_id'))
        run_file.steps.append(BatchRunStep(
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
        ))
    db.session.flush()
    preview_file(run_file, configs, service_for)


def preview_file(run_file: BatchRunFile, configs: Dict[int, DatabaseConfig],
                 service_for: ServiceFactory = DatabaseService) -> int:
    """Dry-run every step of the file that has not been created yet and return how many were checked.

    Used for the first preview and for "Re-check" after the user fixed something in BackOffice.
    The user's choices are kept: a pending step whose preview fails is unticked, and a step that was
    unticked only because its preview failed is ticked again once it passes. Nothing is written."""
    run = run_file.run
    rows = json.loads(run_file.rows_json or '[]')
    steps_by_key = {s.step_key: s for s in run_file.steps}
    documents: Dict[str, Dict[str, Any]] = {}
    checked = 0

    for step in run_file.steps:
        if step.status in ('success', 'running', 'interrupted'):
            continue
        checked += 1
        previous = json.loads(step.preview_json or '{}')
        config = configs.get(step.database_config_id)
        try:
            if config is None:
                raise StepError('The database used by this rule no longer exists')
            service = service_for(config)
            if step.type == 'copy':
                source_lines, source_number = _copy_source_for_preview(step, steps_by_key, documents, configs, service_for)
                source_service = service_for(configs[steps_by_key[step.source_step_key].database_config_id])
                document, missing, added = _copy_document(
                    source_service, service, source_lines, source_number, step.party_id, add_products=False
                )
            else:
                document, missing = _excel_document(step.type, service, rows, step.party_id)
                added = 0
            documents[step.step_key] = document
            step.base_number = int(_document_number(step.type, document))
            step.preview_json = json.dumps(_summary(step.type, document, missing, added), default=str)
            if step.status == 'excluded' and previous.get('error'):
                step.status = 'pending'
                step.message = None
                add_log(run, 'info', f'{run_file.filename} › {step_title(step)}: problem fixed, ticked again', step=step)
            elif step.status == 'pending':
                step.message = None
            if missing:
                add_log(run, 'warning',
                        f'{run_file.filename} › {step_title(step)}: {len(missing)} UPC(s) not found, those lines will be skipped',
                        step=step, details=[m.get('upc') for m in missing])
        except StepError as e:
            _preview_failed(run, run_file, step, str(e), e.details, 'warning')
        except Exception as e:
            _preview_failed(run, run_file, step, f'Unexpected error: {e}', None, 'error', traceback.format_exc())
    return checked


def _copy_source_for_preview(step, steps_by_key, documents, configs, service_for):
    """Lines of the invoice a copy will copy: the created invoice if it exists, otherwise its preview"""
    source = steps_by_key.get(step.source_step_key)
    if source is None:
        raise StepError('The invoice it copies is not part of this rule')
    if source.status == 'success':
        source_config = configs.get(source.database_config_id)
        if source_config is None:
            raise StepError('The source database no longer exists')
        ok, data, message = service_for(source_config).get_invoice_with_details(source.doc_id)
        if not ok:
            raise StepError(f'Could not read invoice #{source.doc_number} from {source.database_name}: {message}')
        return data['details'], source.doc_number
    if step.source_step_key in documents:
        return documents[step.source_step_key]['lines'], source.base_number
    raise StepError('The invoice it copies could not be prepared')


def _preview_failed(run, run_file, step, message, details, level, trace=None):
    if step.status == 'pending':
        step.status = 'excluded'
    step.message = message
    step.preview_json = json.dumps({'error': message, **(details or {})}, default=str)
    add_log(run, level, f'{run_file.filename} › {step_title(step)}: preview failed: {message}',
            step=step, details=trace or details or None)


def set_step_hold(step: BatchRunStep, hold: bool) -> List[BatchRunStep]:
    """Put a step (and the copies of it) on hold for later, or take them off hold. Returns the changed steps."""
    affected = [step] + [s for s in step.run_file.steps
                         if s.type == 'copy' and s.source_step_key == step.step_key]
    changed = []
    for s in affected:
        if hold and s.status in ('pending', 'failed', 'blocked', 'excluded'):
            s.status = 'held'
            changed.append(s)
        elif not hold and s.status == 'held':
            s.status = 'pending'
            changed.append(s)
    return changed


def finished_run_status(statuses: List[str]) -> str:
    """Status of a run that has stopped, from the statuses of its steps"""
    found = set(statuses)
    if found & {'failed', 'blocked', 'interrupted', 'pending', 'running'}:
        return 'completed_with_errors'
    if 'held' in found:
        return 'on_hold'
    return 'completed'


def _document_total(step_type: str, document: Dict[str, Any]) -> float:
    return round(float((document.get('po_total') if step_type == 'po' else document.get('invoice_total')) or 0), 2)


def find_documents(step_type: str, service, number) -> List[Dict[str, Any]]:
    """Documents in SQL Server with this number, as [{id, party_id, total, lines}]"""
    finder = service.find_purchase_orders_by_number if step_type == 'po' else service.find_invoices_by_number
    ok, rows, message = finder(str(number))
    if not ok:
        raise StepError(f'Could not check whether #{number} exists: {message}')
    return [{'id': int(r['id']), 'party_id': r.get('party_id'), 'total': round(float(r.get('total') or 0), 2),
             'lines': r.get('lines')} for r in rows]


def find_created_document(step: BatchRunStep, service) -> Optional[Dict[str, Any]]:
    """The document an earlier attempt of this step saved, if any (same number, party and total)"""
    if not step.attempted_number:
        return None
    for doc in find_documents(step.type, service, step.attempted_number):
        if doc['party_id'] == step.party_id and abs(doc['total'] - (step.attempted_total or 0)) < 0.01:
            return doc
    return None


def _execute_step(step: BatchRunStep, rows: List[Dict[str, Any]], steps_by_key: Dict[str, BatchRunStep],
                  configs: Dict[int, DatabaseConfig], service_for: ServiceFactory,
                  before_create: Callable[[str, float], None]):
    config = configs.get(step.database_config_id)
    if config is None:
        raise StepError('The database for this step no longer exists')
    service = service_for(config)

    existing = find_created_document(step, service)
    if existing:
        summary = {**json.loads(step.preview_json or '{}'), 'lines': existing['lines'], 'total': existing['total'],
                   'recovered': True}
        return step.attempted_number, existing['id'], summary

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

    number = _document_number(step.type, document)
    before_create(number, _document_total(step.type, document))
    if step.type == 'po':
        ok, doc_id, message = service.create_purchase_order(_document_header(document), document['lines'])
    else:
        ok, doc_id, message = service.create_invoice(_document_header(document), document['lines'])
    if not ok:
        raise StepError(message)

    return number, int(doc_id), _summary(step.type, document, missing, added)


def _step_databases(step: BatchRunStep, steps_by_key: Dict[str, BatchRunStep]) -> List[int]:
    ids = [step.database_config_id]
    if step.type == 'copy' and step.source_step_key in steps_by_key:
        ids.append(steps_by_key[step.source_step_key].database_config_id)
    return ids


def _connect_with_retries(config: DatabaseConfig, service_for: ServiceFactory, sleep) -> Tuple[bool, str]:
    for attempt in range(1, MAX_ATTEMPTS + 1):
        ok, message = service_for(config).test_connection()
        if ok or not is_transient_error(message) or attempt == MAX_ATTEMPTS:
            return ok, message
        sleep(RETRY_DELAYS[attempt - 1])
    return False, 'unreachable'


def check_databases(run: BatchRun, configs: Dict[int, DatabaseConfig], service_for: ServiceFactory,
                    sleep=time.sleep) -> Dict[str, str]:
    """Connect to every database the remaining steps need; {name: problem} for the ones that fail"""
    needed = set()
    for run_file in run.files:
        if run_file.error:
            continue
        steps_by_key = {s.step_key: s for s in run_file.steps}
        for step in run_file.steps:
            if step.status in RETRYABLE_STATUSES:
                needed.update(_step_databases(step, steps_by_key))

    problems = {}
    for config_id in sorted(i for i in needed if i is not None):
        config = configs.get(config_id)
        if config is None:
            problems[f'database #{config_id}'] = 'this database configuration was deleted'
            continue
        ok, message = _connect_with_retries(config, service_for, sleep)
        if not ok:
            problems[config.name] = message
    return problems


def _cancel_requested(run: BatchRun) -> bool:
    db.session.expire(run, ['cancel_requested'])
    return bool(run.cancel_requested)


def execute_run(run_id: int, service_for: ServiceFactory = DatabaseService, sleep=time.sleep):
    """Create every remaining step of a run. The caller has already set status='running'.

    Before anything is created every database involved must answer. Temporary errors are retried;
    before each retry the step checks whether the previous attempt saved the document after all."""
    run = db.session.get(BatchRun, run_id)
    try:
        run.notice = None
        run.cancel_requested = False
        configs = user_configs(run.user_id)
        todo = sum(1 for f in run.files if not f.error for s in f.steps if s.status in RETRYABLE_STATUSES)
        add_log(run, 'info', f'Run started: {todo} document(s) to create. Checking database connections…')
        db.session.commit()

        problems = check_databases(run, configs, service_for, sleep)
        if problems:
            names = ', '.join(problems)
            run.notice = (f'Nothing was created: could not connect to {names}. Check the connection on the Databases '
                          f'page, or untick the steps that use it, then start again.')
            created_before = any(s.status == 'success' for f in run.files for s in f.steps)
            run.status = 'completed_with_errors' if created_before else 'draft'
            run.finished_at = datetime.utcnow()
            add_log(run, 'error', run.notice, details=problems)
            db.session.commit()
            return

        down: Dict[int, str] = {}
        cancelled = False
        for run_file in run.files:
            if run_file.error or cancelled:
                continue
            rows = json.loads(run_file.rows_json or '[]')
            steps_by_key = {s.step_key: s for s in run_file.steps}
            for step in run_file.steps:
                if step.status not in RETRYABLE_STATUSES:
                    continue
                if _cancel_requested(run):
                    cancelled = True
                    break
                _run_one_step(run, run_file, step, rows, steps_by_key, configs, service_for, down, sleep)

        all_steps = [s for f in run.files if not f.error for s in f.steps if s.status != 'excluded']
        created = sum(1 for s in all_steps if s.status == 'success')
        held = sum(1 for s in all_steps if s.status == 'held')
        run.finished_at = datetime.utcnow()
        if cancelled:
            run.status = 'cancelled'
            add_log(run, 'warning', f'Run cancelled: {created} of {len(all_steps)} document(s) created; '
                                    f'the rest can be started again')
        else:
            run.status = finished_run_status([s.status for s in all_steps])
            on_hold = f', {held} on hold for later' if held else ''
            add_log(run, 'info' if run.status != 'completed_with_errors' else 'warning',
                    f'Run finished: {created} of {len(all_steps)} document(s) created{on_hold}')
        db.session.commit()
    except Exception as e:
        db.session.rollback()
        run = db.session.get(BatchRun, run_id)
        for run_file in run.files:
            for step in run_file.steps:
                if step.status == 'running':
                    step.status = 'interrupted'
                    step.message = ('The run stopped while this step was running. Retrying checks the database '
                                    'first, so it will not be created twice.')
        run.status = 'interrupted'
        run.finished_at = datetime.utcnow()
        add_log(run, 'error', f'Run stopped unexpectedly: {e}', details=traceback.format_exc())
        db.session.commit()


def _fail_step(run, step, where, message, details=None, level='error'):
    step.status = 'failed'
    step.message = message
    add_log(run, level, f'{where}: {message}', step=step, details=details)


def _run_one_step(run, run_file, step, rows, steps_by_key, configs, service_for, down, sleep):
    where = f'{run_file.filename} › {step_title(step)}'
    if step.type == 'copy':
        source = steps_by_key.get(step.source_step_key)
        if source is None or source.status != 'success':
            step.status = 'blocked'
            step.message = 'Not run: the invoice it copies was not created'
            add_log(run, 'warning', f'{where}: {step.message}', step=step)
            db.session.commit()
            return

    unreachable = [down[i] for i in _step_databases(step, steps_by_key) if i in down]
    if unreachable:
        _fail_step(run, step, where, f'Not attempted: {unreachable[0]}', level='warning')
        db.session.commit()
        return

    preview = json.loads(step.preview_json or '{}')
    step.status = 'running'
    step.started_at = datetime.utcnow()
    step.message = None
    db.session.commit()

    def remember_attempt(number, total):
        step.attempted_number = number
        step.attempted_total = total
        db.session.commit()

    try:
        for attempt in range(1, MAX_ATTEMPTS + 1):
            step.attempts = (step.attempts or 0) + 1
            try:
                number, doc_id, summary = _execute_step(step, rows, steps_by_key, configs, service_for, remember_attempt)
                break
            except StepError as e:
                if not e.transient or attempt == MAX_ATTEMPTS:
                    raise
                delay = RETRY_DELAYS[attempt - 1]
                step.message = f'Attempt {attempt} of {MAX_ATTEMPTS} hit a temporary error; retrying in {delay}s'
                add_log(run, 'warning', f'{where}: attempt {attempt} failed with a temporary error, '
                                        f'retrying in {delay}s: {e}', step=step)
                db.session.commit()
                sleep(delay)
    except StepError as e:
        _fail_step(run, step, where, str(e), details=e.details or None)
        if e.transient:
            for config_id in _step_databases(step, steps_by_key):
                config = configs.get(config_id)
                ok, message = service_for(config).test_connection() if config else (False, 'deleted')
                if not ok:
                    down[config_id] = f'{config.name if config else "the database"} stopped responding during this run'
                    add_log(run, 'error', f'{down[config_id]}; its remaining steps are not attempted', details=message)
        step.finished_at = datetime.utcnow()
        db.session.commit()
        return
    except Exception as e:
        _fail_step(run, step, where, f'Unexpected error: {e}', details=traceback.format_exc())
        step.finished_at = datetime.utcnow()
        db.session.commit()
        return

    kind = 'PO' if step.type == 'po' else 'invoice'
    if preview.get('lines') is not None and 'error' not in preview and step.doc_number is None:
        summary['preview'] = {'lines': preview.get('lines'), 'total': preview.get('total')}
    step.status = 'success'
    step.doc_number = number
    step.doc_id = doc_id
    step.finished_at = datetime.utcnow()
    if summary.get('recovered'):
        step.message = f'{kind.capitalize()} #{number} was already saved by an earlier attempt; not created again'
        add_log(run, 'warning', f'{where}: {step.message}', step=step)
    else:
        step.message = f'Created {kind} #{number}'
        add_log(run, 'info', f'{where}: {step.message} for {step.party_label or summary.get("party_name")} '
                             f'({summary.get("lines")} lines, total {float(summary.get("total") or 0):.2f})', step=step)
    if summary.get('products_added') and not summary.get('recovered'):
        add_log(run, 'info', f'{where}: added {summary["products_added"]} missing product(s) to {step.database_name}',
                step=step)
    if summary.get('missing_upcs') and not summary.get('recovered'):
        add_log(run, 'warning', f'{where}: {len(summary["missing_upcs"])} UPC(s) not found, lines skipped',
                step=step, details=[m['upc'] for m in summary['missing_upcs']])

    try:
        same_number = find_documents(step.type, service_for(configs[step.database_config_id]), number)
        if len(same_number) > 1:
            summary['duplicate_number'] = len(same_number)
            add_log(run, 'warning', f'{where}: {len(same_number)} {kind}s now have number #{number} in '
                                    f'{step.database_name}. Someone may have created one at the same time; '
                                    f'check the numbering.', step=step)
    except Exception as e:
        add_log(run, 'warning', f'{where}: could not check #{number} for duplicates: {e}', step=step)

    step.preview_json = json.dumps(summary, default=str)
    db.session.commit()


def recover_interrupted_runs():
    """Runs left 'running' by a server restart can never finish; mark them so they can be retried safely."""
    for run in BatchRun.query.filter_by(status='running').all():
        for run_file in run.files:
            for step in run_file.steps:
                if step.status == 'running':
                    step.status = 'interrupted'
                    step.message = ('The server stopped while this step was running. Retrying checks the '
                                    'database first, so it will not be created twice.')
        run.status = 'interrupted'
        run.finished_at = datetime.utcnow()
        add_log(run, 'error', 'The server restarted during this run; the remaining steps can be started again')
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
        'notice': run.notice,
        'cancel_requested': bool(run.cancel_requested),
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
            'source_type': f.source_type or 'excel',
            'preset_id': f.preset_id,
            'period': f.period,
            'source': json.loads(f.source_json) if f.source_json else None,
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
                'attempts': s.attempts or 0,
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
