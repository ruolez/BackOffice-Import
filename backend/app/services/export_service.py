import pandas as pd
from io import BytesIO
from typing import List, Dict, Any


def build_export_excel(rows: List[Dict[str, Any]]) -> BytesIO:
    """Build an in-memory .xlsx with columns UPC, QTY, Cost, Description.

    The column header names (UPC, QTY, Cost) match ExcelService.column_mappings
    so the exported file re-imports cleanly. Description is informational and is
    ignored by the importer.
    """
    df = pd.DataFrame(rows, columns=['UPC', 'QTY', 'Cost', 'Description'])
    df['UPC'] = df['UPC'].astype(str)  # preserve leading zeros as text
    buf = BytesIO()
    df.to_excel(buf, index=False, engine='openpyxl')
    buf.seek(0)
    return buf
