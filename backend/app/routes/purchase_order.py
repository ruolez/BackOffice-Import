from flask import Blueprint, request, jsonify, current_app
from flask_login import login_required, current_user
from werkzeug.utils import secure_filename
import pandas as pd
import os
from datetime import datetime
from app.models import DatabaseConfig
from app.services.database_service import DatabaseService
from app.services.excel_service import ExcelService
from app.services.purchase_order_service import PurchaseOrderService

bp = Blueprint('purchase_order', __name__)

ALLOWED_EXTENSIONS = {'xlsx', 'xls'}

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

@bp.route('/upload', methods=['POST'])
@login_required
def upload_excel():
    """Upload and process Excel file for purchase order creation"""
    try:
        current_app.logger.info("Starting Excel upload process for purchase order")
        
        # Check if file is present
        if 'file' not in request.files:
            current_app.logger.error("No file provided in request")
            return jsonify({'error': 'No file provided'}), 400
        
        file = request.files['file']
        database_config_id = request.form.get('database_config_id')
        supplier_id = request.form.get('supplier_id')
        
        current_app.logger.info(f"Upload request: file={file.filename}, config_id={database_config_id}, supplier_id={supplier_id}")
        
        if not database_config_id:
            current_app.logger.error("Database configuration ID missing")
            return jsonify({'error': 'Database configuration ID is required'}), 400
        
        if not supplier_id:
            current_app.logger.error("Supplier ID missing")
            return jsonify({'error': 'Supplier ID is required'}), 400
        
        if file.filename == '':
            current_app.logger.error("No file selected")
            return jsonify({'error': 'No file selected'}), 400
        
        if not allowed_file(file.filename):
            current_app.logger.error(f"File type not allowed: {file.filename}")
            return jsonify({'error': 'File type not allowed. Please upload .xlsx or .xls files'}), 400
        
        # Get database configuration
        db_config = DatabaseConfig.query.filter_by(
            id=database_config_id,
            user_id=current_user.id
        ).first()
        
        if not db_config:
            current_app.logger.error(f"Database configuration not found: {database_config_id}")
            return jsonify({'error': 'Database configuration not found'}), 404
        
        # Save uploaded file temporarily
        filename = secure_filename(file.filename)
        filepath = os.path.join('/tmp', filename)
        file.save(filepath)
        current_app.logger.info(f"File saved to: {filepath}")
        
        try:
            # Process Excel file
            current_app.logger.info("Processing Excel file")
            excel_service = ExcelService()
            success, excel_data, message = excel_service.process_excel_file(filepath)
            
            if not success:
                current_app.logger.error(f"Excel processing failed: {message}")
                return jsonify({'error': message}), 400
            
            current_app.logger.info(f"Excel processed successfully: {len(excel_data)} rows")
            
            # Get database service
            db_service = DatabaseService(db_config)
            
            # Get supplier data
            current_app.logger.info(f"Getting supplier data for ID: {supplier_id}")
            success, supplier_data, message = db_service.get_supplier_by_id(int(supplier_id))
            
            if not success:
                current_app.logger.error(f"Supplier query failed: {message}")
                return jsonify({'error': f'Supplier not found: {message}'}), 404
            
            current_app.logger.info(f"Found supplier: {supplier_data.get('BusinessName', 'N/A')}")
            
            # Extract UPCs from Excel data (clean them first)
            upcs = []
            for row in excel_data:
                if row['UPC']:
                    upc = str(row['UPC']).strip()
                    # Remove period and everything after it (Excel formatting artifacts)
                    if '.' in upc:
                        upc = upc.split('.')[0]
                    upcs.append(upc)
            current_app.logger.info(f"Extracted {len(upcs)} UPCs: {upcs[:5]}...")  # Log first 5 UPCs
            
            # Get items from database
            current_app.logger.info("Querying database for items")
            success, items, message = db_service.get_items_by_upcs(upcs)
            
            if not success:
                current_app.logger.error(f"Database query failed: {message}")
                return jsonify({'error': message}), 500
            
            current_app.logger.info(f"Found {len(items)} items in database")
            
            # Create purchase order service
            po_service = PurchaseOrderService(db_service)
            
            # Process purchase order data
            current_app.logger.info("Processing purchase order data")
            success, po_preview, missing_upcs, message = po_service.process_excel_data(excel_data, items, supplier_data)
            
            if not success:
                current_app.logger.error(f"Purchase order processing failed: {message}")
                return jsonify({'error': message}), 400
            
            current_app.logger.info(f"Purchase order preview created successfully: {message}")
            
            # Return preview data
            return jsonify({
                'success': True,
                'message': message,
                'preview': po_preview,
                'missing_upcs': missing_upcs,
                'supplier': {
                    'id': supplier_data['SupplierID'],
                    'account_no': supplier_data['AccountNo'],
                    'business_name': supplier_data['BusinessName'],
                    'city': supplier_data.get('City', ''),
                    'state': supplier_data.get('State', '')
                },
                'database_config': {
                    'id': db_config.id,
                    'name': db_config.name
                }
            }), 200
            
        finally:
            # Clean up temp file
            if os.path.exists(filepath):
                os.unlink(filepath)
                current_app.logger.info(f"Cleaned up temp file: {filepath}")
            
    except Exception as e:
        current_app.logger.error(f"Unexpected error in Excel upload: {str(e)}", exc_info=True)
        return jsonify({'error': 'Failed to process Excel file', 'details': str(e)}), 500

@bp.route('/create', methods=['POST'])
@login_required
def create_purchase_order():
    """Create purchase order from processed data"""
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({'error': 'No data provided'}), 400
        
        database_config_id = data.get('database_config_id')
        po_data = data.get('po_data')
        po_details = data.get('po_details')
        
        if not all([database_config_id, po_data, po_details]):
            return jsonify({'error': 'Missing required data'}), 400
        
        # Get database configuration
        db_config = DatabaseConfig.query.filter_by(
            id=database_config_id,
            user_id=current_user.id
        ).first()
        
        if not db_config:
            return jsonify({'error': 'Database configuration not found'}), 404
        
        # Get database service
        db_service = DatabaseService(db_config)
        
        # Create purchase order
        success, po_id, message = db_service.create_purchase_order(po_data, po_details)
        
        if not success:
            return jsonify({'error': message}), 500
        
        return jsonify({
            'success': True,
            'message': message,
            'po_id': po_id,
            'po_number': po_data['po_number']
        }), 201
        
    except Exception as e:
        current_app.logger.error(f"Error creating purchase order: {e}")
        return jsonify({'error': 'Failed to create purchase order', 'details': str(e)}), 500

@bp.route('/next-number/<int:database_config_id>', methods=['GET'])
@login_required
def get_next_po_number(database_config_id):
    """Get next purchase order number for a database"""
    try:
        # Get database configuration
        db_config = DatabaseConfig.query.filter_by(
            id=database_config_id,
            user_id=current_user.id
        ).first()
        
        if not db_config:
            return jsonify({'error': 'Database configuration not found'}), 404
        
        # Get database service
        db_service = DatabaseService(db_config)
        
        # Get next purchase order number
        success, next_number, message = db_service.get_next_po_number()
        
        if not success:
            return jsonify({'error': message}), 500
        
        return jsonify({
            'success': True,
            'next_number': next_number,
            'message': message
        }), 200
        
    except Exception as e:
        current_app.logger.error(f"Error getting next PO number: {e}")
        return jsonify({'error': 'Failed to get next PO number', 'details': str(e)}), 500

@bp.route('/validate-upcs', methods=['POST'])
@login_required
def validate_upcs():
    """Validate UPCs against database"""
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({'error': 'No data provided'}), 400
        
        database_config_id = data.get('database_config_id')
        upcs = data.get('upcs', [])
        
        if not database_config_id:
            return jsonify({'error': 'Database configuration ID is required'}), 400
        
        if not upcs:
            return jsonify({'error': 'No UPCs provided'}), 400
        
        # Get database configuration
        db_config = DatabaseConfig.query.filter_by(
            id=database_config_id,
            user_id=current_user.id
        ).first()
        
        if not db_config:
            return jsonify({'error': 'Database configuration not found'}), 404
        
        # Get database service
        db_service = DatabaseService(db_config)
        
        # Get items from database
        success, items, message = db_service.get_items_by_upcs(upcs)
        
        if not success:
            return jsonify({'error': message}), 500
        
        # Find missing UPCs
        found_upcs = {item['ProductUPC'] for item in items}
        missing_upcs = [upc for upc in upcs if upc not in found_upcs]
        
        return jsonify({
            'success': True,
            'found_items': len(items),
            'missing_upcs': missing_upcs,
            'items': items
        }), 200
        
    except Exception as e:
        current_app.logger.error(f"Error validating UPCs: {e}")
        return jsonify({'error': 'Failed to validate UPCs', 'details': str(e)}), 500