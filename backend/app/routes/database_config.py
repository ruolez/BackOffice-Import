from flask import Blueprint, request, jsonify
from flask_login import login_required, current_user
from app.models import db, DatabaseConfig
from app.services.database_service import DatabaseService
from datetime import datetime

bp = Blueprint('database_config', __name__)

@bp.route('/configs', methods=['GET'])
@login_required
def get_database_configs():
    try:
        configs = DatabaseConfig.query.filter_by(user_id=current_user.id).all()
        return jsonify({
            'configs': [{
                'id': config.id,
                'name': config.name,
                'server': config.server,
                'database': config.database,
                'username': config.username,
                'port': config.port,
                'driver': config.driver,
                'created_at': config.created_at.isoformat(),
                'last_tested': config.last_tested.isoformat() if config.last_tested else None,
                'is_active': config.is_active,
                'encrypt_connection': getattr(config, 'encrypt_connection', True),
                'trust_server_certificate': getattr(config, 'trust_server_certificate', True),
                'tls_min_protocol': getattr(config, 'tls_min_protocol', None),
                'has_password': bool(config.password)  # Indicate if password exists
            } for config in configs]
        }), 200
    except Exception as e:
        return jsonify({'error': 'Failed to get database configs', 'details': str(e)}), 500

@bp.route('/configs', methods=['POST'])
@login_required
def create_database_config():
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({'error': 'No data provided'}), 400
        
        # Validate required fields
        required_fields = ['name', 'server', 'database', 'username', 'password']
        for field in required_fields:
            if not data.get(field, '').strip():
                return jsonify({'error': f'{field.capitalize()} is required'}), 400
        
        # Check if name already exists for this user
        existing = DatabaseConfig.query.filter_by(
            user_id=current_user.id,
            name=data['name'].strip()
        ).first()
        
        if existing:
            return jsonify({'error': 'Database configuration name already exists'}), 409
        
        # Create new config
        config = DatabaseConfig(
            user_id=current_user.id,
            name=data['name'].strip(),
            server=data['server'].strip(),
            database=data['database'].strip(),
            username=data['username'].strip(),
            password=data['password'],  # TODO: Encrypt this
            port=data.get('port', 1433),
            driver=data.get('driver', 'ODBC Driver 18 for SQL Server').strip(),
            encrypt_connection=data.get('encrypt_connection', True),
            trust_server_certificate=data.get('trust_server_certificate', True),
            tls_min_protocol=data.get('tls_min_protocol', None)
        )
        
        db.session.add(config)
        db.session.commit()
        
        return jsonify({
            'message': 'Database configuration created successfully',
            'config': {
                'id': config.id,
                'name': config.name,
                'server': config.server,
                'database': config.database,
                'username': config.username,
                'port': config.port,
                'driver': config.driver,
                'created_at': config.created_at.isoformat(),
                'is_active': config.is_active
            }
        }), 201
        
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': 'Failed to create database config', 'details': str(e)}), 500

@bp.route('/configs/<int:config_id>', methods=['PUT'])
@login_required
def update_database_config(config_id):
    try:
        config = DatabaseConfig.query.filter_by(
            id=config_id,
            user_id=current_user.id
        ).first()
        
        if not config:
            return jsonify({'error': 'Database configuration not found'}), 404
        
        data = request.get_json()
        if not data:
            return jsonify({'error': 'No data provided'}), 400
        
        # Update fields
        if 'name' in data and data['name'].strip():
            # Check if new name conflicts with existing configs
            existing = DatabaseConfig.query.filter_by(
                user_id=current_user.id,
                name=data['name'].strip()
            ).filter(DatabaseConfig.id != config_id).first()
            
            if existing:
                return jsonify({'error': 'Database configuration name already exists'}), 409
            
            config.name = data['name'].strip()
        
        if 'server' in data and data['server'].strip():
            config.server = data['server'].strip()
        
        if 'database' in data and data['database'].strip():
            config.database = data['database'].strip()
        
        if 'username' in data and data['username'].strip():
            config.username = data['username'].strip()
        
        # Only update password if provided (for edits, empty means keep existing)
        if 'password' in data and data['password'].strip():
            config.password = data['password']  # TODO: Encrypt this
        
        if 'port' in data:
            config.port = data['port']
        
        if 'driver' in data and data['driver'].strip():
            config.driver = data['driver'].strip()
        
        if 'is_active' in data:
            config.is_active = data['is_active']
        
        # Update connection security options
        if 'encrypt_connection' in data:
            config.encrypt_connection = data['encrypt_connection']
        
        if 'trust_server_certificate' in data:
            config.trust_server_certificate = data['trust_server_certificate']
        
        if 'tls_min_protocol' in data:
            config.tls_min_protocol = data.get('tls_min_protocol', None)
        
        db.session.commit()
        
        return jsonify({
            'message': 'Database configuration updated successfully',
            'config': {
                'id': config.id,
                'name': config.name,
                'server': config.server,
                'database': config.database,
                'username': config.username,
                'port': config.port,
                'driver': config.driver,
                'created_at': config.created_at.isoformat(),
                'last_tested': config.last_tested.isoformat() if config.last_tested else None,
                'is_active': config.is_active
            }
        }), 200
        
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': 'Failed to update database config', 'details': str(e)}), 500

@bp.route('/configs/<int:config_id>', methods=['DELETE'])
@login_required
def delete_database_config(config_id):
    try:
        config = DatabaseConfig.query.filter_by(
            id=config_id,
            user_id=current_user.id
        ).first()
        
        if not config:
            return jsonify({'error': 'Database configuration not found'}), 404
        
        db.session.delete(config)
        db.session.commit()
        
        return jsonify({'message': 'Database configuration deleted successfully'}), 200
        
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': 'Failed to delete database config', 'details': str(e)}), 500

@bp.route('/configs/<int:config_id>/test', methods=['POST'])
@login_required
def test_database_config(config_id):
    try:
        config = DatabaseConfig.query.filter_by(
            id=config_id,
            user_id=current_user.id
        ).first()
        
        if not config:
            return jsonify({'error': 'Database configuration not found'}), 404
        
        # Test connection
        db_service = DatabaseService(config)
        success, message = db_service.test_connection()
        
        if success:
            # Update last_tested timestamp
            config.last_tested = datetime.utcnow()
            db.session.commit()
            
            return jsonify({
                'success': True,
                'message': message,
                'last_tested': config.last_tested.isoformat()
            }), 200
        else:
            return jsonify({
                'success': False,
                'message': message
            }), 400
            
    except Exception as e:
        return jsonify({'error': 'Failed to test database connection', 'details': str(e)}), 500