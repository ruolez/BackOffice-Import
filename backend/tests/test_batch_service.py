import json

import pytest
from flask import Flask

from app.models import db, User, DatabaseConfig, BatchRule, BatchRun, BatchRunFile, BatchLog
from app.services import batch_service as batch
from app.services.batch_service import match_rule_for_filename, validate_rule, project_document_numbers, is_transient_error
from app.services.batch_report import build_run_report, build_report_excel

LINK_FAILURE = "Database error: ('08S01', '[08S01] [Microsoft][ODBC Driver 18 for SQL Server]Communication link failure')"


class TestMatchRuleForFilename:
    RULES = [
        {'id': 1, 'match_text': 'acme'},
        {'id': 2, 'match_text': 'Acme West'},
        {'id': 3, 'match_text': ''},
    ]

    @pytest.mark.parametrize('filename, expected_id', [
        ('Sales Report - ACME - October.xlsx', 1),
        ('sales report acme west oct.xlsx', 2),
        ('Globex October.xlsx', None),
    ])
    def test_longest_case_insensitive_match_wins(self, filename, expected_id):
        rule = match_rule_for_filename(filename, self.RULES)
        assert (rule['id'] if rule else None) == expected_id


class TestValidateRule:
    DBS = {10, 20}

    def step(self, key, type_, db_id=10, party=5, source=None):
        step = {'id': key, 'type': type_, 'database_config_id': db_id, 'party_id': party, 'party_label': ''}
        if source is not None:
            step['source_step_id'] = source
        return step

    def test_complete_rule_has_no_errors(self):
        steps = [self.step('a', 'invoice'), self.step('b', 'copy', db_id=20, source='a'), self.step('c', 'po')]
        assert validate_rule('Acme', steps, self.DBS) == []

    @pytest.mark.parametrize('steps, expected', [
        ([], ['Rule name is required', 'Add at least one step']),
        ([{'id': 'a', 'type': 'invoice', 'database_config_id': 99, 'party_id': None}],
         ['Rule name is required', 'Step 1: choose a database', 'Step 1: choose a customer']),
    ])
    def test_reports_missing_fields(self, steps, expected):
        assert validate_rule('  ', steps, self.DBS) == expected

    @pytest.mark.parametrize('steps, expected', [
        ([{'id': 'b', 'type': 'copy', 'database_config_id': 20, 'party_id': 5, 'source_step_id': 'a'},
          {'id': 'a', 'type': 'invoice', 'database_config_id': 10, 'party_id': 5}],
         ['Step 1: a copy must use an invoice step listed above it']),
        ([{'id': 'a', 'type': 'po', 'database_config_id': 10, 'party_id': 5},
          {'id': 'b', 'type': 'copy', 'database_config_id': 20, 'party_id': 5, 'source_step_id': 'a'}],
         ['Step 2: a copy must use an invoice step listed above it']),
    ], ids=['source-after-copy', 'source-is-po'])
    def test_copy_must_reference_an_earlier_invoice_step(self, steps, expected):
        assert validate_rule('Acme', steps, self.DBS) == expected


class TestIsTransientError:
    @pytest.mark.parametrize('message', [
        LINK_FAILURE,
        "Connection failed: ('HYT00', '[HYT00] [Microsoft][ODBC Driver 18 for SQL Server]Login timeout expired')",
        "Database error: ('40001', '[40001] Transaction (Process ID 61) was deadlocked on lock resources')",
        "Connection failed: ('08001', '[08001] [FreeTDS][SQL Server]Unable to connect: Adaptive Server is unavailable')",
    ])
    def test_connection_timeout_and_deadlock_errors_are_retried(self, message):
        assert is_transient_error(message) is True

    @pytest.mark.parametrize('message', [
        'Customer with ID 5 not found',
        "Database error: ('22001', '[22001] String or binary data would be truncated')",
        "Connection failed: ('28000', \"[28000] Login failed for user 'sa'\")",
        '',
    ])
    def test_data_and_login_errors_are_not_retried(self, message):
        assert is_transient_error(message) is False


class TestProjectDocumentNumbers:
    def test_steps_sharing_a_series_get_consecutive_numbers(self):
        steps = [
            {'id': 1, 'type': 'invoice', 'database_config_id': 10, 'status': 'pending', 'base_number': 500},
            {'id': 2, 'type': 'copy', 'database_config_id': 20, 'status': 'pending', 'base_number': 90},
            {'id': 3, 'type': 'po', 'database_config_id': 10, 'status': 'pending', 'base_number': 7},
            {'id': 4, 'type': 'invoice', 'database_config_id': 10, 'status': 'excluded', 'base_number': 500},
            {'id': 5, 'type': 'invoice', 'database_config_id': 10, 'status': 'failed', 'base_number': 500},
            {'id': 6, 'type': 'copy', 'database_config_id': 20, 'status': 'success', 'base_number': 90},
            {'id': 7, 'type': 'po', 'database_config_id': 10, 'status': 'pending', 'base_number': None},
        ]
        assert project_document_numbers(steps) == {1: 500, 2: 90, 3: 7, 5: 501}

    def test_a_higher_later_base_number_moves_the_series_forward(self):
        steps = [
            {'id': 1, 'type': 'invoice', 'database_config_id': 10, 'status': 'pending', 'base_number': 500},
            {'id': 2, 'type': 'invoice', 'database_config_id': 10, 'status': 'pending', 'base_number': 510},
        ]
        assert project_document_numbers(steps) == {1: 500, 2: 510}


def make_item(upc, product_id):
    return {
        'ProductID': product_id, 'CateID': 1, 'SubCateID': 2, 'ProductSKU': f'SKU{upc}', 'ProductUPC': upc,
        'ProductDescription': f'Item {upc}', 'ItemSize': '', 'UnitPrice': 3.0, 'UnitCost': 1.5,
        'ItemWeight': 0.5, 'ItemTaxID': 0, 'SPPromoted': False, 'SPPromotionDescription': '',
        'ProductMessage': '', 'UnitDesc': 'EA', 'CountInUnit': 1, 'SupplierSKU': '',
    }


class FakeBackOffice:
    """In-memory stand-in for one SQL Server database (DatabaseService interface)"""

    def __init__(self, items=(), customers=(), suppliers=(), next_invoice=100, next_po=1):
        # failures[method] = list of outcomes for the next calls: an error message, or
        # ('saved', message) to store the document and still report the error (connection lost after commit)
        self.failures = {}
        self.reachable = True
        self.items = {i['ProductUPC']: i for i in items}
        self.customers = {c['CustomerID']: c for c in customers}
        self.suppliers = {s['SupplierID']: s for s in suppliers}
        self.next_invoice = next_invoice
        self.next_po = next_po
        self.invoices = {}
        self.pos = {}

    def _injected(self, method):
        queue = self.failures.get(method)
        return queue.pop(0) if queue else None

    def test_connection(self):
        return (True, 'Connection successful') if self.reachable else (False, f'Connection failed: {LINK_FAILURE}')

    def find_invoices_by_number(self, number):
        return True, [{'id': i, 'party_id': d['header']['customer_id'], 'total': d['header']['invoice_total'],
                       'lines': d['header']['no_lines']} for i, d in self.invoices.items()
                      if str(d['header']['invoice_number']) == str(number)], 'ok'

    def find_purchase_orders_by_number(self, number):
        return True, [{'id': i, 'party_id': d['header']['supplier_id'], 'total': d['header']['po_total'],
                       'lines': d['header']['no_lines']} for i, d in self.pos.items()
                      if str(d['header']['po_number']) == str(number)], 'ok'

    def get_customer_by_id(self, customer_id):
        if not self.reachable:
            return False, {}, f'Database query failed: {LINK_FAILURE}'
        c = self.customers.get(customer_id)
        return (True, c, 'ok') if c else (False, {}, f'Customer with ID {customer_id} not found')

    def get_supplier_by_id(self, supplier_id):
        s = self.suppliers.get(supplier_id)
        return (True, s, 'ok') if s else (False, {}, f'Supplier with ID {supplier_id} not found')

    def get_items_by_upcs(self, upcs):
        return True, [dict(self.items[u]) for u in dict.fromkeys(upcs) if u in self.items], 'ok'

    def get_full_items_by_upcs(self, upcs):
        return True, [{k: v for k, v in self.items[u].items() if k != 'ProductID'} for u in upcs if u in self.items], 'ok'

    def insert_items(self, items):
        for item in items:
            self.items[item['ProductUPC']] = {**item, 'ProductID': 1000 + len(self.items)}
        return True, len(items), 'ok'

    def get_next_invoice_number(self):
        return True, self.next_invoice, 'ok'

    def get_next_po_number(self):
        return True, self.next_po, 'ok'

    def create_invoice(self, header, lines):
        return self._create(self.invoices, 'create_invoice', header, lines, 'invoice_number', 'next_invoice')

    def create_purchase_order(self, header, lines):
        return self._create(self.pos, 'create_purchase_order', header, lines, 'po_number', 'next_po')

    def _create(self, store, method, header, lines, number_key, counter):
        outcome = self._injected(method)
        if isinstance(outcome, str):
            return False, 0, outcome
        doc_id = len(store) + 1
        store[doc_id] = {'header': header, 'lines': lines}
        setattr(self, counter, int(header[number_key]) + 1)
        if outcome:
            return False, 0, outcome[1]
        return True, doc_id, 'ok'

    def get_invoice_with_details(self, invoice_id):
        inv = self.invoices.get(invoice_id)
        if not inv:
            return False, {}, 'not found'
        return True, {'invoice': inv['header'], 'details': inv['lines']}, 'ok'


CUSTOMER_A = {'CustomerID': 5, 'AccountNo': 'ACM', 'BusinessName': 'Acme'}
CUSTOMER_B = {'CustomerID': 8, 'AccountNo': 'ACM-B', 'BusinessName': 'Acme (B)'}
SUPPLIER_A = {'SupplierID': 3, 'AccountNo': 'SUP', 'BusinessName': 'Supplier Co'}
ROWS = [
    {'UPC': '111', 'Cost': 4.0, 'QTY': 2.0, 'row_number': 1},
    {'UPC': '222', 'Cost': 6.0, 'QTY': 1.0, 'row_number': 2},
    {'UPC': '999', 'Cost': 1.0, 'QTY': 5.0, 'row_number': 3},
]


@pytest.fixture
def app():
    app = Flask(__name__)
    app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///:memory:'
    db.init_app(app)
    with app.app_context():
        db.create_all()
        yield app
        db.session.remove()
        db.drop_all()


@pytest.fixture
def setup(app):
    user = User(username='u', email='u@example.com')
    user.set_password('x')
    db.session.add(user)
    db.session.flush()
    db_a = DatabaseConfig(user_id=user.id, name='DB-A', server='s', database='a', username='x', password='x')
    db_b = DatabaseConfig(user_id=user.id, name='DB-B', server='s', database='b', username='x', password='x')
    db.session.add_all([db_a, db_b])
    db.session.flush()

    fakes = {
        db_a.id: FakeBackOffice(items=[make_item('111', 1), make_item('222', 2)],
                                customers=[CUSTOMER_A], suppliers=[SUPPLIER_A], next_invoice=500, next_po=70),
        db_b.id: FakeBackOffice(items=[make_item('111', 11)], customers=[CUSTOMER_B], next_invoice=90),
    }
    steps = [
        {'id': 'inv', 'type': 'invoice', 'database_config_id': db_a.id, 'party_id': 5, 'party_label': 'ACM'},
        {'id': 'cp', 'type': 'copy', 'database_config_id': db_b.id, 'party_id': 8, 'party_label': 'ACM-B',
         'source_step_id': 'inv'},
        {'id': 'po', 'type': 'po', 'database_config_id': db_a.id, 'party_id': 3, 'party_label': 'SUP'},
    ]
    rule = BatchRule(user_id=user.id, name='Acme', match_text='acme', steps_json=json.dumps(steps))
    run = BatchRun(user_id=user.id, status='draft')
    db.session.add_all([rule, run])
    db.session.flush()
    run_file = BatchRunFile(run_id=run.id, filename='acme.xlsx', rows_json=json.dumps(ROWS))
    run.files.append(run_file)
    db.session.commit()

    service_for = lambda config: fakes[config.id]
    batch.plan_file(run_file, rule, batch.user_configs(user.id), service_for)
    db.session.commit()
    return {'run': run, 'file': run_file, 'fakes': fakes, 'a': db_a.id, 'b': db_b.id, 'service_for': service_for,
            'sleeps': []}


def run_now(setup):
    setup['run'].status = 'running'
    db.session.commit()
    batch.execute_run(setup['run'].id, setup['service_for'], sleep=setup['sleeps'].append)


def statuses(run_file):
    return [(s.step_key, s.status, s.doc_number) for s in run_file.steps]


class TestPlanAndExecute:
    def test_preview_writes_nothing_and_counts_products_the_copy_will_add(self, setup):
        fakes, run_file = setup['fakes'], setup['file']
        previews = {s.step_key: json.loads(s.preview_json) for s in run_file.steps}

        assert (fakes[setup['a']].invoices, fakes[setup['b']].invoices, '222' in fakes[setup['b']].items) == ({}, {}, False)
        assert [(k, p['lines'], p['total'], [m['upc'] for m in p['missing_upcs']], p['products_added'])
                for k, p in previews.items()] == [
            ('inv', 2, 14.0, ['999'], 0),
            ('cp', 2, 14.0, [], 1),
            ('po', 2, 14.0, ['999'], 0),
        ]

    def test_run_creates_invoice_copy_and_po_in_the_right_databases(self, setup):
        fakes = setup['fakes']

        run_now(setup)

        copied = fakes[setup['b']].invoices[1]
        assert statuses(setup['file']) == [('inv', 'success', '500'), ('cp', 'success', '90'), ('po', 'success', '70')]
        assert setup['run'].status == 'completed'
        assert (copied['header']['customer_id'], copied['header']['invoice_title'],
                [(l['ProductUPC'], l['UnitPrice'], l['QtyOrdered']) for l in copied['lines']]) == (
            8, 'Copy of Invoice #500', [('111', 4.0, 2.0), ('222', 6.0, 1.0)])
        assert '222' in fakes[setup['b']].items

    def test_failed_invoice_blocks_its_copy_and_retry_creates_only_what_is_missing(self, setup):
        fakes = setup['fakes']
        del fakes[setup['a']].customers[5]

        run_now(setup)

        assert statuses(setup['file']) == [('inv', 'failed', None), ('cp', 'blocked', None), ('po', 'success', '70')]
        assert setup['run'].status == 'completed_with_errors'
        assert [log.message for log in BatchLog.query.filter_by(level='error')] == [
            'acme.xlsx › Invoice → DB-A: Customer with ID 5 not found'
        ]

        fakes[setup['a']].customers[5] = CUSTOMER_A
        run_now(setup)

        assert statuses(setup['file']) == [('inv', 'success', '500'), ('cp', 'success', '90'), ('po', 'success', '70')]
        assert (len(fakes[setup['a']].invoices), len(fakes[setup['a']].pos), len(fakes[setup['b']].invoices)) == (1, 1, 1)

    def test_copy_with_unknown_customer_fails_without_adding_products(self, setup):
        fakes = setup['fakes']
        del fakes[setup['b']].customers[8]

        run_now(setup)

        assert statuses(setup['file'])[1] == ('cp', 'failed', None)
        assert (sorted(fakes[setup['b']].items), fakes[setup['b']].invoices) == (['111'], {})

    def test_step_whose_preview_fails_starts_excluded_along_with_its_copy(self, setup):
        fakes = setup['fakes']
        del fakes[setup['a']].customers[5]
        rule = BatchRule.query.first()

        batch.plan_file(setup['file'], rule, batch.user_configs(setup['run'].user_id), setup['service_for'])

        assert [(s.step_key, s.status, s.message) for s in setup['file'].steps] == [
            ('inv', 'excluded', 'Customer with ID 5 not found'),
            ('cp', 'excluded', 'The invoice it copies could not be prepared'),
            ('po', 'pending', None),
        ]

    def test_excluded_steps_are_not_created(self, setup):
        po_step = setup['file'].steps[2]
        po_step.status = 'excluded'

        run_now(setup)

        assert statuses(setup['file'])[2] == ('po', 'excluded', None)
        assert (setup['fakes'][setup['a']].pos, setup['run'].status) == ({}, 'completed')


class TestRetriesAndSafety:
    def test_temporary_error_is_retried_and_the_document_created_once(self, setup):
        fake_a = setup['fakes'][setup['a']]
        fake_a.failures['create_invoice'] = [LINK_FAILURE]

        run_now(setup)

        assert statuses(setup['file'])[0] == ('inv', 'success', '500')
        assert (len(fake_a.invoices), setup['file'].steps[0].attempts, setup['sleeps']) == (1, 2, [3])

    def test_saved_but_unacknowledged_create_is_found_instead_of_duplicated(self, setup):
        fake_a = setup['fakes'][setup['a']]
        fake_a.failures['create_invoice'] = [('saved', LINK_FAILURE)]

        run_now(setup)

        step = setup['file'].steps[0]
        assert (step.status, step.doc_number, step.doc_id, len(fake_a.invoices)) == ('success', '500', 1, 1)
        assert json.loads(step.preview_json)['recovered'] is True
        assert statuses(setup['file'])[1:] == [('cp', 'success', '90'), ('po', 'success', '70')]

    def test_interrupted_step_that_was_saved_is_not_created_again(self, setup):
        fake_a = setup['fakes'][setup['a']]
        fake_a.failures['create_invoice'] = [('saved', 'Unexpected error: worker killed')]
        run_now(setup)
        step = setup['file'].steps[0]
        assert step.status == 'failed'
        step.status = 'interrupted'
        db.session.commit()

        run_now(setup)

        assert (step.status, step.doc_number, len(fake_a.invoices)) == ('success', '500', 1)

    def test_permanent_error_is_not_retried(self, setup):
        fake_a = setup['fakes'][setup['a']]
        fake_a.failures['create_invoice'] = ["Database error: ('22001', 'String or binary data would be truncated')"]

        run_now(setup)

        assert (statuses(setup['file'])[0], setup['file'].steps[0].attempts, setup['sleeps']) == (
            ('inv', 'failed', None), 1, [])

    def test_unreachable_database_at_start_creates_nothing(self, setup):
        setup['fakes'][setup['b']].reachable = False

        run_now(setup)

        assert (setup['run'].status, setup['fakes'][setup['a']].invoices) == ('draft', {})
        assert [s.status for s in setup['file'].steps] == ['pending', 'pending', 'pending']
        assert setup['run'].notice.startswith('Nothing was created: could not connect to DB-B.')

    def test_database_that_goes_down_mid_run_is_not_tried_again(self, setup):
        fake_b = setup['fakes'][setup['b']]
        rule = BatchRule.query.first()
        second = BatchRunFile(run_id=setup['run'].id, position=1, filename='acme-2.xlsx', rows_json=json.dumps(ROWS))
        setup['run'].files.append(second)
        db.session.flush()
        batch.plan_file(second, rule, batch.user_configs(setup['run'].user_id), setup['service_for'])
        db.session.commit()
        original_insert = fake_b.insert_items

        def insert_then_go_down(items):
            fake_b.reachable = False
            return False, 0, f'Database error: {LINK_FAILURE}'
        fake_b.insert_items = insert_then_go_down

        run_now(setup)

        assert [s.status for s in second.steps] == ['success', 'failed', 'success']
        assert second.steps[1].message == 'Not attempted: DB-B stopped responding during this run'
        assert setup['file'].steps[1].attempts == 3
        assert second.steps[1].attempts == 0
        fake_b.insert_items = original_insert

    def test_cancel_stops_before_the_next_document(self, setup):
        fake_a = setup['fakes'][setup['a']]
        original = fake_a.create_invoice

        def create_and_cancel(header, lines):
            setup['run'].cancel_requested = True
            db.session.commit()
            return original(header, lines)
        fake_a.create_invoice = create_and_cancel

        run_now(setup)

        assert statuses(setup['file']) == [('inv', 'success', '500'), ('cp', 'pending', None), ('po', 'pending', None)]
        assert setup['run'].status == 'cancelled'


class TestRunReport:
    def test_report_lists_created_documents_by_database_and_what_was_not_created(self, setup):
        setup['file'].steps[2].status = 'excluded'
        db.session.commit()
        run_now(setup)

        report = build_run_report(batch.serialize_run(setup['run']))

        assert [(d['database'], d['type'], d['number'], d['party'], d['total'], d['copied_from'])
                for d in report['documents']] == [
            ('DB-A', 'invoice', '500', 'Acme', 14.0, ''),
            ('DB-B', 'copy', '90', 'Acme (B)', 14.0, '#500 in DB-A'),
        ]
        assert [(g['database'], [(s['label'], s['count'], s['first'], s['last']) for s in g['sections']])
                for g in report['by_database']] == [
            ('DB-A', [('Invoices', 1, '500', '500')]),
            ('DB-B', [('Invoice copies', 1, '90', '90')]),
        ]
        assert [(p['document'], p['status']) for p in report['not_created']] == [('Purchase order', 'Skipped')]
        assert [(u['document'], u['upc']) for u in report['skipped_upcs']] == [('Invoice #500', '999')]

    def test_excel_report_has_one_row_per_created_document(self, setup):
        from openpyxl import load_workbook
        run_now(setup)

        workbook = load_workbook(build_report_excel(build_run_report(batch.serialize_run(setup['run']))))

        rows = list(workbook['Documents'].iter_rows(min_row=2, values_only=True))
        assert workbook.sheetnames == ['Summary', 'Documents', 'Not created', 'Skipped UPCs']
        assert [(r[0], r[1], r[2]) for r in rows] == [
            ('DB-A', 'Invoice', '500'), ('DB-A', 'Purchase order', '70'), ('DB-B', 'Invoice copy', '90')]


class TestFinishedRunStatus:
    @pytest.mark.parametrize('statuses, expected', [
        (['success', 'success'], 'completed'),
        (['success', 'held'], 'on_hold'),
        (['success', 'held', 'failed'], 'completed_with_errors'),
        (['success', 'blocked'], 'completed_with_errors'),
        ([], 'completed'),
    ])
    def test_held_documents_leave_the_run_waiting_and_failures_win(self, statuses, expected):
        assert batch.finished_run_status(statuses) == expected


class TestHoldForLater:
    def test_holding_an_invoice_holds_its_copy_and_the_rest_is_created(self, setup):
        changed = batch.set_step_hold(setup['file'].steps[0], True)
        db.session.commit()

        run_now(setup)

        assert [s.step_key for s in changed] == ['inv', 'cp']
        assert statuses(setup['file']) == [('inv', 'held', None), ('cp', 'held', None), ('po', 'success', '70')]
        assert setup['run'].status == 'on_hold'

    def test_released_documents_are_created_in_a_later_run_without_touching_the_rest(self, setup):
        batch.set_step_hold(setup['file'].steps[0], True)
        db.session.commit()
        run_now(setup)

        batch.set_step_hold(setup['file'].steps[0], False)
        db.session.commit()
        run_now(setup)

        assert statuses(setup['file']) == [('inv', 'success', '500'), ('cp', 'success', '90'), ('po', 'success', '70')]
        assert (setup['run'].status, len(setup['fakes'][setup['a']].pos)) == ('completed', 1)

    def test_report_lists_held_documents_as_on_hold(self, setup):
        batch.set_step_hold(setup['file'].steps[2], True)
        db.session.commit()
        run_now(setup)

        report = build_run_report(batch.serialize_run(setup['run']))

        assert ([(p['document'], p['status'], p['reason']) for p in report['not_created']], report['on_hold']) == (
            [('Purchase order', 'On hold', 'Put on hold for later')], 1)


class TestRecheck:
    def test_recheck_picks_up_a_product_added_after_the_preview(self, setup):
        setup['fakes'][setup['a']].items['999'] = make_item('999', 9)

        batch.preview_file(setup['file'], batch.user_configs(setup['run'].user_id), setup['service_for'])

        previews = [json.loads(s.preview_json) for s in setup['file'].steps]
        assert [(p['lines'], p['missing_upcs']) for p in previews] == [(3, []), (3, []), (3, [])]

    def test_recheck_ticks_again_a_step_that_was_unticked_only_because_it_failed(self, setup):
        fakes, configs = setup['fakes'], batch.user_configs(setup['run'].user_id)
        del fakes[setup['a']].customers[5]
        batch.preview_file(setup['file'], configs, setup['service_for'])
        setup['file'].steps[2].status = 'excluded'
        assert [s.status for s in setup['file'].steps] == ['excluded', 'excluded', 'excluded']

        fakes[setup['a']].customers[5] = CUSTOMER_A
        batch.preview_file(setup['file'], configs, setup['service_for'])

        assert [(s.status, s.message) for s in setup['file'].steps] == [
            ('pending', None), ('pending', None), ('excluded', None)]

    def test_recheck_after_a_run_keeps_created_documents_and_uses_them_for_copies(self, setup):
        fake_b = setup['fakes'][setup['b']]
        del fake_b.customers[8]
        run_now(setup)
        assert statuses(setup['file']) == [('inv', 'success', '500'), ('cp', 'failed', None), ('po', 'success', '70')]

        fake_b.customers[8] = CUSTOMER_B
        checked = batch.preview_file(setup['file'], batch.user_configs(setup['run'].user_id), setup['service_for'])

        copy_preview = json.loads(setup['file'].steps[1].preview_json)
        assert (checked, copy_preview['lines'], copy_preview['total'], copy_preview['products_added']) == (1, 2, 14.0, 1)
        assert statuses(setup['file']) == [('inv', 'success', '500'), ('cp', 'failed', None), ('po', 'success', '70')]


class TestProductsAddedByAnEarlierCopy:
    @pytest.fixture
    def with_po_after_copy(self, setup):
        """The rule also makes a PO in DB-B after the copy; DB-B lacks 222, which the copy adds"""
        setup['fakes'][setup['b']].suppliers = {3: SUPPLIER_A}
        rule = BatchRule.query.first()
        rule.steps_json = json.dumps(json.loads(rule.steps_json) + [
            {'id': 'po_b', 'type': 'po', 'database_config_id': setup['b'], 'party_id': 3, 'party_label': 'SUP'}])
        batch.plan_file(setup['file'], rule, batch.user_configs(setup['run'].user_id), setup['service_for'])
        db.session.commit()
        return setup

    def po_b_preview(self, setup):
        step = next(s for s in setup['file'].steps if s.step_key == 'po_b')
        preview = json.loads(step.preview_json)
        return (preview['lines'], [m['upc'] for m in preview['missing_upcs']],
                [(m['upc'], m['step_key']) for m in preview['from_copy']])

    def test_products_the_copy_adds_first_are_not_reported_missing(self, with_po_after_copy):
        assert self.po_b_preview(with_po_after_copy) == (2, ['999'], [('222', 'cp')])

    def test_products_count_as_missing_again_when_the_copy_will_not_run(self, with_po_after_copy):
        copy = next(s for s in with_po_after_copy['file'].steps if s.step_key == 'cp')
        batch.set_step_hold(copy, True)
        batch.preview_file(with_po_after_copy['file'], batch.user_configs(with_po_after_copy['run'].user_id),
                           with_po_after_copy['service_for'])

        assert self.po_b_preview(with_po_after_copy) == (1, ['222', '999'], [])

    def test_the_po_includes_the_products_the_copy_added(self, with_po_after_copy):
        run_now(with_po_after_copy)

        po = with_po_after_copy['fakes'][with_po_after_copy['b']].pos
        assert [l['ProductUPC'] for d in po.values() for l in d['lines']] == ['111', '222']

    def test_products_count_as_missing_when_the_invoice_the_copy_copies_is_unticked(self, with_po_after_copy):
        invoice = next(s for s in with_po_after_copy['file'].steps if s.step_key == 'inv')
        invoice.status = 'excluded'
        batch.preview_file(with_po_after_copy['file'], batch.user_configs(with_po_after_copy['run'].user_id),
                           with_po_after_copy['service_for'])

        assert self.po_b_preview(with_po_after_copy) == (1, ['222', '999'], [])
