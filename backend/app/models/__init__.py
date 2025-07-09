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