from flask import Blueprint, request, jsonify, send_file, current_app
from flask_login import login_required, current_user
from app.models import DatabaseConfig
from app.services.database_service import DatabaseService
from app.services.export_service import build_export_excel

bp = Blueprint('export', __name__)

XLSX_MIMETYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'


def _get_config_or_404(config_id):
    return DatabaseConfig.query.filter_by(id=config_id, user_id=current_user.id).first()


def _to_float(value):
    try:
        return float(value) if value is not None else 0.0
    except (ValueError, TypeError):
        return 0.0


def _rows_from_details(details, cost_field):
    """Map document detail rows to export rows. cost_field is 'UnitPrice'
    (invoices, selling price) or 'UnitCost' (purchase orders)."""
    return [
        {
            'UPC': str(d.get('ProductUPC') or ''),
            'QTY': _to_float(d.get('QtyOrdered')),
            'Cost': _to_float(d.get(cost_field)),
            'Description': str(d.get('ProductDescription') or '')
        }
        for d in details
    ]


@bp.route('/invoices/<int:config_id>', methods=['GET'])
@login_required
def get_invoices_list(config_id):
    try:
        page = request.args.get('page', 1, type=int)
        per_page = request.args.get('per_page', 25, type=int)
        search = request.args.get('search', '').strip() or None

        db_config = _get_config_or_404(config_id)
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
        current_app.logger.error(f"Error getting invoices list for export: {e}")
        return jsonify({'error': 'Failed to get invoices list', 'details': str(e)}), 500


@bp.route('/purchase-orders/<int:config_id>', methods=['GET'])
@login_required
def get_purchase_orders_list(config_id):
    try:
        page = request.args.get('page', 1, type=int)
        per_page = request.args.get('per_page', 25, type=int)
        search = request.args.get('search', '').strip() or None

        db_config = _get_config_or_404(config_id)
        if not db_config:
            return jsonify({'error': 'Database configuration not found'}), 404

        db_service = DatabaseService(db_config)
        success, result, message = db_service.get_purchase_orders_list(page, per_page, search)

        if not success:
            return jsonify({'error': message}), 500

        return jsonify({
            'success': True,
            'purchase_orders': result['purchase_orders'],
            'pagination': result['pagination'],
            'message': message
        }), 200

    except Exception as e:
        current_app.logger.error(f"Error getting purchase orders list for export: {e}")
        return jsonify({'error': 'Failed to get purchase orders list', 'details': str(e)}), 500


@bp.route('/invoice/<int:config_id>/<int:invoice_id>', methods=['GET'])
@login_required
def export_invoice(config_id, invoice_id):
    try:
        db_config = _get_config_or_404(config_id)
        if not db_config:
            return jsonify({'error': 'Database configuration not found'}), 404

        db_service = DatabaseService(db_config)
        success, result, message = db_service.get_invoice_with_details(invoice_id)

        if not success:
            return jsonify({'error': message}), 404

        # Invoices: the importer reads the Cost column as the selling price (UnitPrice).
        rows = _rows_from_details(result['details'], 'UnitPrice')
        buf = build_export_excel(rows)

        number = result['invoice'].get('InvoiceNumber') or invoice_id
        return send_file(
            buf,
            mimetype=XLSX_MIMETYPE,
            as_attachment=True,
            download_name=f'Invoice_{number}.xlsx'
        )

    except Exception as e:
        current_app.logger.error(f"Error exporting invoice: {e}")
        return jsonify({'error': 'Failed to export invoice', 'details': str(e)}), 500


@bp.route('/purchase-order/<int:config_id>/<int:po_id>', methods=['GET'])
@login_required
def export_purchase_order(config_id, po_id):
    try:
        db_config = _get_config_or_404(config_id)
        if not db_config:
            return jsonify({'error': 'Database configuration not found'}), 404

        db_service = DatabaseService(db_config)
        success, result, message = db_service.get_purchase_order_with_details(po_id)

        if not success:
            return jsonify({'error': message}), 404

        # Purchase orders: the importer reads the Cost column as the unit cost (UnitCost).
        rows = _rows_from_details(result['details'], 'UnitCost')
        buf = build_export_excel(rows)

        number = result['purchase_order'].get('PoNumber') or po_id
        return send_file(
            buf,
            mimetype=XLSX_MIMETYPE,
            as_attachment=True,
            download_name=f'PO_{number}.xlsx'
        )

    except Exception as e:
        current_app.logger.error(f"Error exporting purchase order: {e}")
        return jsonify({'error': 'Failed to export purchase order', 'details': str(e)}), 500
