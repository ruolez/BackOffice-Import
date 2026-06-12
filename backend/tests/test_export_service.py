import tempfile
import os

from app.services.export_service import build_export_excel
from app.services.excel_service import ExcelService


def _write_to_tempfile(buf) -> str:
    fd, path = tempfile.mkstemp(suffix='.xlsx')
    with os.fdopen(fd, 'wb') as f:
        f.write(buf.getvalue())
    return path


class TestBuildExportExcel:
    def test_export_round_trips_through_importer(self):
        rows = [
            {'UPC': '012345678905', 'QTY': 3.0, 'Cost': 9.99, 'Description': 'Widget A'},
            {'UPC': '098765432109', 'QTY': 1.0, 'Cost': 24.50, 'Description': 'Widget B'},
        ]

        path = _write_to_tempfile(build_export_excel(rows))
        try:
            success, parsed, _ = ExcelService().process_excel_file(path)
        finally:
            os.remove(path)

        assert success is True
        assert [
            {'UPC': r['UPC'], 'Cost': r['Cost'], 'QTY': r['QTY']} for r in parsed
        ] == [
            {'UPC': '012345678905', 'Cost': 9.99, 'QTY': 3.0},
            {'UPC': '098765432109', 'Cost': 24.50, 'QTY': 1.0},
        ]

    def test_leading_zeros_preserved_on_round_trip(self):
        path = _write_to_tempfile(build_export_excel(
            [{'UPC': '000000000123', 'QTY': 2.0, 'Cost': 1.0, 'Description': 'Zero-padded'}]
        ))
        try:
            success, parsed, _ = ExcelService().process_excel_file(path)
        finally:
            os.remove(path)

        assert success is True
        assert parsed[0]['UPC'] == '000000000123'
