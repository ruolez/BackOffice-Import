"""Completion report of a monthly run: every document created with its number, plus what was not created."""

from io import BytesIO
from typing import Any, Dict, List

from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment
from openpyxl.utils import get_column_letter

DOC_TYPES = ('invoice', 'copy', 'po')
DOC_TYPE_LABELS = {'invoice': 'Invoice', 'copy': 'Invoice copy', 'po': 'Purchase order'}
DOC_TYPE_PLURALS = {'invoice': 'Invoices', 'copy': 'Invoice copies', 'po': 'Purchase orders'}
NOT_CREATED_LABELS = {
    'excluded': 'Skipped',
    'failed': 'Failed',
    'blocked': 'Not run',
    'interrupted': 'Interrupted',
    'pending': 'Not started',
    'running': 'Running',
}


def _number_key(number) -> tuple:
    text = str(number or '')
    return (0, int(text), '') if text.isdigit() else (1, 0, text)


def _document_notes(step: Dict[str, Any]) -> List[str]:
    p = step.get('preview') or {}
    notes = []
    if p.get('recovered'):
        notes.append('Saved by an earlier attempt (checked, not duplicated)')
    if p.get('missing_upcs'):
        notes.append(f"{len(p['missing_upcs'])} UPC(s) not found, lines skipped")
    if p.get('products_added'):
        notes.append(f"{p['products_added']} product(s) added to {step['database_name']}")
    if p.get('duplicate_number'):
        notes.append(f"Number #{step['doc_number']} exists {p['duplicate_number']} times, check numbering")
    before = p.get('preview')
    if before and (before.get('lines') != p.get('lines') or abs(float(before.get('total') or 0) - float(p.get('total') or 0)) >= 0.01):
        notes.append(f"Changed since preview (was {before.get('lines')} lines, {float(before.get('total') or 0):.2f})")
    if (step.get('attempts') or 0) > 1:
        notes.append(f"Needed {step['attempts']} attempts")
    return notes


def build_run_report(run: Dict[str, Any]) -> Dict[str, Any]:
    """Takes serialize_run() output (with files)"""
    documents, not_created, skipped_upcs, by_file = [], [], [], []

    for f in run['files']:
        file_docs, file_problems = [], 0
        if f.get('error'):
            not_created.append({'file': f['filename'], 'document': 'Whole file', 'database': '', 'party': '',
                                'status': 'Unreadable', 'reason': f['error']})
            by_file.append({'file': f['filename'], 'rule': '', 'documents': [], 'problems': 1})
            continue
        if not f['steps']:
            not_created.append({'file': f['filename'], 'document': 'Whole file', 'database': '', 'party': '',
                                'status': 'No rule', 'reason': 'No rule was chosen for this file, so nothing was created'})
            by_file.append({'file': f['filename'], 'rule': '', 'documents': [], 'problems': 1})
            continue

        steps_by_key = {s['key']: s for s in f['steps']}
        for s in f['steps']:
            p = s.get('preview') or {}
            party = p.get('party_name') or s.get('party_label') or ''
            if s['status'] == 'success':
                source = steps_by_key.get(s.get('source_step_key')) if s['type'] == 'copy' else None
                doc = {
                    'type': s['type'],
                    'type_label': DOC_TYPE_LABELS[s['type']],
                    'database': s['database_name'],
                    'number': s['doc_number'],
                    'party': party,
                    'account_no': p.get('account_no') or '',
                    'file': f['filename'],
                    'lines': p.get('lines') or 0,
                    'total': round(float(p.get('total') or 0), 2),
                    'copied_from': f"#{source['doc_number']} in {source['database_name']}" if source else '',
                    'notes': _document_notes(s),
                }
                documents.append(doc)
                file_docs.append(doc)
                for m in p.get('missing_upcs') or []:
                    skipped_upcs.append({'file': f['filename'], 'document': f"{doc['type_label']} #{doc['number']}",
                                         'database': s['database_name'], 'upc': m.get('upc'), 'qty': m.get('qty'),
                                         'row': m.get('row')})
            else:
                file_problems += 1
                not_created.append({
                    'file': f['filename'],
                    'document': DOC_TYPE_LABELS.get(s['type'], s['type']),
                    'database': s['database_name'],
                    'party': party,
                    'status': NOT_CREATED_LABELS.get(s['status'], s['status']),
                    'reason': s.get('message') or p.get('error') or ('Unticked before the run' if s['status'] == 'excluded' else ''),
                })
        by_file.append({'file': f['filename'], 'rule': f.get('rule_name') or '', 'documents': file_docs,
                        'problems': file_problems})

    documents.sort(key=lambda d: (d['database'], DOC_TYPES.index(d['type']), _number_key(d['number'])))

    totals = {t: {'label': DOC_TYPE_PLURALS[t], 'count': 0, 'total': 0.0} for t in DOC_TYPES}
    databases: Dict[str, Dict[str, Any]] = {}
    for d in documents:
        totals[d['type']]['count'] += 1
        totals[d['type']]['total'] = round(totals[d['type']]['total'] + d['total'], 2)
        group = databases.setdefault(d['database'], {'database': d['database'],
                                                     'sections': {t: [] for t in DOC_TYPES}})
        group['sections'][d['type']].append(d)

    by_database = []
    for name in sorted(databases):
        sections = []
        for t in DOC_TYPES:
            docs = databases[name]['sections'][t]
            if docs:
                sections.append({'type': t, 'label': DOC_TYPE_PLURALS[t], 'documents': docs,
                                 'count': len(docs), 'total': round(sum(d['total'] for d in docs), 2),
                                 'first': docs[0]['number'], 'last': docs[-1]['number']})
        by_database.append({'database': name, 'sections': sections})

    return {
        'run': {k: run.get(k) for k in ('id', 'status', 'created_at', 'started_at', 'finished_at')},
        'totals': totals,
        'documents': documents,
        'by_database': by_database,
        'by_file': by_file,
        'not_created': not_created,
        'skipped_upcs': skipped_upcs,
    }


HEADER_FONT = Font(bold=True, color='FFFFFF')
HEADER_FILL = PatternFill('solid', fgColor='2563EB')
MONEY = '#,##0.00'


def _sheet(wb: Workbook, title: str, headers: List[str], rows: List[List[Any]], widths: List[int],
           money_columns=(), text_columns=()):
    ws = wb.create_sheet(title)
    ws.append(headers)
    for cell in ws[1]:
        cell.font = HEADER_FONT
        cell.fill = HEADER_FILL
        cell.alignment = Alignment(vertical='center')
    for row in rows:
        ws.append(row)
    for col, width in enumerate(widths, start=1):
        ws.column_dimensions[get_column_letter(col)].width = width
    for row in ws.iter_rows(min_row=2):
        for col in money_columns:
            row[col].number_format = MONEY
        for col in text_columns:
            row[col].number_format = '@'
    ws.freeze_panes = 'A2'
    if rows:
        ws.auto_filter.ref = ws.dimensions
    return ws


def build_report_excel(report: Dict[str, Any]) -> BytesIO:
    wb = Workbook()
    summary = wb.active
    summary.title = 'Summary'
    run = report['run']
    summary.append([f"Monthly run #{run['id']}"])
    summary['A1'].font = Font(bold=True, size=14)
    summary.append(['Status', run['status']])
    summary.append(['Started (UTC)', (run.get('started_at') or run.get('created_at') or '').replace('T', ' ')[:19]])
    summary.append(['Finished (UTC)', (run.get('finished_at') or '').replace('T', ' ')[:19]])
    summary.append([])
    summary.append(['Database', 'Document type', 'Count', 'First #', 'Last #', 'Total'])
    for cell in summary[summary.max_row]:
        cell.font = HEADER_FONT
        cell.fill = HEADER_FILL
    for group in report['by_database']:
        for section in group['sections']:
            summary.append([group['database'], section['label'], section['count'], section['first'], section['last'],
                            section['total']])
            summary.cell(summary.max_row, 6).number_format = MONEY
    summary.append([])
    for t in DOC_TYPES:
        total = report['totals'][t]
        summary.append([f"All {total['label'].lower()}", '', total['count'], '', '', total['total']])
        summary.cell(summary.max_row, 1).font = Font(bold=True)
        summary.cell(summary.max_row, 6).number_format = MONEY
    summary.append(['Not created', '', len(report['not_created'])])
    summary.cell(summary.max_row, 1).font = Font(bold=True)
    for col, width in enumerate([28, 18, 10, 14, 14, 14], start=1):
        summary.column_dimensions[get_column_letter(col)].width = width

    _sheet(wb, 'Documents',
           ['Database', 'Type', 'Number', 'Customer / Supplier', 'Account', 'File', 'Lines', 'Total', 'Copied from', 'Notes'],
           [[d['database'], d['type_label'], d['number'], d['party'], d['account_no'], d['file'], d['lines'], d['total'],
             d['copied_from'], '; '.join(d['notes'])] for d in report['documents']],
           [22, 16, 12, 32, 14, 36, 8, 14, 22, 50], money_columns=(7,), text_columns=(2,))
    _sheet(wb, 'Not created',
           ['File', 'Document', 'Database', 'Customer / Supplier', 'Status', 'Reason'],
           [[p['file'], p['document'], p['database'], p['party'], p['status'], p['reason']] for p in report['not_created']],
           [36, 18, 22, 32, 14, 70])
    _sheet(wb, 'Skipped UPCs',
           ['File', 'Document', 'Database', 'UPC', 'Qty', 'Excel row'],
           [[u['file'], u['document'], u['database'], str(u['upc'] or ''), u['qty'], u['row']] for u in report['skipped_upcs']],
           [36, 22, 22, 18, 8, 10], text_columns=(3,))

    buf = BytesIO()
    wb.save(buf)
    buf.seek(0)
    return buf
