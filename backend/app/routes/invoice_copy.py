from flask import Blueprint, request, jsonify, current_app
from flask_login import login_required, current_user
from app.models import DatabaseConfig
from app.services.database_service import DatabaseService
from app.services.invoice_copy_service import InvoiceCopyService

bp = Blueprint('invoice_copy', __name__)


@bp.route('/invoices/<int:config_id>', methods=['GET'])
@login_required
def get_invoices_list(config_id):
    try:
        page = request.args.get('page', 1, type=int)
        per_page = request.args.get('per_page', 25, type=int)
        search = request.args.get('search', '').strip() or None

        db_config = DatabaseConfig.query.filter_by(
            id=config_id,
            user_id=current_user.id
        ).first()

        if not db_config:
            return jsonify({'error': 'Database configuration not found'}), 404

        db_service = DatabaseService(db_config)
        success, result, message = db_service.get_invoices_list(page, per_page, search)

        if not success:
            return jsonify({'error': message}), 500

        return jsonify({
            'success': True,
            'invoices': result['invoices'],
            'pagination': result['pagination'],
            'message': message
        }), 200

    except Exception as e:
        current_app.logger.error(f"Error getting invoices list: {e}")
        return jsonify({'error': 'Failed to get invoices list', 'details': str(e)}), 500


@bp.route('/invoice-detail/<int:config_id>/<int:invoice_id>', methods=['GET'])
@login_required
def get_invoice_detail(config_id, invoice_id):
    try:
        db_config = DatabaseConfig.query.filter_by(
            id=config_id,
            user_id=current_user.id
        ).first()

        if not db_config:
            return jsonify({'error': 'Database configuration not found'}), 404

        db_service = DatabaseService(db_config)
        success, result, message = db_service.get_invoice_with_details(invoice_id)

        if not success:
            return jsonify({'error': message}), 404

        return jsonify({
            'success': True,
            'invoice': result['invoice'],
            'details': result['details'],
            'message': message
        }), 200

    except Exception as e:
        current_app.logger.error(f"Error getting invoice detail: {e}")
        return jsonify({'error': 'Failed to get invoice detail', 'details': str(e)}), 500


@bp.route('/prepare', methods=['POST'])
@login_required
def prepare_copy():
    try:
        data = request.get_json()

        if not data:
            return jsonify({'error': 'No data provided'}), 400

        source_config_id = data.get('source_config_id')
        source_invoice_id = data.get('source_invoice_id')
        dest_config_id = data.get('dest_config_id')
        customer_id = data.get('customer_id')

        if not all([source_config_id, source_invoice_id, dest_config_id, customer_id]):
            return jsonify({'error': 'Missing required fields'}), 400

        source_config = DatabaseConfig.query.filter_by(
            id=source_config_id,
            user_id=current_user.id
        ).first()
        dest_config = DatabaseConfig.query.filter_by(
            id=dest_config_id,
            user_id=current_user.id
        ).first()

        if not source_config:
            return jsonify({'error': 'Source database configuration not found'}), 404
        if not dest_config:
            return jsonify({'error': 'Destination database configuration not found'}), 404

        source_db = DatabaseService(source_config)
        dest_db = DatabaseService(dest_config)

        success, source_data, message = source_db.get_invoice_with_details(source_invoice_id)
        if not success:
            return jsonify({'error': f'Failed to get source invoice: {message}'}), 404

        source_invoice = source_data['invoice']
        source_details = source_data['details']

        upcs = [str(d.get('ProductUPC', '')) for d in source_details if d.get('ProductUPC')]
        if not upcs:
            return jsonify({'error': 'Source invoice has no line items with UPCs'}), 400

        success, dest_items, message = dest_db.get_items_by_upcs(upcs)
        if not success:
            return jsonify({'error': f'Failed to look up items in destination: {message}'}), 500

        success, customer_data, message = dest_db.get_customer_by_id(int(customer_id))
        if not success:
            return jsonify({'error': f'Customer not found in destination: {message}'}), 404

        success, next_number, message = dest_db.get_next_invoice_number()
        if not success:
            return jsonify({'error': f'Failed to get next invoice number: {message}'}), 500

        copy_service = InvoiceCopyService()
        success, preview, missing_upcs, message = copy_service.build_copy_preview(
            source_details, dest_items, customer_data, next_number,
            str(source_invoice.get('InvoiceNumber', ''))
        )

        if not success:
            return jsonify({
                'success': False,
                'error': message,
                'missing_upcs': missing_upcs
            }), 400

        return jsonify({
            'success': True,
            'preview': preview,
            'missing_upcs': missing_upcs,
            'customer': {
                'id': customer_data['CustomerID'],
                'account_no': customer_data['AccountNo'],
                'business_name': customer_data['BusinessName'],
                'city': customer_data.get('City', ''),
                'state': customer_data.get('State', '')
            },
            'source_invoice': {
                'invoice_number': source_invoice.get('InvoiceNumber'),
                'business_name': source_invoice.get('BusinessName'),
                'total_lines': len(source_details)
            },
            'message': message
        }), 200

    except Exception as e:
        current_app.logger.error(f"Error preparing invoice copy: {e}", exc_info=True)
        return jsonify({'error': 'Failed to prepare invoice copy', 'details': str(e)}), 500


@bp.route('/create', methods=['POST'])
@login_required
def create_copied_invoice():
    try:
        data = request.get_json()

        if not data:
            return jsonify({'error': 'No data provided'}), 400

        dest_config_id = data.get('dest_config_id')
        invoice_data = data.get('invoice_data')
        invoice_details = data.get('invoice_details')

        if not all([dest_config_id, invoice_data, invoice_details]):
            return jsonify({'error': 'Missing required data'}), 400

        db_config = DatabaseConfig.query.filter_by(
            id=dest_config_id,
            user_id=current_user.id
        ).first()

        if not db_config:
            return jsonify({'error': 'Database configuration not found'}), 404

        db_service = DatabaseService(db_config)
        success, invoice_id, message = db_service.create_invoice(invoice_data, invoice_details)

        if not success:
            return jsonify({'error': message}), 500

        return jsonify({
            'success': True,
            'message': message,
            'invoice_id': invoice_id,
            'invoice_number': invoice_data['invoice_number']
        }), 201

    except Exception as e:
        current_app.logger.error(f"Error creating copied invoice: {e}")
        return jsonify({'error': 'Failed to create invoice', 'details': str(e)}), 500
