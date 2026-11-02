from flask_sqlalchemy import SQLAlchemy
from flask_login import UserMixin
from datetime import datetime
from werkzeug.security import generate_password_hash, check_password_hash

db = SQLAlchemy()

class User(UserMixin, db.Model):
    __tablename__ = 'users'
    
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False)
    email = db.Column(db.String(120), unique=True, nullable=False)
    password_hash = db.Column(db.String(128), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    # Relationship to database configs
    database_configs = db.relationship('DatabaseConfig', backref='user', lazy=True, cascade='all, delete-orphan')
    
    def set_password(self, password):
        self.password_hash = generate_password_hash(password)
    
    def check_password(self, password):
        return check_password_hash(self.password_hash, password)
    
    def __repr__(self):
        return f'<User {self.username}>'

class DatabaseConfig(db.Model):
    __tablename__ = 'database_configs'
    
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    name = db.Column(db.String(100), nullable=False)
    server = db.Column(db.String(200), nullable=False)
    database = db.Column(db.String(100), nullable=False)
    username = db.Column(db.String(100), nullable=False)
    password = db.Column(db.String(200), nullable=False)  # Will be encrypted
    port = db.Column(db.Integer, default=1433)
    driver = db.Column(db.String(100), default='ODBC Driver 18 for SQL Server')
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    last_tested = db.Column(db.DateTime)
    is_active = db.Column(db.Boolean, default=True)
    # Connection security options
    encrypt_connection = db.Column(db.Boolean, default=True)
    trust_server_certificate = db.Column(db.Boolean, default=True)
    tls_min_protocol = db.Column(db.String(20), nullable=True)  # Optional: 'TLSv1.0', 'TLSv1.1', 'TLSv1.2'
    
    def __repr__(self):
        return f'<DatabaseConfig {self.name}>'
    
    def get_connection_string(self):
        return f"mssql+pyodbc://{self.username}:{self.password}@{self.server}:{self.port}/{self.database}?driver={self.driver}"

class BatchRule(db.Model):
    """A saved recipe: which documents to create from one kind of sales report file"""
    __tablename__ = 'batch_rules'

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    name = db.Column(db.String(100), nullable=False)
    match_text = db.Column(db.String(200), default='')
    steps_json = db.Column(db.Text, nullable=False, default='[]')
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class BatchRun(db.Model):
    __tablename__ = 'batch_runs'

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    # draft -> running -> completed | completed_with_errors | cancelled | interrupted
    status = db.Column(db.String(30), nullable=False, default='draft')
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    started_at = db.Column(db.DateTime)
    finished_at = db.Column(db.DateTime)
    cancel_requested = db.Column(db.Boolean, default=False)
    # Why the last start attempt did not run (e.g. a database was unreachable)
    notice = db.Column(db.Text)

    files = db.relationship('BatchRunFile', backref='run', lazy=True, cascade='all, delete-orphan',
                            order_by='BatchRunFile.position')
    logs = db.relationship('BatchLog', backref='run', lazy=True, cascade='all, delete-orphan',
                           order_by='BatchLog.id')


class BatchRunFile(db.Model):
    __tablename__ = 'batch_run_files'

    id = db.Column(db.Integer, primary_key=True)
    run_id = db.Column(db.Integer, db.ForeignKey('batch_runs.id'), nullable=False)
    position = db.Column(db.Integer, nullable=False, default=0)
    filename = db.Column(db.String(255), nullable=False)
    sha256 = db.Column(db.String(64))
    # Not a foreign key: deleting a rule must not break the history of runs that used it
    rule_id = db.Column(db.Integer)
    rule_name = db.Column(db.String(100))
    rows_json = db.Column(db.Text, nullable=False, default='[]')
    error = db.Column(db.Text)
    warnings_json = db.Column(db.Text, default='[]')
    # 'excel' (uploaded file) or 'sales' (pulled from a store database with a sales preset)
    source_type = db.Column(db.String(20), default='excel')
    preset_id = db.Column(db.Integer)
    period = db.Column(db.String(7))  # YYYY-MM of the pulled sales
    source_json = db.Column(db.Text)  # what the pull found: counts, exclusions, credit memo notes

    steps = db.relationship('BatchRunStep', backref='run_file', lazy=True, cascade='all, delete-orphan',
                            order_by='BatchRunStep.position')


class BatchRunStep(db.Model):
    __tablename__ = 'batch_run_steps'

    id = db.Column(db.Integer, primary_key=True)
    run_file_id = db.Column(db.Integer, db.ForeignKey('batch_run_files.id'), nullable=False)
    run_id = db.Column(db.Integer, db.ForeignKey('batch_runs.id'), nullable=False)
    position = db.Column(db.Integer, nullable=False, default=0)
    step_key = db.Column(db.String(40), nullable=False)
    type = db.Column(db.String(20), nullable=False)  # invoice | po | copy
    database_config_id = db.Column(db.Integer)
    database_name = db.Column(db.String(100))
    party_id = db.Column(db.Integer)
    party_label = db.Column(db.String(255))
    source_step_key = db.Column(db.String(40))
    # pending | running | success | failed | blocked | excluded | interrupted
    status = db.Column(db.String(20), nullable=False, default='pending')
    preview_json = db.Column(db.Text, default='{}')
    base_number = db.Column(db.Integer)
    doc_number = db.Column(db.String(50))
    doc_id = db.Column(db.Integer)
    # Saved right before the insert, so a lost connection or restart can be checked against SQL Server
    attempted_number = db.Column(db.String(50))
    attempted_total = db.Column(db.Float)
    attempts = db.Column(db.Integer, default=0)
    message = db.Column(db.Text)
    started_at = db.Column(db.DateTime)
    finished_at = db.Column(db.DateTime)


class BatchLog(db.Model):
    __tablename__ = 'batch_logs'

    id = db.Column(db.Integer, primary_key=True)
    run_id = db.Column(db.Integer, db.ForeignKey('batch_runs.id'), nullable=False)
    run_file_id = db.Column(db.Integer)
    run_step_id = db.Column(db.Integer)
    level = db.Column(db.String(10), nullable=False, default='info')  # info | warning | error
    message = db.Column(db.Text, nullable=False)
    details = db.Column(db.Text)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)


class SalesPreset(db.Model):
    """Which sales of a store database to turn into documents: subcategories, exclusions and a default rule.
    The period is always the previous calendar month."""
    __tablename__ = 'sales_presets'

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    name = db.Column(db.String(100), nullable=False)
    source_config_id = db.Column(db.Integer, nullable=False)
    rule_id = db.Column(db.Integer)
    subcategory_ids_json = db.Column(db.Text, nullable=False, default='[]')
    # Every subcategory that existed when the preset was saved, to spot new ones later
    known_subcategory_ids_json = db.Column(db.Text, nullable=False, default='[]')
    exclude_upcs_json = db.Column(db.Text, nullable=False, default='[]')
    exclude_words_json = db.Column(db.Text, nullable=False, default='[]')
    exclude_accounts_json = db.Column(db.Text, nullable=False, default='[]')
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
