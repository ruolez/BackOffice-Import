# BackOffice Invoice System

A modern web application for creating invoices from Excel files by joining data with external SQL Server databases.

## Features

- 🔐 **User Authentication**: Secure login/register system
- 📊 **Database Management**: Configure and test multiple SQL Server connections
- 📋 **Excel Processing**: Upload Excel files with UPC, Cost, QTY columns
- 🔗 **Smart Data Joining**: Automatically joins Excel data with Items_tbl database
- ✅ **UPC Validation**: Identifies missing UPCs before invoice creation
- 📄 **Invoice Generation**: Creates invoices in Invoices_tbl and InvoicesDetails_tbl
- 🎨 **Modern UI**: Responsive Bootstrap 5 interface

## Prerequisites

- Docker and Docker Compose
- Ports 8002 (backend) and 8081 (frontend) available

## Quick Start

1. **Clone and Navigate**
   ```bash
   cd "/path/to/BackOffice Invoice"
   ```

2. **Start the Application**
   ```bash
   docker-compose up -d
   ```

3. **Access the Application**
   - Frontend: http://localhost:8081
   - Backend API: http://localhost:8002

4. **Login with Default Credentials**
   - Username: `admin`
   - Password: `admin123`

## Fresh Server Installation

### Prerequisites
- Docker Engine 20.10+
- Docker Compose 2.0+

### Installation Steps

1. **Install Docker (Ubuntu/Debian)**
   ```bash
   # Update package index
   sudo apt-get update
   
   # Install prerequisites
   sudo apt-get install ca-certificates curl gnupg lsb-release
   
   # Add Docker's official GPG key
   sudo mkdir -p /etc/apt/keyrings
   curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
   
   # Set up the repository
   echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
   
   # Install Docker Engine
   sudo apt-get update
   sudo apt-get install docker-ce docker-ce-cli containerd.io docker-compose-plugin
   
   # Add user to docker group
   sudo usermod -aG docker $USER
   newgrp docker
   ```

2. **Deploy Application**
   ```bash
   # Create application directory
   mkdir -p /opt/backoffice-invoice
   cd /opt/backoffice-invoice
   
   # Copy application files here
   # Then start the application
   docker-compose up -d
   ```

3. **Check Logs**
   ```bash
   docker-compose logs -f
   ```

## Application Structure

```
backoffice-invoice/
├── backend/                 # Python Flask API
│   ├── app/
│   │   ├── models/         # Database models
│   │   ├── routes/         # API endpoints
│   │   ├── services/       # Business logic
│   │   └── utils/          # Helper functions
│   ├── requirements.txt    # Python dependencies
│   └── Dockerfile
├── frontend/               # HTML/CSS/JS frontend
│   ├── static/
│   │   ├── css/           # Stylesheets
│   │   └── js/            # JavaScript modules
│   └── templates/
├── docker-compose.yml      # Container orchestration
├── nginx.conf             # Web server configuration
└── README.md
```

## Configuration

### Environment Variables

The application supports the following environment variables:

- `DATABASE_URL`: SQLite database path (default: `sqlite:////app/data/backoffice.db`)
- `SECRET_KEY`: Flask secret key (default: development key)
- `FLASK_ENV`: Flask environment (default: `development`)
- `FLASK_DEBUG`: Enable debug mode (default: `1`)

### Database Schema Requirements

Your SQL Server database must have the following tables:

#### Items_tbl
- `ProductID` (int, identity)
- `ProductUPC` (nvarchar(20)) - **Required for joining**
- `ProductSKU` (nvarchar(20))
- `ProductDescription` (nvarchar(50))
- `UnitPrice` (money)
- `UnitCost` (money)
- `ItemSize` (nvarchar(10))
- `ItemWeight` (nvarchar(10))
- `CateID` (int)
- `SubCateID` (int)
- `ItemTaxID` (int)

#### Invoices_tbl
- `InvoiceID` (int, identity, primary key)
- `InvoiceNumber` (nvarchar(20))
- `InvoiceDate` (smalldatetime)
- `InvoiceType` (nvarchar(50))
- Additional invoice header fields...

#### InvoicesDetails_tbl
- `LineID` (int, identity, primary key)
- `InvoiceID` (int, foreign key to Invoices_tbl)
- `ProductID` (int)
- `ProductUPC` (nvarchar(20))
- `UnitCost` (money)
- `QtyOrdered` (real)
- Additional line item fields...

### Excel File Format

Upload Excel files (.xlsx or .xls) with these columns:
- **UPC**: Product UPC code (required)
- **Cost**: Unit cost (required)
- **QTY**: Quantity (required)

Column names are case-insensitive and support variations like:
- UPC: UPC, upc, ProductUPC, Barcode
- Cost: Cost, cost, UnitCost, Price
- QTY: QTY, qty, Quantity, Amount

## API Endpoints

### Authentication
- `POST /api/auth/login` - User login
- `POST /api/auth/register` - User registration
- `POST /api/auth/logout` - User logout
- `GET /api/auth/me` - Get current user

### Database Configuration
- `GET /api/database/configs` - List database configs
- `POST /api/database/configs` - Create database config
- `PUT /api/database/configs/{id}` - Update database config
- `DELETE /api/database/configs/{id}` - Delete database config
- `POST /api/database/configs/{id}/test` - Test connection

### Invoice Management
- `POST /api/invoice/upload` - Upload and process Excel file
- `POST /api/invoice/create` - Create invoice from processed data
- `GET /api/invoice/next-number/{db_id}` - Get next invoice number
- `POST /api/invoice/validate-upcs` - Validate UPC codes

## Troubleshooting

### Common Issues

1. **Port Already in Use**
   ```bash
   # Check what's using the port
   lsof -i :8081
   # Change ports in docker-compose.yml if needed
   ```

2. **Database Connection Fails**
   - Verify SQL Server is accessible from Docker containers
   - Check firewall settings
   - Ensure SQL Server allows remote connections
   - Verify credentials and database name

3. **ODBC Driver Issues**
   - The application includes Microsoft ODBC Driver 18 for SQL Server
   - If issues persist, rebuild the container: `docker-compose build --no-cache`

4. **Excel Upload Fails**
   - Ensure file has UPC, Cost, QTY columns
   - Check file size (max 16MB)
   - Verify file format (.xlsx or .xls)

### Logs

View application logs:
```bash
# All services
docker-compose logs -f

# Backend only
docker-compose logs -f backend

# Frontend only  
docker-compose logs -f nginx
```

### Reset Application
```bash
# Stop and remove containers, networks, volumes
docker-compose down -v

# Restart fresh
docker-compose up -d
```

## Development

### Local Development Setup

1. **Backend Development**
   ```bash
   cd backend
   python -m venv venv
   source venv/bin/activate  # On Windows: venv\Scripts\activate
   pip install -r requirements.txt
   python app.py
   ```

2. **Frontend Development**
   - Serve frontend files with any web server
   - Update API base URL in `static/js/api.js` if needed

### Adding Features

1. **Backend**: Add routes in `backend/app/routes/`
2. **Frontend**: Add JavaScript modules in `frontend/static/js/`
3. **Database**: Update models in `backend/app/models/`

## Security Considerations

- Change default admin password in production
- Use strong SECRET_KEY in production
- Enable SSL/TLS for production deployment
- Regularly update Docker images
- Consider encrypting database passwords

## License

This project is for internal use. All rights reserved.

## Support

For issues and questions, check the logs and troubleshooting section above.