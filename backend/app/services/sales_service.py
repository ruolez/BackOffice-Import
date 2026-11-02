"""Sales presets: a store database's sales of the previous month, filtered by subcategory and exclusions,
less credit memos, turned into the same UPC / Cost / QTY rows an Excel sales report gives."""

import json
from datetime import date, datetime
from typing import Any, Dict, List, Optional, Tuple

from app.models import SalesPreset

MONTH_NAMES = ('January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September',
               'October', 'November', 'December')


class PullError(Exception):
    pass


def previous_month(today: date) -> str:
    """'YYYY-MM' of the calendar month before today"""
    year, month = (today.year - 1, 12) if today.month == 1 else (today.year, today.month - 1)
    return f'{year:04d}-{month:02d}'


def month_range(period: str) -> Tuple[datetime, datetime]:
    """[first day, first day of the next month) of a 'YYYY-MM' period"""
    year, month = (int(part) for part in period.split('-'))
    start = datetime(year, month, 1)
    end = datetime(year + 1, 1, 1) if month == 12 else datetime(year, month + 1, 1)
    return start, end


def month_label(period: str) -> str:
    year, month = period.split('-')
    return f'{MONTH_NAMES[int(month) - 1]} {year}'


def _clean_list(values) -> List[str]:
    return list(dict.fromkeys(str(v).strip() for v in (values or []) if str(v).strip()))


def clean_preset(data: Dict[str, Any]) -> Dict[str, Any]:
    def ints(values):
        result = []
        for v in values or []:
            try:
                result.append(int(v))
            except (TypeError, ValueError):
                continue
        return sorted(set(result))

    rule_id = data.get('rule_id')
    return {
        'name': (data.get('name') or '').strip()[:100],
        'source_config_id': int(data['source_config_id']) if str(data.get('source_config_id') or '').isdigit() else None,
        'rule_id': int(rule_id) if str(rule_id or '').isdigit() else None,
        'subcategory_ids': ints(data.get('subcategory_ids')),
        'known_subcategory_ids': ints(data.get('known_subcategory_ids')),
        'exclude_upcs': _clean_list(data.get('exclude_upcs')),
        'exclude_words': _clean_list(data.get('exclude_words')),
        'exclude_accounts': _clean_list(data.get('exclude_accounts')),
    }


def validate_preset(preset: Dict[str, Any], allowed_config_ids: set, allowed_rule_ids: set) -> List[str]:
    errors = []
    if not preset['name']:
        errors.append('Preset name is required')
    if preset['source_config_id'] not in allowed_config_ids:
        errors.append('Choose the store database to pull sales from')
    if not preset['subcategory_ids']:
        errors.append('Choose at least one subcategory')
    if preset['rule_id'] is not None and preset['rule_id'] not in allowed_rule_ids:
        errors.append('The chosen rule no longer exists')
    return errors


def apply_preset(model: SalesPreset, preset: Dict[str, Any]):
    model.name = preset['name']
    model.source_config_id = preset['source_config_id']
    model.rule_id = preset['rule_id']
    model.subcategory_ids_json = json.dumps(preset['subcategory_ids'])
    model.known_subcategory_ids_json = json.dumps(preset['known_subcategory_ids'])
    model.exclude_upcs_json = json.dumps(preset['exclude_upcs'])
    model.exclude_words_json = json.dumps(preset['exclude_words'])
    model.exclude_accounts_json = json.dumps(preset['exclude_accounts'])


def serialize_preset(model: SalesPreset) -> Dict[str, Any]:
    return {
        'id': model.id,
        'name': model.name,
        'source_config_id': model.source_config_id,
        'rule_id': model.rule_id,
        'subcategory_ids': json.loads(model.subcategory_ids_json or '[]'),
        'known_subcategory_ids': json.loads(model.known_subcategory_ids_json or '[]'),
        'exclude_upcs': json.loads(model.exclude_upcs_json or '[]'),
        'exclude_words': json.loads(model.exclude_words_json or '[]'),
        'exclude_accounts': json.loads(model.exclude_accounts_json or '[]'),
        'updated_at': model.updated_at.isoformat() + 'Z' if model.updated_at else None,
    }


def _qty(value) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def build_sales_rows(sales: List[Dict[str, Any]], credits: List[Dict[str, Any]],
                     exclude_upcs: List[str], exclude_words: List[str]) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    """Rows (UPC, Cost, QTY) from sales grouped by UPC + unit cost, less credit memo quantities by UPC.

    A credit comes off the product's most recent sale line first, then the next most recent.
    Lines that end at zero or below are dropped and reported."""
    upcs = set(_clean_list(exclude_upcs))
    words = [w.lower() for w in _clean_list(exclude_words)]

    def exclusion(upc: str, description: str) -> Optional[str]:
        if upc in upcs:
            return 'upc'
        text = (description or '').lower()
        return 'word' if any(w in text for w in words) else None

    summary = {
        'sale_lines': sum(int(s.get('line_count') or 1) for s in sales),
        'without_upc': 0,
        'excluded_by_upc': [],
        'excluded_by_word': [],
        'credits_applied': [],
        'credits_without_sales': [],
        'credit_over_sales': [],
        'dropped': [],
    }

    lines: List[Dict[str, Any]] = []
    excluded_upcs = set()
    for sale in sales:
        upc = str(sale.get('upc') or '').strip()
        if not upc:
            summary['without_upc'] += 1
            continue
        reason = exclusion(upc, sale.get('description'))
        if reason:
            excluded_upcs.add(upc)
            summary[f'excluded_by_{reason}'].append({'upc': upc, 'description': sale.get('description') or '',
                                                     'qty': _qty(sale.get('qty'))})
            continue
        lines.append({'upc': upc, 'description': sale.get('description') or '',
                      'cost': round(float(sale.get('cost') or 0), 4), 'sold': _qty(sale.get('qty')),
                      'credited': 0.0, 'last_sale': sale.get('last_sale')})

    by_upc: Dict[str, List[Dict[str, Any]]] = {}
    for line in lines:
        by_upc.setdefault(line['upc'], []).append(line)

    for credit in credits:
        upc = str(credit.get('upc') or '').strip()
        remaining = _qty(credit.get('qty'))
        if not upc or remaining <= 0 or upc in excluded_upcs or exclusion(upc, credit.get('description')):
            continue
        candidates = sorted(by_upc.get(upc, []),
                            key=lambda l: (l['last_sale'] is not None, l['last_sale'] or datetime.min, l['sold']),
                            reverse=True)
        if not candidates:
            summary['credits_without_sales'].append({'upc': upc, 'description': credit.get('description') or '',
                                                     'qty': remaining})
            continue
        summary['credits_applied'].append({'upc': upc, 'qty': remaining})
        for line in candidates:
            if remaining <= 0:
                break
            take = min(remaining, max(line['sold'] - line['credited'], 0))
            line['credited'] += take
            remaining -= take
        if remaining > 0:
            candidates[0]['credited'] += remaining
            summary['credit_over_sales'].append({'upc': upc, 'description': candidates[0]['description'],
                                                 'over': remaining})

    rows = []
    for line in sorted(lines, key=lambda l: (l['description'].lower(), l['upc'], l['cost'])):
        net = round(line['sold'] - line['credited'], 4)
        if net <= 0:
            summary['dropped'].append({'upc': line['upc'], 'description': line['description'], 'cost': line['cost'],
                                       'sold': line['sold'], 'credited': line['credited'], 'net': net})
            continue
        rows.append({'UPC': line['upc'], 'Cost': line['cost'], 'QTY': net, 'row_number': len(rows) + 1,
                     'description': line['description'], 'sold': line['sold'], 'credited': line['credited']})
    return rows, summary


def sales_notes(summary: Dict[str, Any]) -> List[str]:
    """Plain-language warnings about a pull"""
    notes = []
    if summary.get('new_subcategories'):
        names = ', '.join(summary['new_subcategories'][:8])
        notes.append(f"{len(summary['new_subcategories'])} subcategory(ies) were added to the store after this preset "
                     f"was saved and are not included: {names}. Edit the preset to include them.")
    if summary['dropped']:
        notes.append(f"{len(summary['dropped'])} line(s) dropped because credit memos cancel all of their sales: "
                     + ', '.join(f"{d['upc']} {d['description']}".strip() for d in summary['dropped'][:5]))
    if summary['credits_without_sales']:
        notes.append(f"{len(summary['credits_without_sales'])} credit memo product(s) had no sales this month and "
                     f"were ignored: " + ', '.join(c['upc'] for c in summary['credits_without_sales'][:5]))
    if summary['without_upc']:
        notes.append(f"{summary['without_upc']} sale line group(s) without a UPC were skipped")
    return notes


def pull_preset(preset: SalesPreset, period: str, service) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    """Read one month of sales and credit memos from the preset's source database. Read-only."""
    start, end = month_range(period)
    subcategory_ids = json.loads(preset.subcategory_ids_json or '[]')
    accounts = json.loads(preset.exclude_accounts_json or '[]')

    ok, sales, message = service.get_sales_lines(start, end, subcategory_ids, accounts)
    if not ok:
        raise PullError(f'Could not read sales: {message}')
    ok, credits, message = service.get_credit_lines(start, end, subcategory_ids, accounts)
    if not ok:
        raise PullError(f'Could not read credit memos: {message}')

    rows, summary = build_sales_rows(sales, credits, json.loads(preset.exclude_upcs_json or '[]'),
                                     json.loads(preset.exclude_words_json or '[]'))

    known = set(json.loads(preset.known_subcategory_ids_json or '[]'))
    summary['new_subcategories'] = []
    if known:
        ok, tree, _ = service.get_category_tree()
        if ok:
            summary['new_subcategories'] = [s['name'] for s in tree['subcategories'] if s['id'] not in known]

    summary.update({
        'period': period,
        'period_label': month_label(period),
        'rows': len(rows),
        'products': len({r['UPC'] for r in rows}),
        'total_qty': round(sum(r['QTY'] for r in rows), 2),
        'total_cost': round(sum(r['QTY'] * r['Cost'] for r in rows), 2),
        'excluded_accounts': accounts,
    })
    summary['notes'] = sales_notes(summary)
    return rows, summary
