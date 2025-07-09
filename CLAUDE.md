# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

### Running the Application
```bash
# Start the full application stack
docker-compose up -d

# View logs for all services
docker-compose logs -f

# View logs for specific service
docker-compose logs -f backend
docker-compose logs -f nginx

# Stop and remove all containers
docker-compose down -v

# Rebuild containers (useful after dependency changes)
docker-compose build --no-cache
```

### Local Development
```bash
# Backend development
cd backend
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install -r requirements.txt
python app.py

# Frontend development
# Serve frontend files with any web server
# Update API base URL in static/js/api.js if needed
```

### Testing
```bash
# Run backend tests
cd backend
python -m pytest

# Run specific test file
python -m pytest tests/test_specific.py

# Run tests with verbose output
python -m pytest -v
```

### Application Access
- Frontend: http://localhost:8081
- Backend API: http://localhost:8002
- Default credentials: admin/admin123

## Architecture Overview

This is a containerized invoice management system that processes Excel files to create invoices by joining data with external SQL Server databases.

### Core Data Flow
1. **User Management**: SQLite-based authentication system
2. **Database Configuration**: Users configure SQL Server connections (stored in SQLite)
3. **Invoice Creation Process**:
   - User selects configured database
   - User selects customer from Customers_tbl
   - User uploads Excel file with UPC, Cost, QTY columns
   - System joins Excel data with Items_tbl via UPC
   - System creates invoice in Invoices_tbl and InvoicesDetails_tbl
   - Invoice numbers are auto-incremented from existing invoices

### Key Components

**Backend Services** (`backend/app/services/`):
- `database_service.py`: Manages SQL Server connections and data operations
- `excel_service.py`: Processes Excel files and validates column mappings
- `invoice_service.py`: Orchestrates invoice creation and data validation

**Frontend Modules** (`frontend/static/js/`):
- `api.js`: Centralized API communication with error handling
- `auth.js`: User authentication and session management
- `database.js`: Database configuration management
- `invoice.js`: Multi-step invoice creation workflow

**Database Architecture**:
- **SQLite**: User accounts, database configurations (local storage)
- **SQL Server**: Business data (Items_tbl, Customers_tbl, Invoices_tbl, InvoicesDetails_tbl)

### Critical NULL Handling Requirements

The system implements strict NULL value handling based on SQL Server column data types:

**String/VARCHAR columns**: Use empty string `''` instead of NULL
**Numeric columns (int, money, real)**: Use `0` instead of NULL
**Date columns**: Use current date where appropriate (e.g., ShipDate)
**Boolean columns**: Use `0` (False) as default

This is implemented via safe conversion methods in `database_service.py`:
- `_safe_string_for_db()`: Converts NULL values to empty strings
- `_safe_int_for_db()`: Converts NULL values to 0
- `_safe_float_for_db()`: Converts NULL values to 0.0

### Excel Processing Details

**Required Columns**: UPC, Cost, QTY (case-insensitive with variations)
**Column Mappings**: System automatically maps variations like 'ProductUPC', 'UnitCost', 'Quantity'
**UPC Cleaning**: Automatically removes Excel formatting artifacts (periods and trailing content)
**Validation**: Pre-validates UPCs against Items_tbl before invoice creation

### Customer Selection Workflow

The invoice creation process includes a customer selection step:
1. User searches customers by AccountNo
2. System retrieves full customer record from Customers_tbl
3. Customer shipping and billing information populates invoice fields
4. TermID and SalesRepID are inherited from customer record

### Database Schema Integration

**Items_tbl**: Product catalog with ProductUPC as join key
**Customers_tbl**: Customer information with shipping/billing details
**Invoices_tbl**: Invoice headers with customer and shipping information
**InvoicesDetails_tbl**: Line items with product details and calculations

### Error Handling Patterns

- **Missing UPCs**: System identifies and reports UPCs not found in Items_tbl
- **Database Connections**: Comprehensive connection testing and error reporting
- **File Processing**: Supports both .xlsx and .xls formats with fallback engines
- **Type Conversion**: Safe conversion methods prevent database insertion errors

### Port Configuration

The application uses specific ports to avoid conflicts:
- Backend: 8002 (Flask API)
- Frontend: 8081 (Nginx)
- Avoid ports 3000, 5001 (used by other applications)

### Database Connection Security

The system provides flexible connection security options for different SQL Server versions:

**SQL Server 2012 Compatibility**:
- Use FreeTDS driver for SQL Server 2012 and older versions
- Disable encryption for legacy servers that don't support TLS 1.2
- Configure TrustServerCertificate=yes for self-signed certificates

**Connection Security Options**:
- **Encrypt Connection**: Enable/disable connection encryption (required for modern servers)
- **Trust Server Certificate**: Accept self-signed certificates
- **TLS Min Protocol**: Set minimum TLS version (1.0, 1.1, 1.2)
- **Driver Selection**: Choose between ODBC Driver 18, Driver 17, or FreeTDS

**Password Management**:
- Database configuration passwords are stored securely
- Editing configurations preserves existing passwords unless explicitly changed
- Password field shows "Leave blank to keep existing password" for edits

### Security Considerations

- SQLite database stored in Docker volume for persistence
- SQL Server connections support configurable encryption and certificate validation
- CORS enabled for frontend-backend communication
- Session-based authentication with Flask-Login
- Default admin credentials should be changed in production

### UI Design Philosophy

The application follows modern, professional design principles:

**Design System**:
- Clean, minimalist interface with professional gray color palette
- Consistent spacing and typography using Bootstrap 5
- Subtle animations and hover effects (no excessive movement)
- Accessible color contrasts and clear visual hierarchy

**Color Palette**:
- Primary: #2563eb (professional blue)
- Secondary: #64748b (neutral gray)
- Background: #f8fafc (light gray)
- Text: #0f172a (dark gray)

### Development Notes

- Frontend is served by Nginx as static files
- Backend uses Flask with SQLAlchemy ORM
- Database connections use pyodbc for SQL Server connectivity
- Excel processing uses pandas with openpyxl and xlrd engines
- Bootstrap 5 provides responsive UI components
- No frontend build step required (vanilla JavaScript)
- CSS follows modern design patterns with consistent spacing and professional styling