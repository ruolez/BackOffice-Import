from flask import Blueprint, request, jsonify, current_app
from flask_login import login_required, current_user
from app.models import DatabaseConfig
from app.services.database_service import DatabaseService

bp = Blueprint('customer', __name__)

@bp.route('/search', methods=['POST'])
@login_required
def search_customers():
    """Search customers by AccountNo"""
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
        
        # Search customers
        success, customers, message = db_service.search_customers_by_account(search_term)
        
        if not success:
            return jsonify({'error': message}), 500
        
        return jsonify({
            'success': True,
            'customers': customers,
            'message': message
        }), 200
        
    except Exception as e:
        current_app.logger.error(f"Error searching customers: {e}")
        return jsonify({'error': 'Failed to search customers', 'details': str(e)}), 500

@bp.route('/<int:customer_id>', methods=['GET'])
@login_required
def get_customer(customer_id):
    """Get customer details by CustomerID"""
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
        
        # Get customer
        success, customer, message = db_service.get_customer_by_id(customer_id)
        
        if not success:
            return jsonify({'error': message}), 404
        
        return jsonify({
            'success': True,
            'customer': customer,
            'message': message
        }), 200
        
    except Exception as e:
        current_app.logger.error(f"Error getting customer: {e}")
        return jsonify({'error': 'Failed to get customer', 'details': str(e)}), 500

@bp.route('/validate', methods=['POST'])
@login_required
def validate_customer():
    """Validate if customer exists and is active"""
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({'error': 'No data provided'}), 400
        
        database_config_id = data.get('database_config_id')
        customer_id = data.get('customer_id')
        
        if not database_config_id:
            return jsonify({'error': 'Database configuration ID is required'}), 400
        
        if not customer_id:
            return jsonify({'error': 'Customer ID is required'}), 400
        
        # Get database configuration
        db_config = DatabaseConfig.query.filter_by(
            id=database_config_id,
            user_id=current_user.id
        ).first()
        
        if not db_config:
            return jsonify({'error': 'Database configuration not found'}), 404
        
        # Get database service
        db_service = DatabaseService(db_config)
        
        # Validate customer
        success, customer, message = db_service.get_customer_by_id(customer_id)
        
        if not success:
            return jsonify({
                'success': False,
                'valid': False,
                'message': message
            }), 200
        
        # Check if customer is active (not discontinued)
        is_active = not customer.get('Discontinued', False)
        
        return jsonify({
            'success': True,
            'valid': is_active,
            'customer': customer if is_active else None,
            'message': 'Customer is valid' if is_active else 'Customer is discontinued'
        }), 200
        
    except Exception as e:
        current_app.logger.error(f"Error validating customer: {e}")
        return jsonify({'error': 'Failed to validate customer', 'details': str(e)}), 500