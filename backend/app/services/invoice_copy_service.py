from typing import Tuple, List, Dict, Any
from datetime import datetime
import logging

logger = logging.getLogger(__name__)


class InvoiceCopyService:

    def _safe_float_convert(self, value):
        if value in [None, '', 'NULL', 'null']:
            return 0.0
        try:
            return float(value)
        except (ValueError, TypeError):
            return 0.0

    def _safe_int_convert(self, value):
        if value in [None, '', 'NULL', 'null']:
            return 0
        try:
            return int(float(value))
        except (ValueError, TypeError):
            return 0

    def _safe_string_convert(self, value):
        if value in [None, 'NULL', 'null', '']:
            return ''
        return str(value) if value is not None else ''

    def build_copy_preview(
        self,
        source_details: List[Dict[str, Any]],
        dest_items: List[Dict[str, Any]],
        customer_data: Dict[str, Any],
        next_number: int,
        source_invoice_number: str
    ) -> Tuple[bool, Dict[str, Any], List[Dict[str, Any]], str]:
        upc_to_dest_item = {item['ProductUPC']: item for item in dest_items}

        invoice_lines = []
        missing_upcs = []
        total_qty_ordered = 0
        total_qty_shipped = 0
        total_cost = 0
        total_price = 0
        total_weight = 0

        for source_line in source_details:
            upc = self._safe_string_convert(source_line.get('ProductUPC'))
            if not upc:
                continue

            if upc in upc_to_dest_item:
                dest_item = upc_to_dest_item[upc]

                unit_price = self._safe_float_convert(source_line.get('UnitPrice'))
                unit_cost = self._safe_float_convert(source_line.get('UnitCost'))
                original_price = self._safe_float_convert(source_line.get('OriginalPrice'))
                qty_ordered = self._safe_float_convert(source_line.get('QtyOrdered'))
                qty_shipped = self._safe_float_convert(source_line.get('QtyShipped'))

                extended_price = unit_price * qty_ordered
                extended_cost = unit_cost * qty_ordered

                invoice_line = {
                    'ProductID': self._safe_int_convert(dest_item['ProductID']),
                    'CateID': self._safe_int_convert(dest_item['CateID']),
                    'SubCateID': self._safe_int_convert(dest_item['SubCateID']),
                    'ProductSKU': self._safe_string_convert(dest_item['ProductSKU']),
                    'ProductUPC': self._safe_string_convert(dest_item['ProductUPC']),
                    'ProductDescription': self._safe_string_convert(dest_item['ProductDescription']),
                    'ItemSize': self._safe_string_convert(dest_item['ItemSize']),
                    'UnitPrice': unit_price,
                    'OriginalPrice': original_price,
                    'UnitCost': unit_cost,
                    'QtyOrdered': qty_ordered,
                    'QtyShipped': qty_shipped,
                    'ExtendedPrice': extended_price,
                    'ExtendedCost': extended_cost,
                    'ItemWeight': self._safe_float_convert(dest_item.get('ItemWeight')),
                    'ItemTaxID': self._safe_int_convert(dest_item.get('ItemTaxID')),
                    'Taxable': False,
                    'SPPromoted': dest_item.get('SPPromoted', False),
                    'SPPromotionDescription': self._safe_string_convert(dest_item.get('SPPromotionDescription', '')),
                    'ProductMessage': self._safe_string_convert(dest_item.get('ProductMessage', '')),
                    'LineMessage': self._safe_string_convert(dest_item.get('ProductMessage', '')),
                    'UnitDesc': self._safe_string_convert(dest_item.get('UnitDesc', '')),
                    'UnitQty': 1.0,
                    'CountInUnit': self._safe_int_convert(dest_item.get('CountInUnit')),
                }

                invoice_lines.append(invoice_line)

                total_qty_ordered += qty_ordered
                total_qty_shipped += qty_shipped
                total_cost += extended_cost
                total_price += extended_price
                item_weight = self._safe_float_convert(dest_item.get('ItemWeight', 0))
                total_weight += item_weight * qty_ordered

            else:
                missing_upcs.append({
                    'upc': upc,
                    'description': self._safe_string_convert(source_line.get('ProductDescription')),
                    'qty': self._safe_float_convert(source_line.get('QtyOrdered')),
                    'unit_price': self._safe_float_convert(source_line.get('UnitPrice')),
                })

        if not invoice_lines:
            return False, {}, missing_upcs, "No matching items found in destination database"

        tax_rate = 0.0
        total_taxes = total_price * tax_rate

        invoice_preview = {
            'invoice_number': str(next_number),
            'invoice_date': datetime.now().strftime('%Y-%m-%d'),
            'invoice_type': 'Purchase',
            'invoice_title': f'Copy of Invoice #{source_invoice_number}',
            'customer_id': customer_data.get('CustomerID'),
            'business_name': customer_data.get('BusinessName'),
            'account_no': customer_data.get('AccountNo'),
            'ship_to': customer_data.get('ShipTo'),
            'ship_address1': customer_data.get('ShipAddress1'),
            'ship_address2': customer_data.get('ShipAddress2'),
            'ship_city': customer_data.get('ShipCity'),
            'ship_state': customer_data.get('ShipState'),
            'ship_zipcode': customer_data.get('ShipZipCode'),
            'ship_phone': customer_data.get('ShipPhone_Number'),
            'term_id': customer_data.get('TermID'),
            'sales_rep_id': customer_data.get('SalesRepID'),
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

        return True, invoice_preview, missing_upcs, f"Invoice copy preview created with {len(invoice_lines)} lines"

    def prepare_invoice_data(self, invoice_preview: Dict[str, Any]) -> Tuple[Dict[str, Any], List[Dict[str, Any]]]:
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
                'ItemWeight': self._safe_float_convert(line.get('ItemWeight')),
                'ItemTaxID': self._safe_int_convert(line.get('ItemTaxID')),
                'Taxable': bool(line.get('Taxable', False)),
                'SPPromoted': bool(line.get('SPPromoted', False)),
                'SPPromotionDescription': self._safe_string_convert(line.get('SPPromotionDescription', '')),
                'LineMessage': self._safe_string_convert(line.get('LineMessage', '')),
                'UnitDesc': self._safe_string_convert(line.get('UnitDesc', '')),
                'UnitQty': self._safe_float_convert(line.get('UnitQty', 1.0))
            }
            invoice_details.append(detail)

        return invoice_data, invoice_details
