from flask import Blueprint, request, jsonify, current_app
from flask_login import login_required, current_user
from app.models import DatabaseConfig
from app.services.database_service import DatabaseService

bp = Blueprint('supplier', __name__)

@bp.route('/search', methods=['POST'])
@login_required
def search_suppliers():
    """Search suppliers by AccountNo"""
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({'error': 'No data provided'}), 400
        
        database_config_id = data.get('database_config_id')
        search_term = data.get('search_term', '').strip()
        
        if not database_config_id:
            return jsonify({'error': 'Database configuration ID is required'}), 400
        
        if not search_term:
            return jsonify({'error': 'Search term is required'}), 400
        
        # Get database configuration
        db_config = DatabaseConfig.query.filter_by(
            id=database_config_id,
            user_id=current_user.id
        ).first()
        
        if not db_config:
            return jsonify({'error': 'Database configuration not found'}), 404
        
        # Get database service
        db_service = DatabaseService(db_config)
        
        # Search suppliers
        success, suppliers, message = db_service.search_suppliers_by_account(search_term)
        
        if not success:
            return jsonify({'error': message}), 500
        
        return jsonify({
            'success': True,
            'suppliers': suppliers,
            'message': message
        }), 200
        
    except Exception as e:
        current_app.logger.error(f"Error searching suppliers: {e}")
        return jsonify({'error': 'Failed to search suppliers', 'details': str(e)}), 500

@bp.route('/<int:supplier_id>', methods=['GET'])
@login_required
def get_supplier(supplier_id):
    """Get supplier details by SupplierID"""
    try:
        database_config_id = request.args.get('database_config_id')
        
        if not database_config_id:
            return jsonify({'error': 'Database configuration ID is required'}), 400
        
        # Get database configuration
        db_config = DatabaseConfig.query.filter_by(
            id=database_config_id,
            user_id=current_user.id
        ).first()
        
        if not db_config:
            return jsonify({'error': 'Database configuration not found'}), 404
        
        # Get database service
        db_service = DatabaseService(db_config)
        
        # Get supplier
        success, supplier, message = db_service.get_supplier_by_id(supplier_id)
        
        if not success:
            return jsonify({'error': message}), 404
        
        return jsonify({
            'success': True,
            'supplier': supplier,
            'message': message
        }), 200
        
    except Exception as e:
        current_app.logger.error(f"Error getting supplier: {e}")
        return jsonify({'error': 'Failed to get supplier', 'details': str(e)}), 500

@bp.route('/validate', methods=['POST'])
@login_required
def validate_supplier():
    """Validate if supplier exists and is active"""
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({'error': 'No data provided'}), 400
        
        database_config_id = data.get('database_config_id')
        supplier_id = data.get('supplier_id')
        
        if not database_config_id:
            return jsonify({'error': 'Database configuration ID is required'}), 400
        
        if not supplier_id:
            return jsonify({'error': 'Supplier ID is required'}), 400
        
        # Get database configuration
        db_config = DatabaseConfig.query.filter_by(
            id=database_config_id,
            user_id=current_user.id
        ).first()
        
        if not db_config:
            return jsonify({'error': 'Database configuration not found'}), 404
        
        # Get database service
        db_service = DatabaseService(db_config)
        
        # Validate supplier
        success, supplier, message = db_service.get_supplier_by_id(supplier_id)
        
        if not success:
            return jsonify({
                'success': False,
                'valid': False,
                'message': message
            }), 200
        
        # Check if supplier is active (not discontinued)
        is_active = not supplier.get('Discontinued', False)
        
        return jsonify({
            'success': True,
            'valid': is_active,
            'supplier': supplier if is_active else None,
            'message': 'Supplier is valid' if is_active else 'Supplier is discontinued'
        }), 200
        
    except Exception as e:
        current_app.logger.error(f"Error validating supplier: {e}")
        return jsonify({'error': 'Failed to validate supplier', 'details': str(e)}), 500