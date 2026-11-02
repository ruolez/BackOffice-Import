import json

import pytest
from flask import Flask

from app.models import db, User, DatabaseConfig, BatchRule, BatchRun, BatchRunFile, BatchLog
from app.services import batch_service as batch
from app.services.batch_service import match_rule_for_filename, validate_rule, project_document_numbers


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
        self.items = {i['ProductUPC']: i for i in items}
        self.customers = {c['CustomerID']: c for c in customers}
        self.suppliers = {s['SupplierID']: s for s in suppliers}
        self.next_invoice = next_invoice
        self.next_po = next_po
        self.invoices = {}
        self.pos = {}

    def get_customer_by_id(self, customer_id):
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
        doc_id = len(self.invoices) + 1
        self.invoices[doc_id] = {'header': header, 'lines': lines}
        self.next_invoice = int(header['invoice_number']) + 1
        return True, doc_id, 'ok'

    def create_purchase_order(self, header, lines):
        doc_id = len(self.pos) + 1
        self.pos[doc_id] = {'header': header, 'lines': lines}
        self.next_po = int(header['po_number']) + 1
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
    return {'run': run, 'file': run_file, 'fakes': fakes, 'a': db_a.id, 'b': db_b.id, 'service_for': service_for}


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
        setup['run'].status = 'running'
        db.session.commit()

        batch.execute_run(setup['run'].id, setup['service_for'])

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
        setup['run'].status = 'running'
        db.session.commit()

        batch.execute_run(setup['run'].id, setup['service_for'])

        assert statuses(setup['file']) == [('inv', 'failed', None), ('cp', 'blocked', None), ('po', 'success', '70')]
        assert setup['run'].status == 'completed_with_errors'
        assert [log.message for log in BatchLog.query.filter_by(level='error')] == [
            'acme.xlsx › Invoice → DB-A: Customer with ID 5 not found'
        ]

        fakes[setup['a']].customers[5] = CUSTOMER_A
        setup['run'].status = 'running'
        db.session.commit()
        batch.execute_run(setup['run'].id, setup['service_for'])

        assert statuses(setup['file']) == [('inv', 'success', '500'), ('cp', 'success', '90'), ('po', 'success', '70')]
        assert (len(fakes[setup['a']].invoices), len(fakes[setup['a']].pos), len(fakes[setup['b']].invoices)) == (1, 1, 1)

    def test_copy_with_unknown_customer_fails_without_adding_products(self, setup):
        fakes = setup['fakes']
        del fakes[setup['b']].customers[8]
        setup['run'].status = 'running'
        db.session.commit()

        batch.execute_run(setup['run'].id, setup['service_for'])

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
        setup['run'].status = 'running'
        db.session.commit()

        batch.execute_run(setup['run'].id, setup['service_for'])

        assert statuses(setup['file'])[2] == ('po', 'excluded', None)
        assert (setup['fakes'][setup['a']].pos, setup['run'].status) == ({}, 'completed')
