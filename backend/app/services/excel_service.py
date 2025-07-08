import pandas as pd
import os
from typing import Tuple, List, Dict, Any
import logging

logger = logging.getLogger(__name__)

class ExcelService:
    """Service for processing Excel files"""
    
    def __init__(self):
        self.required_columns = ['UPC', 'Cost', 'QTY']
        self.column_mappings = {
            'UPC': ['UPC', 'upc', 'ProductUPC', 'product_upc', 'Barcode', 'barcode'],
            'Cost': ['Cost', 'cost', 'UnitCost', 'unit_cost', 'Price', 'price'],
            'QTY': ['QTY', 'qty', 'Quantity', 'quantity', 'Qty', 'Amount', 'amount']
        }
    
    def process_excel_file(self, filepath: str) -> Tuple[bool, List[Dict[str, Any]], str]:
        """Process Excel file and extract UPC, Cost, QTY data"""
        try:
            if not os.path.exists(filepath):
                return False, [], "File not found"
            
            # Read Excel file
            try:
                df = pd.read_excel(filepath, engine='openpyxl')
            except Exception as e:
                # Try with xlrd engine for older Excel files
                try:
                    df = pd.read_excel(filepath, engine='xlrd')
                except Exception as e2:
                    return False, [], f"Failed to read Excel file: {str(e2)}"
            
            if df.empty:
                return False, [], "Excel file is empty"
            
            # Find column mappings
            column_map = self._find_column_mappings(df.columns.tolist())
            
            # Check if all required columns are found
            missing_columns = []
            for required_col in self.required_columns:
                if required_col not in column_map:
                    missing_columns.append(required_col)
            
            if missing_columns:
                return False, [], f"Missing required columns: {', '.join(missing_columns)}. Available columns: {', '.join(df.columns.tolist())}"
            
            # Rename columns to standard names
            df_renamed = df.rename(columns={v: k for k, v in column_map.items()})
            
            # Clean and validate data
            processed_data = self._clean_and_validate_data(df_renamed)
            
            if not processed_data:
                return False, [], "No valid data rows found in Excel file"
            
            return True, processed_data, f"Successfully processed {len(processed_data)} rows"
            
        except Exception as e:
            logger.error(f"Error processing Excel file: {e}")
            return False, [], f"Error processing Excel file: {str(e)}"
    
    def _find_column_mappings(self, available_columns: List[str]) -> Dict[str, str]:
        """Find mappings between required columns and available columns"""
        column_map = {}
        
        for required_col in self.required_columns:
            possible_names = self.column_mappings.get(required_col, [])
            
            for col_name in available_columns:
                if col_name.strip() in possible_names:
                    column_map[required_col] = col_name.strip()
                    break
        
        return column_map
    
    def _clean_and_validate_data(self, df: pd.DataFrame) -> List[Dict[str, Any]]:
        """Clean and validate Excel data"""
        processed_data = []
        
        for index, row in df.iterrows():
            try:
                # Skip empty rows
                if pd.isna(row['UPC']) or pd.isna(row['Cost']) or pd.isna(row['QTY']):
                    continue
                
                # Clean UPC (remove any leading/trailing whitespace and decimal points)
                upc = str(row['UPC']).strip()
                if not upc or upc.lower() == 'nan':
                    continue
                
                # Remove period and everything after it (Excel formatting artifacts)
                if '.' in upc:
                    upc = upc.split('.')[0]
                
                # Clean and validate Cost
                try:
                    cost = float(row['Cost'])
                    if cost < 0:
                        logger.warning(f"Row {index + 1}: Negative cost value {cost}")
                        continue
                except (ValueError, TypeError):
                    logger.warning(f"Row {index + 1}: Invalid cost value {row['Cost']}")
                    continue
                
                # Clean and validate QTY
                try:
                    qty = float(row['QTY'])
                    if qty <= 0:
                        logger.warning(f"Row {index + 1}: Invalid quantity value {qty}")
                        continue
                except (ValueError, TypeError):
                    logger.warning(f"Row {index + 1}: Invalid quantity value {row['QTY']}")
                    continue
                
                # Add to processed data
                processed_data.append({
                    'UPC': upc,
                    'Cost': cost,
                    'QTY': qty,
                    'row_number': index + 1
                })
                
            except Exception as e:
                logger.warning(f"Row {index + 1}: Error processing row - {str(e)}")
                continue
        
        return processed_data
    
    def validate_excel_structure(self, filepath: str) -> Tuple[bool, Dict[str, Any], str]:
        """Validate Excel file structure without processing data"""
        try:
            if not os.path.exists(filepath):
                return False, {}, "File not found"
            
            # Read just the header
            try:
                df = pd.read_excel(filepath, nrows=0, engine='openpyxl')
            except Exception as e:
                try:
                    df = pd.read_excel(filepath, nrows=0, engine='xlrd')
                except Exception as e2:
                    return False, {}, f"Failed to read Excel file: {str(e2)}"
            
            available_columns = df.columns.tolist()
            column_map = self._find_column_mappings(available_columns)
            
            # Check which columns are found/missing
            found_columns = []
            missing_columns = []
            
            for required_col in self.required_columns:
                if required_col in column_map:
                    found_columns.append(required_col)
                else:
                    missing_columns.append(required_col)
            
            validation_result = {
                'available_columns': available_columns,
                'found_columns': found_columns,
                'missing_columns': missing_columns,
                'column_mappings': column_map
            }
            
            if missing_columns:
                return False, validation_result, f"Missing required columns: {', '.join(missing_columns)}"
            
            return True, validation_result, "Excel file structure is valid"
            
        except Exception as e:
            logger.error(f"Error validating Excel structure: {e}")
            return False, {}, f"Error validating Excel file: {str(e)}"