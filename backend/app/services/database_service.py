import pyodbc
import pandas as pd
from sqlalchemy import create_engine, text
from typing import Tuple, List, Dict, Any
import logging
from datetime import datetime

logger = logging.getLogger(__name__)

class DatabaseService:
    def __init__(self, database_config):
        self.config = database_config
        self.connection_string = self._build_connection_string()
    
    def _safe_int_for_db(self, value):
        """Convert value to int, using 0 for NULL values"""
        if value in [None, '', 'NULL', 'null']:
            return 0
        try:
            return int(float(value))  # Convert to float first to handle decimal strings
        except (ValueError, TypeError):
            return 0
    
    def _safe_float_for_db(self, value):
        """Convert value to float, using 0.0 for NULL values"""
        if value in [None, '', 'NULL', 'null']:
            return 0.0
        try:
            return float(value)
        except (ValueError, TypeError):
            return 0.0
    
    def _safe_string_for_db(self, value):
        """Convert value to string, using empty string for NULL values"""
        if value in [None, 'NULL', 'null', '']:
            return ''
        return str(value) if value is not None else ''
        
    def _build_connection_string(self) -> str:
        """Build SQL Server connection string"""
        # Check if server already includes instance name or port
        server_str = self.config.server
        if '\\' in server_str:
            # Server has instance name, don't add port
            server_conn = server_str
        else:
            # No instance name, add port
            server_conn = f"{server_str},{self.config.port}"
            
        conn_str = (
            f"DRIVER={{{self.config.driver}}};"
            f"SERVER={server_conn};"
            f"DATABASE={self.config.database};"
            f"UID={self.config.username};"
            f"PWD={self.config.password};"
        )
        
        # Add encryption settings
        if hasattr(self.config, 'encrypt_connection'):
            encrypt_value = "yes" if self.config.encrypt_connection else "no"
            conn_str += f"Encrypt={encrypt_value};"
            
            # For SQL Server 2012 compatibility when encryption is disabled
            if not self.config.encrypt_connection:
                conn_str += "Authentication=SqlPassword;"
        
        # Add trust server certificate setting
        if hasattr(self.config, 'trust_server_certificate') and self.config.trust_server_certificate:
            conn_str += "TrustServerCertificate=yes;"
        
        # Add minimum TLS protocol if specified
        # Note: MinProtocol might not be supported by all ODBC drivers
        # if hasattr(self.config, 'tls_min_protocol') and self.config.tls_min_protocol:
        #     conn_str += f"MinProtocol={self.config.tls_min_protocol};"
        
        return conn_str
    
    def test_connection(self) -> Tuple[bool, str]:
        """Test database connection"""
        try:
            # Log the connection string (without password for security)
            safe_conn_str = self.connection_string.replace(self.config.password, '***')
            logger.info(f"Testing connection with: {safe_conn_str}")
            
            with pyodbc.connect(self.connection_string, timeout=10) as conn:
                cursor = conn.cursor()
                cursor.execute("SELECT 1")
                cursor.fetchone()
                return True, "Connection successful"
        except pyodbc.Error as e:
            logger.error(f"Database connection failed: {e}")
            logger.error(f"Connection string was: {safe_conn_str}")
            return False, f"Connection failed: {str(e)}"
        except Exception as e:
            logger.error(f"Unexpected error during connection test: {e}")
            return False, f"Unexpected error: {str(e)}"
    
    def get_items_by_upcs(self, upcs: List[str]) -> Tuple[bool, List[Dict[str, Any]], str]:
        """Get items from Items_tbl by UPC codes"""
        try:
            if not upcs:
                return True, [], "No UPCs provided"
            
            # Create placeholders for parameterized query
            placeholders = ','.join(['?' for _ in upcs])
            
            query = f"""
            SELECT 
                i.ProductID, i.CateID, i.SubCateID, i.ProductSKU, i.ProductUPC,
                i.ProductDescription, i.ItemSize, i.UnitPrice, i.UnitCost, 
                i.ItemWeight, i.ItemTaxID, i.SPPromoted, i.SPPromotionDescription,
                i.Discontinued, i.UnitID, i.CountInUnit, i.ProductMessage,
                i.UnitPrice as OriginalPrice, i.UnitQty2, i.UnitQty3, i.UnitQty4,
                i.QuantOnHand, i.QuantOnOrder, i.LastReceived, i.LastSold,
                i.ReorderLevel, i.ReorderQuant, i.ExtDescription,
                u.UnitDesc
            FROM Items_tbl i
            LEFT JOIN Units_tbl u ON i.UnitID = u.UnitID
            WHERE i.ProductUPC IN ({placeholders})
            """
            
            with pyodbc.connect(self.connection_string, timeout=30) as conn:
                cursor = conn.cursor()
                cursor.execute(query, upcs)
                
                columns = [column[0] for column in cursor.description]
                rows = cursor.fetchall()
                
                items = []
                for row in rows:
                    item = dict(zip(columns, row))
                    items.append(item)
                
                return True, items, f"Found {len(items)} items"
                
        except pyodbc.Error as e:
            logger.error(f"Database query failed: {e}")
            return False, [], f"Database query failed: {str(e)}"
        except Exception as e:
            logger.error(f"Unexpected error during items query: {e}")
            return False, [], f"Unexpected error: {str(e)}"
    
    def get_next_invoice_number(self) -> Tuple[bool, int, str]:
        """Get the next invoice number by incrementing the highest existing number"""
        try:
            query = """
            SELECT MAX(CAST(InvoiceNumber AS INT)) as MaxInvoiceNumber
            FROM Invoices_tbl 
            WHERE ISNUMERIC(InvoiceNumber) = 1
            """
            
            with pyodbc.connect(self.connection_string, timeout=30) as conn:
                cursor = conn.cursor()
                cursor.execute(query)
                result = cursor.fetchone()
                
                max_number = result.MaxInvoiceNumber if result.MaxInvoiceNumber else 0
                next_number = max_number + 1
                
                return True, next_number, f"Next invoice number: {next_number}"
                
        except pyodbc.Error as e:
            logger.error(f"Failed to get next invoice number: {e}")
            return False, 1, f"Database query failed: {str(e)}"
        except Exception as e:
            logger.error(f"Unexpected error getting next invoice number: {e}")
            return False, 1, f"Unexpected error: {str(e)}"
    
    def create_invoice(self, invoice_data: Dict[str, Any], invoice_details: List[Dict[str, Any]]) -> Tuple[bool, int, str]:
        """Create a new invoice with details"""
        try:
            with pyodbc.connect(self.connection_string, timeout=60) as conn:
                cursor = conn.cursor()
                
                # Start transaction
                conn.autocommit = False
                
                try:
                    # Insert invoice header with customer information and proper NULL handling
                    insert_invoice_query = """
                    INSERT INTO Invoices_tbl (
                        InvoiceNumber, InvoiceDate, InvoiceType, InvoiceTitle,
                        CustomerID, BusinessName, AccountNo, 
                        PoNumber, ShipDate, Shipto, ShipAddress1, ShipAddress2, ShipContact,
                        ShipCity, ShipState, ShipZipCode, ShipPhoneNo,
                        DriverID, TermID, SalesRepID, ShipperID, TrackingNo, ShippingCost,
                        TotQtyOrd, TotQtyShp, TotQtyRtrnd, NoLines, TotalWeight,
                        InvoiceSubtotal, TotalTaxes, InvoiceTotal, 
                        Notes, Header, Footer, Imported, Pos, Void
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """
                    
                    cursor.execute(insert_invoice_query, (
                        self._safe_string_for_db(invoice_data.get('invoice_number')),        # String
                        self._safe_string_for_db(invoice_data.get('invoice_date')),          # String
                        self._safe_string_for_db(invoice_data.get('invoice_type', 'Purchase')), # String
                        self._safe_string_for_db(invoice_data.get('invoice_title', 'Excel Import')), # String
                        self._safe_int_for_db(invoice_data.get('customer_id')),              # Integer
                        self._safe_string_for_db(invoice_data.get('business_name')),         # String
                        self._safe_string_for_db(invoice_data.get('account_no')),            # String
                        self._safe_string_for_db(invoice_data.get('po_number')),             # String - PO Number
                        datetime.now(),                                                      # Date - Today's date
                        self._safe_string_for_db(invoice_data.get('ship_to')),               # String
                        self._safe_string_for_db(invoice_data.get('ship_address1')),         # String
                        self._safe_string_for_db(invoice_data.get('ship_address2')),         # String
                        self._safe_string_for_db(invoice_data.get('ship_contact')),          # String
                        self._safe_string_for_db(invoice_data.get('ship_city')),             # String
                        self._safe_string_for_db(invoice_data.get('ship_state')),            # String
                        self._safe_string_for_db(invoice_data.get('ship_zipcode')),          # String
                        self._safe_string_for_db(invoice_data.get('ship_phone')),            # String
                        self._safe_int_for_db(invoice_data.get('driver_id')),                # Integer
                        self._safe_int_for_db(invoice_data.get('term_id')),                  # Integer
                        self._safe_int_for_db(invoice_data.get('sales_rep_id')),             # Integer
                        self._safe_int_for_db(invoice_data.get('shipper_id')),               # Integer
                        self._safe_string_for_db(invoice_data.get('tracking_no')),           # String
                        self._safe_float_for_db(invoice_data.get('shipping_cost')),          # Money/Float
                        self._safe_float_for_db(invoice_data.get('total_qty_ordered')),      # Float
                        self._safe_float_for_db(invoice_data.get('total_qty_shipped')),      # Float
                        0,                                                                   # TotQtyRtrnd = 0
                        self._safe_int_for_db(invoice_data.get('no_lines')),                 # Integer
                        self._safe_float_for_db(invoice_data.get('total_weight')),           # Float
                        self._safe_float_for_db(invoice_data.get('invoice_subtotal')),       # Float
                        self._safe_float_for_db(invoice_data.get('total_taxes')),            # Float
                        self._safe_float_for_db(invoice_data.get('invoice_total')),          # Float
                        self._safe_string_for_db(''),                                        # Notes - empty string
                        self._safe_string_for_db(''),                                        # Header - empty string
                        self._safe_string_for_db(''),                                        # Footer - empty string
                        1,  # Imported = True
                        0,  # Pos = False
                        0   # Void = False
                    ))
                    
                    # Get the inserted InvoiceID
                    cursor.execute("SELECT @@IDENTITY")
                    invoice_id = cursor.fetchone()[0]
                    
                    # Insert invoice details with additional fields and proper NULL handling
                    insert_detail_query = """
                    INSERT INTO InvoicesDetails_tbl (
                        InvoiceID, CateID, SubCateID, ProductID, ProductSKU,
                        ProductUPC, ProductDescription, ItemSize, UnitPrice, OriginalPrice,
                        UnitCost, QtyOrdered, QtyShipped, ExtendedPrice, ExtendedCost,
                        ItemWeight, ItemTaxID, Taxable, SPPromoted, SPPromotionDescription,
                        LineMessage, UnitDesc, UnitQty, 
                        RememberPrice, Discount, ds_Percent, Packing, ExtendedDisc,
                        PromotionDescription, PromotionAmount, Void
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """
                    
                    for detail in invoice_details:
                        cursor.execute(insert_detail_query, (
                            invoice_id,                                                        # Integer (auto-generated)
                            self._safe_int_for_db(detail.get('CateID')),                     # Integer
                            self._safe_int_for_db(detail.get('SubCateID')),                  # Integer
                            self._safe_int_for_db(detail.get('ProductID')),                  # Integer
                            self._safe_string_for_db(detail.get('ProductSKU')),              # String
                            self._safe_string_for_db(detail.get('ProductUPC')),              # String
                            self._safe_string_for_db(detail.get('ProductDescription')),      # String
                            self._safe_string_for_db(detail.get('ItemSize')),                # String
                            self._safe_float_for_db(detail.get('UnitPrice')),                # Float
                            self._safe_float_for_db(detail.get('OriginalPrice')),            # Float
                            self._safe_float_for_db(detail.get('UnitCost')),                 # Float
                            self._safe_float_for_db(detail.get('QtyOrdered')),               # Float
                            self._safe_float_for_db(detail.get('QtyShipped')),               # Float
                            self._safe_float_for_db(detail.get('ExtendedPrice')),            # Float
                            self._safe_float_for_db(detail.get('ExtendedCost')),             # Float
                            self._safe_float_for_db(detail.get('ItemWeight')),               # Float
                            self._safe_int_for_db(detail.get('ItemTaxID')),                  # Integer
                            1 if detail.get('Taxable', False) else 0,                        # Boolean as int
                            1 if detail.get('SPPromoted', False) else 0,                     # Boolean as int
                            self._safe_string_for_db(detail.get('SPPromotionDescription')),  # String
                            self._safe_string_for_db(detail.get('LineMessage')),             # String
                            self._safe_string_for_db(detail.get('UnitDesc')),                # String
                            self._safe_float_for_db(detail.get('UnitQty')),                  # Float
                            0.0,                                                             # RememberPrice = 0
                            0.0,                                                             # Discount = 0
                            0.0,                                                             # ds_Percent = 0
                            self._safe_string_for_db(''),                                   # Packing = blank
                            0.0,                                                             # ExtendedDisc = 0
                            self._safe_string_for_db(''),                                   # PromotionDescription = blank
                            0.0,                                                             # PromotionAmount = 0
                            0  # Void = False
                        ))
                    
                    # Commit transaction
                    conn.commit()
                    
                    return True, invoice_id, f"Invoice {invoice_data['invoice_number']} created successfully"
                    
                except Exception as e:
                    conn.rollback()
                    raise e
                
        except pyodbc.Error as e:
            logger.error(f"Failed to create invoice: {e}")
            return False, 0, f"Database error: {str(e)}"
        except Exception as e:
            logger.error(f"Unexpected error creating invoice: {e}")
            return False, 0, f"Unexpected error: {str(e)}"
    
    def search_customers_by_account(self, account_search: str) -> Tuple[bool, List[Dict[str, Any]], str]:
        """Search customers by AccountNo (partial match)"""
        try:
            if not account_search:
                return True, [], "No search term provided"
            
            query = """
            SELECT 
                CustomerID, AccountNo, BusinessName, Location_Number,
                Address1, City, State, ZipCode, Phone_Number, Contactname
            FROM Customers_tbl 
            WHERE AccountNo LIKE ? AND Discontinued != 1
            ORDER BY AccountNo
            """
            
            search_term = f"%{account_search}%"
            
            with pyodbc.connect(self.connection_string, timeout=30) as conn:
                cursor = conn.cursor()
                cursor.execute(query, (search_term,))
                
                columns = [column[0] for column in cursor.description]
                rows = cursor.fetchall()
                
                customers = []
                for row in rows:
                    customer = dict(zip(columns, row))
                    customers.append(customer)
                
                return True, customers, f"Found {len(customers)} customers"
                
        except pyodbc.Error as e:
            logger.error(f"Customer search failed: {e}")
            return False, [], f"Database query failed: {str(e)}"
        except Exception as e:
            logger.error(f"Unexpected error during customer search: {e}")
            return False, [], f"Unexpected error: {str(e)}"
    
    def get_customer_by_id(self, customer_id: int) -> Tuple[bool, Dict[str, Any], str]:
        """Get full customer record by CustomerID"""
        try:
            query = """
            SELECT 
                CustomerID, AccountNo, BusinessName, Location_Number,
                Address1, Address2, City, State, ZipCode, Phone_Number, Fax_Number,
                Contactname, ShipTo, ShipContact, ShipAddress1, ShipAddress2,
                ShipCity, ShipState, ShipZipCode, ShipPhone_Number,
                TermID, SalesRepID, RouteID, PriceLevel, TaxDefID,
                CreditLimit, Balance, CustomerSince, Notes
            FROM Customers_tbl 
            WHERE CustomerID = ?
            """
            
            with pyodbc.connect(self.connection_string, timeout=30) as conn:
                cursor = conn.cursor()
                cursor.execute(query, (customer_id,))
                
                columns = [column[0] for column in cursor.description]
                row = cursor.fetchone()
                
                if not row:
                    return False, {}, f"Customer with ID {customer_id} not found"
                
                customer = dict(zip(columns, row))
                return True, customer, "Customer found"
                
        except pyodbc.Error as e:
            logger.error(f"Customer retrieval failed: {e}")
            return False, {}, f"Database query failed: {str(e)}"
        except Exception as e:
            logger.error(f"Unexpected error during customer retrieval: {e}")
            return False, {}, f"Unexpected error: {str(e)}"

    def execute_query(self, query: str, params: List[Any] = None) -> Tuple[bool, List[Dict[str, Any]], str]:
        """Execute a generic query and return results"""
        try:
            with pyodbc.connect(self.connection_string, timeout=30) as conn:
                cursor = conn.cursor()
                
                if params:
                    cursor.execute(query, params)
                else:
                    cursor.execute(query)
                
                columns = [column[0] for column in cursor.description]
                rows = cursor.fetchall()
                
                results = []
                for row in rows:
                    result = dict(zip(columns, row))
                    results.append(result)
                
                return True, results, f"Query executed successfully, {len(results)} rows returned"
                
        except pyodbc.Error as e:
            logger.error(f"Query execution failed: {e}")
            return False, [], f"Database query failed: {str(e)}"
        except Exception as e:
            logger.error(f"Unexpected error during query execution: {e}")
            return False, [], f"Unexpected error: {str(e)}"

    def search_suppliers_by_account(self, account_search: str) -> Tuple[bool, List[Dict[str, Any]], str]:
        """Search suppliers by AccountNo (partial match)"""
        try:
            if not account_search:
                return True, [], "No search term provided"
            
            query = """
            SELECT 
                SupplierID, AccountNo, BusinessName, StateTaxID,
                Address1, Address2, City, State, ZipCode, Phone_Number, 
                Fax_Number, Contactname, Email, web_url
            FROM Suppliers_tbl 
            WHERE AccountNo LIKE ? AND Discontinued != 1
            ORDER BY AccountNo
            """
            
            search_term = f"%{account_search}%"
            
            with pyodbc.connect(self.connection_string, timeout=30) as conn:
                cursor = conn.cursor()
                cursor.execute(query, (search_term,))
                
                columns = [column[0] for column in cursor.description]
                rows = cursor.fetchall()
                
                suppliers = []
                for row in rows:
                    supplier = dict(zip(columns, row))
                    suppliers.append(supplier)
                
                return True, suppliers, f"Found {len(suppliers)} suppliers"
                
        except pyodbc.Error as e:
            logger.error(f"Supplier search failed: {e}")
            return False, [], f"Database query failed: {str(e)}"
        except Exception as e:
            logger.error(f"Unexpected error during supplier search: {e}")
            return False, [], f"Unexpected error: {str(e)}"
    
    def get_supplier_by_id(self, supplier_id: int) -> Tuple[bool, Dict[str, Any], str]:
        """Get full supplier record by SupplierID"""
        try:
            query = """
            SELECT 
                SupplierID, AccountNo, BusinessName, StateTaxID,
                Address1, Address2, City, State, ZipCode, Phone_Number, 
                Fax_Number, Contactname, Email, web_url, Notes, Discontinued
            FROM Suppliers_tbl 
            WHERE SupplierID = ?
            """
            
            with pyodbc.connect(self.connection_string, timeout=30) as conn:
                cursor = conn.cursor()
                cursor.execute(query, (supplier_id,))
                
                columns = [column[0] for column in cursor.description]
                row = cursor.fetchone()
                
                if not row:
                    return False, {}, f"Supplier with ID {supplier_id} not found"
                
                supplier = dict(zip(columns, row))
                return True, supplier, "Supplier found"
                
        except pyodbc.Error as e:
            logger.error(f"Supplier retrieval failed: {e}")
            return False, {}, f"Database query failed: {str(e)}"
        except Exception as e:
            logger.error(f"Unexpected error during supplier retrieval: {e}")
            return False, {}, f"Unexpected error: {str(e)}"

    def get_next_po_number(self) -> Tuple[bool, int, str]:
        """Get the next purchase order number by incrementing the highest existing number"""
        try:
            # First, try to get all PO numbers and filter/convert them safely
            query = """
            SELECT PoNumber
            FROM PurchaseOrders_tbl 
            WHERE PoNumber IS NOT NULL AND PoNumber != ''
            """
            
            with pyodbc.connect(self.connection_string, timeout=30) as conn:
                cursor = conn.cursor()
                cursor.execute(query)
                results = cursor.fetchall()
                
                max_number = 0
                
                # Process each PO number to find the highest valid integer
                for row in results:
                    po_number = row.PoNumber
                    if po_number:
                        # Try to convert to int, skip if it fails or overflows
                        try:
                            # Only consider numeric values that can fit in a 32-bit int
                            if po_number.isdigit() and len(po_number) <= 10:
                                num_value = int(po_number)
                                # Check if it's within reasonable bounds (avoid overflow)
                                if 0 <= num_value <= 2147483647:  # Max 32-bit signed int
                                    max_number = max(max_number, num_value)
                        except (ValueError, OverflowError):
                            # Skip invalid numbers
                            continue
                
                next_number = max_number + 1
                
                return True, next_number, f"Next PO number: {next_number}"
                
        except pyodbc.Error as e:
            logger.error(f"Failed to get next PO number: {e}")
            return False, 1, f"Database query failed: {str(e)}"
        except Exception as e:
            logger.error(f"Unexpected error getting next PO number: {e}")
            return False, 1, f"Unexpected error: {str(e)}"

    def get_invoices_list(self, page: int = 1, per_page: int = 25, search: str = None) -> Tuple[bool, Dict[str, Any], str]:
        """Get paginated list of invoices with optional search by InvoiceNumber"""
        try:
            offset = (page - 1) * per_page

            where_clause = "WHERE (Void != 1 OR Void IS NULL)"
            params = []

            if search:
                where_clause += " AND InvoiceNumber LIKE ?"
                params.append(f"%{search}%")

            count_query = f"SELECT COUNT(*) as total FROM Invoices_tbl {where_clause}"

            list_query = f"""
            SELECT
                InvoiceID, InvoiceNumber, InvoiceDate, BusinessName, AccountNo,
                InvoiceTotal, NoLines
            FROM Invoices_tbl
            {where_clause}
            ORDER BY InvoiceID DESC
            OFFSET ? ROWS FETCH NEXT ? ROWS ONLY
            """

            params_list = params + [offset, per_page]

            with pyodbc.connect(self.connection_string, timeout=30) as conn:
                cursor = conn.cursor()

                cursor.execute(count_query, params)
                total = cursor.fetchone()[0]

                cursor.execute(list_query, params_list)
                columns = [column[0] for column in cursor.description]
                rows = cursor.fetchall()

                invoices = []
                for row in rows:
                    invoice = dict(zip(columns, row))
                    if invoice.get('InvoiceDate'):
                        invoice['InvoiceDate'] = str(invoice['InvoiceDate'])
                    invoices.append(invoice)

                total_pages = (total + per_page - 1) // per_page

                result = {
                    'invoices': invoices,
                    'pagination': {
                        'page': page,
                        'per_page': per_page,
                        'total': total,
                        'total_pages': total_pages,
                        'has_next': page < total_pages,
                        'has_prev': page > 1
                    }
                }

                return True, result, f"Found {total} invoices"

        except pyodbc.Error as e:
            logger.error(f"Failed to get invoices list: {e}")
            return False, {}, f"Database query failed: {str(e)}"
        except Exception as e:
            logger.error(f"Unexpected error getting invoices list: {e}")
            return False, {}, f"Unexpected error: {str(e)}"

    def get_invoice_with_details(self, invoice_id: int) -> Tuple[bool, Dict[str, Any], str]:
        """Get full invoice header and all line items"""
        try:
            header_query = """
            SELECT
                InvoiceID, InvoiceNumber, InvoiceDate, InvoiceType, InvoiceTitle,
                CustomerID, BusinessName, AccountNo,
                Shipto, ShipAddress1, ShipAddress2, ShipContact,
                ShipCity, ShipState, ShipZipCode, ShipPhoneNo,
                TermID, SalesRepID, TotQtyOrd, TotQtyShp, NoLines, TotalWeight,
                InvoiceSubtotal, TotalTaxes, InvoiceTotal
            FROM Invoices_tbl
            WHERE InvoiceID = ?
            """

            details_query = """
            SELECT
                InvoiceDetailID, InvoiceID, CateID, SubCateID, ProductID,
                ProductSKU, ProductUPC, ProductDescription, ItemSize,
                UnitPrice, OriginalPrice, UnitCost, QtyOrdered, QtyShipped,
                ExtendedPrice, ExtendedCost, ItemWeight, ItemTaxID,
                Taxable, SPPromoted, SPPromotionDescription, LineMessage,
                UnitDesc, UnitQty, CountInUnit
            FROM InvoicesDetails_tbl
            WHERE InvoiceID = ?
            """

            with pyodbc.connect(self.connection_string, timeout=30) as conn:
                cursor = conn.cursor()

                cursor.execute(header_query, (invoice_id,))
                columns = [column[0] for column in cursor.description]
                row = cursor.fetchone()

                if not row:
                    return False, {}, f"Invoice with ID {invoice_id} not found"

                invoice = dict(zip(columns, row))
                if invoice.get('InvoiceDate'):
                    invoice['InvoiceDate'] = str(invoice['InvoiceDate'])

                cursor.execute(details_query, (invoice_id,))
                detail_columns = [column[0] for column in cursor.description]
                detail_rows = cursor.fetchall()

                details = []
                for detail_row in detail_rows:
                    details.append(dict(zip(detail_columns, detail_row)))

                result = {
                    'invoice': invoice,
                    'details': details
                }

                return True, result, f"Invoice {invoice.get('InvoiceNumber')} found with {len(details)} lines"

        except pyodbc.Error as e:
            logger.error(f"Failed to get invoice details: {e}")
            return False, {}, f"Database query failed: {str(e)}"
        except Exception as e:
            logger.error(f"Unexpected error getting invoice details: {e}")
            return False, {}, f"Unexpected error: {str(e)}"

    def create_purchase_order(self, po_data: Dict[str, Any], po_details: List[Dict[str, Any]]) -> Tuple[bool, int, str]:
        """Create a new purchase order with details"""
        try:
            with pyodbc.connect(self.connection_string, timeout=60) as conn:
                cursor = conn.cursor()
                
                # Start transaction
                conn.autocommit = False
                
                try:
                    # Insert purchase order header with supplier information and proper NULL handling
                    insert_po_query = """
                    INSERT INTO PurchaseOrders_tbl (
                        PoDate, RequiredDate, PoNumber, SupplierID, BusinessName, AccountNo,
                        PoTitle, Status, Shipto, ShipAddress1, ShipAddress2, ShipContact,
                        ShipCity, ShipState, ShipZipCode, ShipPhoneNo, EmployeeID, TermID,
                        PoTotal, NoLines, ShipperID, TotQtyOrd, TotQtyRcv, 
                        Notes, PoHeader, PoFooter
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """
                    
                    cursor.execute(insert_po_query, (
                        datetime.now(),                                                 # PoDate - today's date
                        datetime.now(),                                                 # RequiredDate - today's date
                        self._safe_string_for_db(po_data.get('po_number')),            # String
                        self._safe_int_for_db(po_data.get('supplier_id')),             # Integer
                        self._safe_string_for_db(po_data.get('business_name')),        # String
                        self._safe_string_for_db(po_data.get('account_no')),           # String
                        self._safe_string_for_db(po_data.get('po_title', 'Excel Import')), # String
                        self._safe_int_for_db(po_data.get('status', 0)),               # Integer (0 = new)
                        self._safe_string_for_db(po_data.get('ship_to')),              # String
                        self._safe_string_for_db(po_data.get('ship_address1')),        # String
                        self._safe_string_for_db(po_data.get('ship_address2')),        # String
                        self._safe_string_for_db(po_data.get('ship_contact')),         # String
                        self._safe_string_for_db(po_data.get('ship_city')),            # String
                        self._safe_string_for_db(po_data.get('ship_state')),           # String
                        self._safe_string_for_db(po_data.get('ship_zipcode')),         # String
                        self._safe_string_for_db(po_data.get('ship_phone')),           # String
                        self._safe_int_for_db(po_data.get('employee_id')),             # Integer
                        self._safe_int_for_db(po_data.get('term_id')),                 # Integer
                        self._safe_float_for_db(po_data.get('po_total')),              # Money/Float
                        self._safe_int_for_db(po_data.get('no_lines')),                # Integer
                        self._safe_int_for_db(po_data.get('shipper_id')),              # Integer
                        self._safe_float_for_db(po_data.get('total_qty_ordered')),     # Float
                        self._safe_float_for_db(po_data.get('total_qty_received')),    # Float
                        self._safe_string_for_db(''),                                  # Notes - empty string
                        self._safe_string_for_db(''),                                  # PoHeader - empty string
                        self._safe_string_for_db('')                                   # PoFooter - empty string
                    ))
                    
                    # Get the inserted PoID
                    cursor.execute("SELECT @@IDENTITY")
                    po_id = cursor.fetchone()[0]
                    
                    # Insert purchase order details with proper NULL handling
                    insert_detail_query = """
                    INSERT INTO PurchaseOrdersDetails_tbl (
                        PoID, ProductID, CateID, SubCateID, UnitDesc, UnitQty,
                        ProductSKU, ProductUPC, SupplierSKU, ProductDescription, ItemSize,
                        ExpDate, ReasonID, QtyOrdered, QtyReceived, ItemWeight,
                        UnitCost, ExtendedCost, DateReceived, Committedln, Flag
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """
                    
                    for detail in po_details:
                        cursor.execute(insert_detail_query, (
                            po_id,                                                          # Integer (auto-generated)
                            self._safe_int_for_db(detail.get('ProductID')),               # Integer
                            self._safe_int_for_db(detail.get('CateID')),                  # Integer
                            self._safe_int_for_db(detail.get('SubCateID')),               # Integer
                            self._safe_string_for_db(detail.get('UnitDesc')),             # String
                            self._safe_float_for_db(detail.get('UnitQty')),               # Float
                            self._safe_string_for_db(detail.get('ProductSKU')),           # String
                            self._safe_string_for_db(detail.get('ProductUPC')),           # String
                            self._safe_string_for_db(detail.get('SupplierSKU')),          # String
                            self._safe_string_for_db(detail.get('ProductDescription')),   # String
                            self._safe_string_for_db(detail.get('ItemSize')),             # String
                            self._safe_string_for_db(detail.get('ExpDate')),              # String
                            self._safe_int_for_db(detail.get('ReasonID')),                # Integer
                            self._safe_float_for_db(detail.get('QtyOrdered')),            # Float
                            self._safe_float_for_db(detail.get('QtyReceived')),           # Float
                            self._safe_string_for_db(detail.get('ItemWeight')),           # String
                            self._safe_float_for_db(detail.get('UnitCost')),              # Money/Float
                            self._safe_float_for_db(detail.get('ExtendedCost')),          # Money/Float
                            datetime.now(),                                               # Date - today's date
                            1 if detail.get('Committedln', False) else 0,                # Boolean as int
                            1 if detail.get('Flag', False) else 0                        # Boolean as int
                        ))
                    
                    # Commit transaction
                    conn.commit()
                    
                    return True, po_id, f"Purchase order {po_data['po_number']} created successfully"
                    
                except Exception as e:
                    conn.rollback()
                    raise e
                
        except pyodbc.Error as e:
            logger.error(f"Failed to create purchase order: {e}")
            return False, 0, f"Database error: {str(e)}"
        except Exception as e:
            logger.error(f"Unexpected error creating purchase order: {e}")
            return False, 0, f"Unexpected error: {str(e)}"