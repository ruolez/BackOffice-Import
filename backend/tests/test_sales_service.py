import json
from datetime import date, datetime

import pytest

from app.models import db, SalesPreset, BatchRule, BatchRun, BatchRunFile
from app.services import batch_service as batch
from app.services import sales_service as sales
from app.services.sales_service import build_sales_rows, previous_month, month_range, month_label

from test_batch_service import FakeBackOffice, make_item, CUSTOMER_A, app, setup  # noqa: F401  (fixtures)


class TestPreviousMonth:
    @pytest.mark.parametrize('today, expected', [
        (date(2026, 11, 2), '2026-10'),
        (date(2026, 11, 30), '2026-10'),
        (date(2027, 1, 1), '2026-12'),
        (date(2026, 3, 31), '2026-02'),
    ])
    def test_period_is_always_the_calendar_month_before_today(self, today, expected):
        assert previous_month(today) == expected

    def test_month_range_ends_at_the_first_of_the_next_month(self):
        assert (month_range('2026-12'), month_label('2026-12')) == (
            (datetime(2026, 12, 1), datetime(2027, 1, 1)), 'December 2026')


def sale(upc, cost, qty, day, description='Item'):
    return {'upc': upc, 'description': description, 'cost': cost, 'qty': qty,
            'last_sale': datetime(2026, 10, day), 'line_count': 1}


class TestBuildSalesRows:
    def test_each_cost_of_a_product_stays_a_separate_row(self):
        rows, _ = build_sales_rows([sale('111', 2.0, 10, 3), sale('111', 2.5, 4, 20)], [], [], [])

        assert [(r['UPC'], r['Cost'], r['QTY']) for r in rows] == [('111', 2.0, 10), ('111', 2.5, 4)]

    def test_credit_comes_off_the_most_recent_sale_line(self):
        rows, summary = build_sales_rows([sale('111', 2.0, 10, 3), sale('111', 2.5, 4, 20)],
                                         [{'upc': '111', 'qty': 3}], [], [])

        assert [(r['Cost'], r['QTY'], r['sold'], r['credited']) for r in rows] == [(2.0, 10, 10, 0), (2.5, 1, 4, 3)]
        assert summary['credits_applied'] == [{'upc': '111', 'qty': 3}]

    def test_credit_larger_than_the_latest_line_continues_on_the_next_and_drops_emptied_lines(self):
        rows, summary = build_sales_rows([sale('111', 2.0, 10, 3), sale('111', 2.5, 4, 20)],
                                         [{'upc': '111', 'qty': 6}], [], [])

        assert [(r['Cost'], r['QTY']) for r in rows] == [(2.0, 8)]
        assert [(d['cost'], d['sold'], d['credited'], d['net']) for d in summary['dropped']] == [(2.5, 4, 4, 0)]

    def test_credits_beyond_all_sales_drop_the_product_with_a_warning(self):
        rows, summary = build_sales_rows([sale('111', 2.0, 2, 3)], [{'upc': '111', 'qty': 5}], [], [])

        assert (rows, [d['net'] for d in summary['dropped']], summary['credit_over_sales'][0]['over']) == ([], [-3], 3)

    def test_credit_for_a_product_without_sales_is_ignored_and_reported(self):
        rows, summary = build_sales_rows([sale('111', 2.0, 2, 3)], [{'upc': '222', 'qty': 1, 'description': 'X'}], [], [])

        assert ([r['QTY'] for r in rows], summary['credits_without_sales']) == (
            [2], [{'upc': '222', 'description': 'X', 'qty': 1}])

    def test_excluded_upcs_and_words_remove_sales_and_their_credits(self):
        sales_lines = [sale('111', 1, 5, 3, 'Cola 12oz'), sale('222', 1, 5, 3, 'SAMPLE Chips'),
                       sale('333', 1, 5, 3, 'Water')]

        rows, summary = build_sales_rows(sales_lines, [{'upc': '222', 'qty': 9}], [' 333 '], ['sample'])

        assert [r['UPC'] for r in rows] == ['111']
        assert ([e['upc'] for e in summary['excluded_by_upc']], [e['upc'] for e in summary['excluded_by_word']],
                summary['credits_without_sales']) == (['333'], ['222'], [])

    def test_lines_without_upc_are_skipped_and_counted(self):
        rows, summary = build_sales_rows([sale('', 1, 5, 3), sale(None, 1, 1, 3), sale('111', 1, 1, 3)], [], [], [])

        assert ([r['UPC'] for r in rows], summary['without_upc']) == (['111'], 2)


class SalesBackOffice(FakeBackOffice):
    def __init__(self, sales_lines, credit_lines, subcategories, **kwargs):
        super().__init__(**kwargs)
        self.sales_lines, self.credit_lines, self.subcategories = sales_lines, credit_lines, subcategories
        self.queries = []

    def get_sales_lines(self, start, end, subcategory_ids, accounts):
        self.queries.append(('sales', start, end, subcategory_ids, accounts))
        return True, self.sales_lines, 'ok'

    def get_credit_lines(self, start, end, subcategory_ids, accounts):
        self.queries.append(('credits', start, end, subcategory_ids, accounts))
        return True, self.credit_lines, 'ok'

    def get_category_tree(self):
        return True, {'categories': [], 'subcategories': self.subcategories}, 'ok'


def make_preset(**overrides):
    values = {'name': 'Store 2', 'source_config_id': 1, 'rule_id': None, 'subcategory_ids': [4, 5],
              'known_subcategory_ids': [4, 5, 6], 'exclude_upcs': [], 'exclude_words': [], 'exclude_accounts': ['INT01']}
    values.update(overrides)
    model = SalesPreset(user_id=1)
    sales.apply_preset(model, values)
    return model


class TestPullPreset:
    def test_pull_reads_the_month_with_the_preset_filters_and_flags_new_subcategories(self):
        store = SalesBackOffice([sale('111', 2.0, 3, 5)], [], [{'id': 4, 'name': 'Chips'}, {'id': 7, 'name': 'Jerky'}])

        rows, summary = sales.pull_preset(make_preset(), '2026-10', store)

        assert store.queries == [
            ('sales', datetime(2026, 10, 1), datetime(2026, 11, 1), [4, 5], ['INT01']),
            ('credits', datetime(2026, 10, 1), datetime(2026, 11, 1), [4, 5], ['INT01']),
        ]
        assert ([(r['UPC'], r['Cost'], r['QTY']) for r in rows], summary['new_subcategories'],
                summary['total_cost']) == ([('111', 2.0, 3)], ['Jerky'], 6.0)

    def test_pull_failure_is_reported(self):
        store = SalesBackOffice([], [], [])
        store.get_sales_lines = lambda *a: (False, [], 'Database query failed: timeout')

        with pytest.raises(sales.PullError, match='Could not read sales: Database query failed: timeout'):
            sales.pull_preset(make_preset(), '2026-10', store)


class TestValidatePreset:
    def test_requires_name_source_and_subcategories(self):
        preset = sales.clean_preset({'name': ' ', 'source_config_id': '', 'subcategory_ids': [], 'rule_id': 9})

        assert sales.validate_preset(preset, {1}, {2}) == [
            'Preset name is required', 'Choose the store database to pull sales from',
            'Choose at least one subcategory', 'The chosen rule no longer exists']


class TestSalesIntoInvoices:
    def test_pulled_sales_create_an_invoice_with_one_line_per_cost(self, setup):
        run_file = setup['file']
        rows, _ = build_sales_rows([sale('111', 2.0, 3, 5, 'Item 111'), sale('111', 2.5, 1, 20, 'Item 111'),
                                    sale('999', 1.0, 1, 7, 'Unknown thing')], [], [], [])
        run_file.rows_json = json.dumps(rows, default=str)
        run_file.source_type = 'sales'
        rule = BatchRule.query.first()
        batch.plan_file(run_file, rule, batch.user_configs(setup['run'].user_id), setup['service_for'])
        db.session.commit()

        setup['run'].status = 'running'
        db.session.commit()
        batch.execute_run(setup['run'].id, setup['service_for'], sleep=lambda s: None)

        invoice = setup['fakes'][setup['a']].invoices[1]
        assert [(l['ProductUPC'], l['UnitPrice'], l['QtyOrdered']) for l in invoice['lines']] == [
            ('111', 2.0, 3.0), ('111', 2.5, 1.0)]
        missing = json.loads(run_file.steps[0].preview_json)['missing_upcs']
        assert [(m['upc'], m['description']) for m in missing] == [('999', 'Unknown thing')]
