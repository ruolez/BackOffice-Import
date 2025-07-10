from typing import Tuple, List, Dict, Any
from datetime import datetime
import logging

logger = logging.getLogger(__name__)

class InvoiceService:
    """Service for processing invoice data"""
    
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
    
    def process_excel_data(self, excel_data: List[Dict[str, Any]], items: List[Dict[str, Any]], customer_data: Dict[str, Any] = None) -> Tuple[bool, Dict[str, Any], List[str], str]:
        """Process Excel data and create invoice preview"""
        try:
            # Create UPC to item mapping
            upc_to_item = {item['ProductUPC']: item for item in items}
            
            # Process each Excel row
            invoice_lines = []
            missing_upcs = []
            total_qty_ordered = 0
            total_qty_shipped = 0
            total_cost = 0
            total_price = 0
            total_weight = 0
            
            for excel_row in excel_data:
                upc = excel_row['UPC']
                # For invoices: price comes from Excel, cost comes from database
                price_from_excel = excel_row['Cost']  # Note: Excel column is named 'Cost' but contains selling price
                qty = excel_row['QTY']
                
                if upc in upc_to_item:
                    item = upc_to_item[upc]
                    
                    # Get cost from database (UnitCost field in Items_tbl)
                    unit_cost = self._safe_float_convert(item.get('UnitCost', 0))
                    
                    # Calculate extended values
                    extended_cost = unit_cost * qty
                    extended_price = price_from_excel * qty
                    
                    # Create invoice line (convert all fields to proper types based on expected data type)
                    invoice_line = {
                        'ProductID': self._safe_int_convert(item['ProductID']),           # Integer
                        'CateID': self._safe_int_convert(item['CateID']),                 # Integer  
                        'SubCateID': self._safe_int_convert(item['SubCateID']),           # Integer
                        'ProductSKU': self._safe_string_convert(item['ProductSKU']),      # String/VARCHAR
                        'ProductUPC': self._safe_string_convert(item['ProductUPC']),      # String/VARCHAR
                        'ProductDescription': self._safe_string_convert(item['ProductDescription']), # String/VARCHAR
                        'ItemSize': self._safe_string_convert(item['ItemSize']),          # String/VARCHAR
                        'UnitPrice': price_from_excel,                                    # Float (from Excel - selling price)
                        'OriginalPrice': self._safe_float_convert(item.get('OriginalPrice')), # Float (from Items_tbl)
                        'UnitCost': unit_cost,                                            # Float (from Items_tbl database)
                        'QtyOrdered': qty,                                                # Float (from Excel)
                        'QtyShipped': qty,                                                # Float (from Excel)
                        'ExtendedPrice': extended_price,                                  # Float (calculated: price * qty)
                        'ExtendedCost': extended_cost,                                    # Float (calculated: cost * qty)
                        'ItemWeight': self._safe_float_convert(item['ItemWeight']),       # Float
                        'ItemTaxID': self._safe_int_convert(item['ItemTaxID']),           # Integer
                        'Taxable': False,                                                 # Boolean - default to False
                        'SPPromoted': item.get('SPPromoted', False),                      # Boolean
                        'SPPromotionDescription': self._safe_string_convert(item.get('SPPromotionDescription', '')), # String
                        'ProductMessage': self._safe_string_convert(item.get('ProductMessage', '')), # String/VARCHAR
                        'LineMessage': self._safe_string_convert(item.get('ProductMessage', '')), # String (copy of ProductMessage)
                        'UnitDesc': self._safe_string_convert(item.get('ItemSize', '')),  # String (derived from ItemSize)
                        'UnitQty': self._safe_float_convert(item.get('CountInUnit')),     # Float (from Items_tbl)
                        'CountInUnit': self._safe_int_convert(item.get('CountInUnit')),   # Integer
                        'excel_row': excel_row['row_number']                              # Integer (from Excel)
                    }
                    
                    invoice_lines.append(invoice_line)
                    
                    # Update totals
                    total_qty_ordered += qty
                    total_qty_shipped += qty  # Assuming shipped = ordered for this import
                    total_cost += extended_cost
                    total_price += extended_price
                    
                    # Add weight (convert to float safely)
                    item_weight = self._safe_float_convert(item.get('ItemWeight', 0))
                    total_weight += item_weight * qty
                    
                else:
                    missing_upcs.append({
                        'upc': upc,
                        'row_number': excel_row['row_number'],
                        'price': price_from_excel,  # This is the selling price from Excel
                        'qty': qty
                    })
            
            if not invoice_lines:
                return False, {}, missing_upcs, "No valid items found to create invoice"
            
            # Get next invoice number
            success, next_number, message = self.db_service.get_next_invoice_number()
            if not success:
                return False, {}, missing_upcs, f"Failed to get next invoice number: {message}"
            
            # Calculate taxes (assuming 0% for now, can be configured)
            tax_rate = 0.0
            total_taxes = total_price * tax_rate
            
            # Create invoice preview with customer information
            invoice_preview = {
                'invoice_number': str(next_number),
                'invoice_date': datetime.now().strftime('%Y-%m-%d'),
                'invoice_type': 'Purchase',
                'invoice_title': 'Excel Import',
                'customer_id': customer_data.get('CustomerID') if customer_data else None,
                'business_name': customer_data.get('BusinessName') if customer_data else None,
                'account_no': customer_data.get('AccountNo') if customer_data else None,
                'ship_to': customer_data.get('ShipTo') if customer_data else None,
                'ship_address1': customer_data.get('ShipAddress1') if customer_data else None,
                'ship_address2': customer_data.get('ShipAddress2') if customer_data else None,
                'ship_city': customer_data.get('ShipCity') if customer_data else None,
                'ship_state': customer_data.get('ShipState') if customer_data else None,
                'ship_zipcode': customer_data.get('ShipZipCode') if customer_data else None,
                'ship_phone': customer_data.get('ShipPhone_Number') if customer_data else None,
                'term_id': customer_data.get('TermID') if customer_data else None,
                'sales_rep_id': customer_data.get('SalesRepID') if customer_data else None,
                'total_qty_ordered': total_qty_ordered,
                'total_qty_shipped': total_qty_shipped,
                'no_lines': len(invoice_lines),
                'total_weight': total_weight,
                'invoice_subtotal': total_price,
                'total_taxes': total_taxes,
                'invoice_total': total_price + total_taxes,
                'lines': invoice_lines,
                'summary': {
                    'total_items': len(invoice_lines),
                    'total_quantity_ordered': total_qty_ordered,
                    'total_quantity_shipped': total_qty_shipped,
                    'total_cost': total_cost,
                    'total_price': total_price,
                    'total_weight': total_weight,
                    'total_taxes': total_taxes,
                    'final_total': total_price + total_taxes,
                    'missing_upcs_count': len(missing_upcs)
                }
            }
            
            return True, invoice_preview, missing_upcs, f"Invoice preview created with {len(invoice_lines)} lines"
            
        except Exception as e:
            logger.error(f"Error processing Excel data: {e}")
            return False, {}, [], f"Error processing Excel data: {str(e)}"
    
    def prepare_invoice_data(self, invoice_preview: Dict[str, Any]) -> Tuple[Dict[str, Any], List[Dict[str, Any]]]:
        """Prepare invoice data for database insertion"""
        try:
            # Prepare invoice header data with customer information
            invoice_data = {
                'invoice_number': invoice_preview['invoice_number'],
                'invoice_date': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
                'invoice_type': invoice_preview['invoice_type'],
                'invoice_title': invoice_preview['invoice_title'],
                'customer_id': invoice_preview.get('customer_id'),
                'business_name': invoice_preview.get('business_name'),
                'account_no': invoice_preview.get('account_no'),
                'ship_to': invoice_preview.get('ship_to'),
                'ship_address1': invoice_preview.get('ship_address1'),
                'ship_address2': invoice_preview.get('ship_address2'),
                'ship_city': invoice_preview.get('ship_city'),
                'ship_state': invoice_preview.get('ship_state'),
                'ship_zipcode': invoice_preview.get('ship_zipcode'),
                'ship_phone': invoice_preview.get('ship_phone'),
                'term_id': invoice_preview.get('term_id'),
                'sales_rep_id': invoice_preview.get('sales_rep_id'),
                'total_qty_ordered': invoice_preview['total_qty_ordered'],
                'total_qty_shipped': invoice_preview['total_qty_shipped'],
                'no_lines': invoice_preview['no_lines'],
                'total_weight': invoice_preview.get('total_weight'),
                'invoice_subtotal': invoice_preview['invoice_subtotal'],
                'total_taxes': invoice_preview['total_taxes'],
                'invoice_total': invoice_preview['invoice_total']
            }
            
            # Prepare invoice details data with additional fields
            invoice_details = []
            for line in invoice_preview['lines']:
                detail = {
                    'CateID': self._safe_int_convert(line['CateID']),
                    'SubCateID': self._safe_int_convert(line['SubCateID']),
                    'ProductID': self._safe_int_convert(line['ProductID']),
                    'ProductSKU': self._safe_string_convert(line['ProductSKU']),
                    'ProductUPC': self._safe_string_convert(line['ProductUPC']),
                    'ProductDescription': self._safe_string_convert(line['ProductDescription']),
                    'ItemSize': self._safe_string_convert(line['ItemSize']),
                    'UnitPrice': self._safe_float_convert(line['UnitPrice']),
                    'OriginalPrice': self._safe_float_convert(line.get('OriginalPrice')),
                    'UnitCost': self._safe_float_convert(line['UnitCost']),
                    'QtyOrdered': self._safe_float_convert(line['QtyOrdered']),
                    'QtyShipped': self._safe_float_convert(line['QtyShipped']),
                    'ExtendedPrice': self._safe_float_convert(line['ExtendedPrice']),
                    'ExtendedCost': self._safe_float_convert(line['ExtendedCost']),
                    'ItemWeight': self._safe_float_convert(line['ItemWeight']),
                    'ItemTaxID': self._safe_int_convert(line['ItemTaxID']),
                    'Taxable': bool(line['Taxable']),
                    'SPPromoted': bool(line.get('SPPromoted', False)),
                    'SPPromotionDescription': self._safe_string_convert(line.get('SPPromotionDescription', '')),
                    'LineMessage': self._safe_string_convert(line.get('LineMessage', '')),
                    'UnitDesc': self._safe_string_convert(line.get('UnitDesc', '')),
                    'UnitQty': self._safe_float_convert(line.get('UnitQty'))
                }
                invoice_details.append(detail)
            
            return invoice_data, invoice_details
            
        except Exception as e:
            logger.error(f"Error preparing invoice data: {e}")
            raise e
    
    def validate_invoice_data(self, invoice_preview: Dict[str, Any]) -> Tuple[bool, str]:
        """Validate invoice data before creation"""
        try:
            # Check required fields
            required_fields = ['invoice_number', 'lines']
            for field in required_fields:
                if field not in invoice_preview or not invoice_preview[field]:
                    return False, f"Missing required field: {field}"
            
            # Check if there are any lines
            if not invoice_preview['lines']:
                return False, "Invoice must have at least one line item"
            
            # Validate each line
            for i, line in enumerate(invoice_preview['lines']):
                required_line_fields = ['ProductID', 'ProductUPC', 'UnitCost', 'QtyOrdered']
                for field in required_line_fields:
                    if field not in line or line[field] is None:
                        return False, f"Line {i + 1}: Missing required field: {field}"
                
                # Check quantities
                if line['QtyOrdered'] <= 0:
                    return False, f"Line {i + 1}: Quantity must be greater than 0"
                
                if line['UnitCost'] < 0:
                    return False, f"Line {i + 1}: Unit cost cannot be negative"
            
            return True, "Invoice data is valid"
            
        except Exception as e:
            logger.error(f"Error validating invoice data: {e}")
            return False, f"Error validating invoice data: {str(e)}"
    
    def calculate_invoice_totals(self, lines: List[Dict[str, Any]], tax_rate: float = 0.0) -> Dict[str, float]:
        """Calculate invoice totals from line items"""
        try:
            total_qty = sum(line['QtyOrdered'] for line in lines)
            total_cost = sum(line['ExtendedCost'] for line in lines)
            total_price = sum(line['ExtendedPrice'] for line in lines)
            total_taxes = total_price * tax_rate
            final_total = total_price + total_taxes
            
            return {
                'total_quantity': total_qty,
                'total_cost': total_cost,
                'subtotal': total_price,
                'taxes': total_taxes,
                'total': final_total
            }
            
        except Exception as e:
            logger.error(f"Error calculating invoice totals: {e}")
            return {
                'total_quantity': 0,
                'total_cost': 0,
                'subtotal': 0,
                'taxes': 0,
                'total': 0
            }