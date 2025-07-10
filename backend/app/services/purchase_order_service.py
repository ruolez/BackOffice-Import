from typing import Tuple, List, Dict, Any
from datetime import datetime
import logging

logger = logging.getLogger(__name__)

class PurchaseOrderService:
    """Service for processing purchase order data"""
    
    def __init__(self, database_service):
        self.db_service = database_service
    
    def _safe_float_convert(self, value):
        """Safely convert a value to float, handling None, empty strings, and invalid values"""
        if value in [None, '', 'NULL', 'null']:
            return 0.0
        try:
            return float(value)
        except (ValueError, TypeError):
            return 0.0
    
    def _safe_int_convert(self, value):
        """Safely convert a value to int, handling None, empty strings, and invalid values"""
        if value in [None, '', 'NULL', 'null']:
            return 0
        try:
            return int(float(value))  # Convert to float first to handle decimal strings
        except (ValueError, TypeError):
            return 0
    
    def _safe_string_convert(self, value):
        """Safely convert a value to string, handling None and NULL values"""
        if value in [None, 'NULL', 'null', '']:
            return ''
        return str(value) if value is not None else ''
    
    def process_excel_data(self, excel_data: List[Dict[str, Any]], items: List[Dict[str, Any]], supplier_data: Dict[str, Any] = None) -> Tuple[bool, Dict[str, Any], List[str], str]:
        """Process Excel data and create purchase order preview"""
        try:
            # Create UPC to item mapping
            upc_to_item = {item['ProductUPC']: item for item in items}
            
            # Process each Excel row
            po_lines = []
            missing_upcs = []
            total_qty_ordered = 0
            total_qty_received = 0
            total_cost = 0
            
            for excel_row in excel_data:
                upc = excel_row['UPC']
                # For purchase orders: cost comes from Excel (what we're paying the supplier)
                cost_from_excel = excel_row['Cost']
                qty = excel_row['QTY']
                
                if upc in upc_to_item:
                    item = upc_to_item[upc]
                    
                    # Calculate extended cost
                    extended_cost = cost_from_excel * qty
                    
                    # Create purchase order line (convert all fields to proper types)
                    po_line = {
                        'ProductID': self._safe_int_convert(item['ProductID']),           # Integer
                        'CateID': self._safe_int_convert(item['CateID']),                 # Integer  
                        'SubCateID': self._safe_int_convert(item['SubCateID']),           # Integer
                        'ProductSKU': self._safe_string_convert(item['ProductSKU']),      # String/VARCHAR
                        'ProductUPC': self._safe_string_convert(item['ProductUPC']),      # String/VARCHAR
                        'SupplierSKU': self._safe_string_convert(item.get('SupplierSKU', '')), # String/VARCHAR
                        'ProductDescription': self._safe_string_convert(item['ProductDescription']), # String/VARCHAR
                        'ItemSize': self._safe_string_convert(item['ItemSize']),          # String/VARCHAR
                        'UnitCost': cost_from_excel,                                      # Float (from Excel - cost we pay)
                        'ExtendedCost': extended_cost,                                    # Float (calculated: cost * qty)
                        'QtyOrdered': qty,                                                # Float (from Excel)
                        'QtyReceived': qty,                                               # Float (same as ordered - both identical)
                        'ItemWeight': self._safe_float_convert(item.get('ItemWeight', 0)), # Float
                        'UnitDesc': self._safe_string_convert(item.get('UnitDesc', '')),  # String
                        'UnitQty': self._safe_float_convert(item.get('UnitQty', 0)),      # Float
                        'ExpDate': self._safe_string_convert(''),                         # String - empty for now
                        'ReasonID': self._safe_int_convert(0),                            # Integer - default 0
                        'DateReceived': datetime.now(),                                   # Date - today's date
                        'Committedln': False,                                             # Boolean - default False
                        'Flag': False,                                                    # Boolean - default False
                        'excel_row': excel_row['row_number']                              # Integer (from Excel)
                    }
                    
                    po_lines.append(po_line)
                    
                    # Update totals
                    total_qty_ordered += qty
                    total_qty_received += qty  # Same as ordered for new POs
                    total_cost += extended_cost
                    
                else:
                    missing_upcs.append({
                        'upc': upc,
                        'row_number': excel_row['row_number'],
                        'cost': cost_from_excel,  # This is the cost we're paying
                        'qty': qty
                    })
            
            if not po_lines:
                return False, {}, missing_upcs, "No valid items found to create purchase order"
            
            # Get next PO number
            success, next_number, message = self.db_service.get_next_po_number()
            if not success:
                return False, {}, missing_upcs, f"Failed to get next PO number: {message}"
            
            # Create purchase order preview with supplier information
            po_preview = {
                'po_number': str(next_number),
                'po_date': datetime.now().strftime('%Y-%m-%d'),
                'required_date': datetime.now().strftime('%Y-%m-%d'),  # Today's date
                'po_title': 'Excel Import',
                'status': 0,  # New PO status
                'supplier_id': supplier_data.get('SupplierID') if supplier_data else None,
                'business_name': supplier_data.get('BusinessName') if supplier_data else None,
                'account_no': supplier_data.get('AccountNo') if supplier_data else None,
                'ship_to': supplier_data.get('BusinessName') if supplier_data else None,  # Default to business name
                'ship_address1': supplier_data.get('Address1') if supplier_data else None,
                'ship_address2': supplier_data.get('Address2') if supplier_data else None,
                'ship_contact': supplier_data.get('Contactname') if supplier_data else None,
                'ship_city': supplier_data.get('City') if supplier_data else None,
                'ship_state': supplier_data.get('State') if supplier_data else None,
                'ship_zipcode': supplier_data.get('ZipCode') if supplier_data else None,
                'ship_phone': supplier_data.get('Phone_Number') if supplier_data else None,
                'employee_id': self._safe_int_convert(0),  # Default to 0
                'term_id': self._safe_int_convert(0),  # Default to 0
                'shipper_id': self._safe_int_convert(0),  # Default to 0
                'total_qty_ordered': total_qty_ordered,
                'total_qty_received': total_qty_received,
                'no_lines': len(po_lines),
                'po_total': total_cost,
                'lines': po_lines,
                'summary': {
                    'total_items': len(po_lines),
                    'total_quantity_ordered': total_qty_ordered,
                    'total_quantity_received': total_qty_received,
                    'total_cost': total_cost,
                    'missing_upcs_count': len(missing_upcs)
                }
            }
            
            return True, po_preview, missing_upcs, f"Purchase order preview created with {len(po_lines)} lines"
            
        except Exception as e:
            logger.error(f"Error processing Excel data: {e}")
            return False, {}, [], f"Error processing Excel data: {str(e)}"
    
    def prepare_po_data(self, po_preview: Dict[str, Any]) -> Tuple[Dict[str, Any], List[Dict[str, Any]]]:
        """Prepare purchase order data for database insertion"""
        try:
            # Prepare purchase order header data with supplier information
            po_data = {
                'po_number': po_preview['po_number'],
                'po_date': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
                'required_date': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),  # Today's date
                'po_title': po_preview['po_title'],
                'status': po_preview['status'],
                'supplier_id': po_preview.get('supplier_id'),
                'business_name': po_preview.get('business_name'),
                'account_no': po_preview.get('account_no'),
                'ship_to': po_preview.get('ship_to'),
                'ship_address1': po_preview.get('ship_address1'),
                'ship_address2': po_preview.get('ship_address2'),
                'ship_contact': po_preview.get('ship_contact'),
                'ship_city': po_preview.get('ship_city'),
                'ship_state': po_preview.get('ship_state'),
                'ship_zipcode': po_preview.get('ship_zipcode'),
                'ship_phone': po_preview.get('ship_phone'),
                'employee_id': po_preview.get('employee_id'),
                'term_id': po_preview.get('term_id'),
                'shipper_id': po_preview.get('shipper_id'),
                'total_qty_ordered': po_preview['total_qty_ordered'],
                'total_qty_received': po_preview['total_qty_received'],
                'no_lines': po_preview['no_lines'],
                'po_total': po_preview['po_total']
            }
            
            # Prepare purchase order details data
            po_details = []
            for line in po_preview['lines']:
                detail = {
                    'ProductID': self._safe_int_convert(line['ProductID']),
                    'CateID': self._safe_int_convert(line['CateID']),
                    'SubCateID': self._safe_int_convert(line['SubCateID']),
                    'ProductSKU': self._safe_string_convert(line['ProductSKU']),
                    'ProductUPC': self._safe_string_convert(line['ProductUPC']),
                    'SupplierSKU': self._safe_string_convert(line.get('SupplierSKU', '')),
                    'ProductDescription': self._safe_string_convert(line['ProductDescription']),
                    'ItemSize': self._safe_string_convert(line['ItemSize']),
                    'UnitCost': self._safe_float_convert(line['UnitCost']),
                    'ExtendedCost': self._safe_float_convert(line['ExtendedCost']),
                    'QtyOrdered': self._safe_float_convert(line['QtyOrdered']),
                    'QtyReceived': self._safe_float_convert(line['QtyReceived']),
                    'ItemWeight': self._safe_float_convert(line.get('ItemWeight', 0)),
                    'UnitDesc': self._safe_string_convert(line.get('UnitDesc', '')),
                    'UnitQty': self._safe_float_convert(line.get('UnitQty', 0)),
                    'ExpDate': self._safe_string_convert(line.get('ExpDate', '')),
                    'ReasonID': self._safe_int_convert(line.get('ReasonID', 0)),
                    'DateReceived': datetime.now(),  # Today's date
                    'Committedln': bool(line.get('Committedln', False)),
                    'Flag': bool(line.get('Flag', False))
                }
                po_details.append(detail)
            
            return po_data, po_details
            
        except Exception as e:
            logger.error(f"Error preparing purchase order data: {e}")
            raise e
    
    def validate_po_data(self, po_preview: Dict[str, Any]) -> Tuple[bool, str]:
        """Validate purchase order data before creation"""
        try:
            # Check required fields
            required_fields = ['po_number', 'lines']
            for field in required_fields:
                if field not in po_preview or not po_preview[field]:
                    return False, f"Missing required field: {field}"
            
            # Check if there are any lines
            if not po_preview['lines']:
                return False, "Purchase order must have at least one line item"
            
            # Validate each line
            for i, line in enumerate(po_preview['lines']):
                required_line_fields = ['ProductID', 'ProductUPC', 'UnitCost', 'QtyOrdered']
                for field in required_line_fields:
                    if field not in line or line[field] is None:
                        return False, f"Line {i + 1}: Missing required field: {field}"
                
                # Check quantities
                if line['QtyOrdered'] <= 0:
                    return False, f"Line {i + 1}: Quantity must be greater than 0"
                
                if line['UnitCost'] < 0:
                    return False, f"Line {i + 1}: Unit cost cannot be negative"
            
            return True, "Purchase order data is valid"
            
        except Exception as e:
            logger.error(f"Error validating purchase order data: {e}")
            return False, f"Error validating purchase order data: {str(e)}"
    
    def calculate_po_totals(self, lines: List[Dict[str, Any]]) -> Dict[str, float]:
        """Calculate purchase order totals from line items"""
        try:
            total_qty_ordered = sum(line['QtyOrdered'] for line in lines)
            total_qty_received = sum(line['QtyReceived'] for line in lines)
            total_cost = sum(line['ExtendedCost'] for line in lines)
            
            return {
                'total_quantity_ordered': total_qty_ordered,
                'total_quantity_received': total_qty_received,
                'total_cost': total_cost
            }
            
        except Exception as e:
            logger.error(f"Error calculating purchase order totals: {e}")
            return {
                'total_quantity_ordered': 0,
                'total_quantity_received': 0,
                'total_cost': 0
            }