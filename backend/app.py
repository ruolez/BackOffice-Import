from flask import Flask, jsonify, request, session
from flask_cors import CORS
from flask_login import LoginManager, login_user, login_required, logout_user, current_user
from werkzeug.security import generate_password_hash, check_password_hash
import os
from datetime import datetime
import logging
from logging.handlers import RotatingFileHandler

# Import models and routes
from app.models import db, User, DatabaseConfig
from app.routes import auth, database_config, invoice, customer, purchase_order, supplier, invoice_copy, export, batch

def setup_file_logging():
    """Keep backend logs in the data volume so errors can be read after the fact"""
    logging.basicConfig(level=logging.INFO)
    log_dir = os.environ.get('LOG_DIR', '/app/data/logs')
    root = logging.getLogger()
    if any(isinstance(h, RotatingFileHandler) for h in root.handlers):
        return
    try:
        os.makedirs(log_dir, exist_ok=True)
        handler = RotatingFileHandler(os.path.join(log_dir, 'backend.log'), maxBytes=5 * 1024 * 1024, backupCount=5)
    except OSError as e:
        print(f"File logging disabled: {e}")
        return
    handler.setLevel(logging.INFO)
    handler.setFormatter(logging.Formatter('%(asctime)s %(levelname)s %(name)s: %(message)s'))
    root.addHandler(handler)
    root.setLevel(logging.INFO)

def create_app():
    setup_file_logging()
    app = Flask(__name__)
    
    # Configuration
    app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'dev-secret-key-change-in-production')
    app.config['SQLALCHEMY_DATABASE_URI'] = os.environ.get('DATABASE_URL', 'sqlite:////app/data/backoffice.db')
    app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
    app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024  # 16MB max file size
    
    # Initialize extensions
    db.init_app(app)
    CORS(app)
    
    # Setup login manager
    login_manager = LoginManager()
    login_manager.init_app(app)
    login_manager.login_view = 'auth.login'
    
    @login_manager.user_loader
    def load_user(user_id):
        return User.query.get(int(user_id))
    
    # Register blueprints
    app.register_blueprint(auth.bp, url_prefix='/api/auth')
    app.register_blueprint(database_config.bp, url_prefix='/api/database')
    app.register_blueprint(invoice.bp, url_prefix='/api/invoice')
    app.register_blueprint(customer.bp, url_prefix='/api/customer')
    app.register_blueprint(purchase_order.bp, url_prefix='/api/po')
    app.register_blueprint(supplier.bp, url_prefix='/api/supplier')
    app.register_blueprint(invoice_copy.bp, url_prefix='/api/invoice-copy')
    app.register_blueprint(export.bp, url_prefix='/api/export')
    app.register_blueprint(batch.bp, url_prefix='/api/batch')

    # Create tables and run migrations
    with app.app_context():
        db.create_all()
        
        # Run migrations
        from app.utils.migrations import run_migrations
        run_migrations()
        
        # Create default admin user if not exists
        if not User.query.filter_by(username='admin').first():
            admin = User(
                username='admin',
                email='admin@example.com'
            )
            admin.set_password('admin123')
            db.session.add(admin)
            db.session.commit()
            print("Default admin user created: admin / admin123")

        from app.services.batch_service import recover_interrupted_runs
        recover_interrupted_runs()
    
    # Health check endpoint
    @app.route('/api/health')
    def health_check():
        return jsonify({'status': 'healthy', 'timestamp': datetime.utcnow().isoformat()})
    
    # Setup logging
    logging.basicConfig(level=logging.INFO)
    app.logger.info('BackOffice Invoice application started')
    
    return app

if __name__ == '__main__':
    app = create_app()
    app.run(host='0.0.0.0', port=8000, debug=True)