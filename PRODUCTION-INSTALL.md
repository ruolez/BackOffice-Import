# BackOffice Invoice System - Production Installation Guide

## Overview

The `install-production.sh` script provides a comprehensive, automated solution for deploying the BackOffice Invoice System on Ubuntu 24.04 LTS servers. It handles all aspects of production deployment including security, SSL, data management, and service monitoring.

## Key Features

### 🔧 **Automated Installation**
- Complete Docker and Docker Compose setup
- System dependency installation and configuration
- UFW firewall configuration
- Systemd service creation and management

### 🔒 **Security Hardened**
- Production-grade Nginx configuration with security headers
- SSL/TLS support with self-signed or custom certificates
- CORS configuration for secure cross-origin requests
- Rate limiting and request size controls
- Secure secret key generation

### 💾 **Data Management**
- Intelligent backup and restore functionality
- Multiple installation modes (clean, preserve, upgrade, cleanup)
- Automatic SQLite database backup with timestamps
- Volume persistence across container rebuilds

### 🌐 **Production Ready**
- Optimized Nginx configuration with caching
- Health checks for all services
- Comprehensive logging and monitoring
- Graceful service management

## Installation Modes

### 1. Clean Install
```bash
./install-production.sh
# Select option 1
```
- Removes all existing data and containers
- Fresh installation with default settings
- **Warning**: This will delete all existing invoices and configurations

### 2. Preserve Data
```bash
./install-production.sh
# Select option 2
```
- Keeps existing SQLite database and configurations
- Updates application code and configuration
- Maintains user accounts and database connections
- **Recommended for upgrades**

### 3. Data Cleanup Only
```bash
./install-production.sh
# Select option 3
```
- Removes all data and containers without reinstalling
- Useful for complete system cleanup
- Creates backup before deletion

### 4. Upgrade
```bash
./install-production.sh
# Select option 4
```
- Preserves data while updating application
- Rebuilds containers with latest code
- Maintains production configuration

## SSL Configuration Options

### Self-Signed Certificates
- Automatically generates SSL certificates
- Configures HTTPS on port 443
- Includes HTTP to HTTPS redirect
- **Best for**: Internal networks, testing environments

### Custom Certificates
- Prompts for your own SSL certificate files
- Supports commercial and Let's Encrypt certificates
- **Best for**: Production environments with domain names

### HTTP Only
- Runs without SSL encryption
- Suitable for development or internal use
- **Not recommended for production**

## Network Configuration

### CORS Setup
The script automatically configures Cross-Origin Resource Sharing (CORS) for:
- Server IP address (auto-detected or manually entered)
- HTTP and HTTPS protocols
- Multiple port configurations
- Dynamic origin management

### Firewall Configuration
Automatically configures UFW firewall rules for:
- SSH (port 22)
- HTTP (port 80)
- HTTPS (port 443)
- Backend API (port 8002)
- Frontend (port 8081)

## System Requirements

### Minimum Requirements
- **OS**: Ubuntu 24.04 LTS (or compatible Debian-based system)
- **RAM**: 2GB minimum, 4GB recommended
- **Storage**: 10GB available space
- **Network**: Internet connection for downloading dependencies

### Prerequisites
- User account with sudo privileges
- Available ports: 80, 443, 8002, 8081
- No conflicting Docker installations

## Usage Instructions

### Basic Installation
```bash
# Clone or download the application
cd /path/to/BackOffice-Invoice

# Run the installation script
./install-production.sh

# Follow the interactive prompts:
# 1. Enter server IP address
# 2. Select installation mode
# 3. Configure SSL options
# 4. Wait for completion
```

### Advanced Configuration

#### Custom IP Address
```bash
# The script will auto-detect your server IP
# You can override this when prompted
Enter server IP address: 192.168.1.100
```

#### SSL Certificate Paths
When using custom certificates, place them in:
```
/opt/backoffice-invoice/ssl/
├── cert.pem        # Your SSL certificate
├── private.key     # Your private key
└── chain.pem       # Certificate chain (optional)
```

#### Environment Variables
Production configuration is stored in `/opt/backoffice-invoice/.env`:
```bash
FLASK_ENV=production
FLASK_DEBUG=0
SECRET_KEY=<generated-secret>
DATABASE_URL=sqlite:////app/data/backoffice.db
SERVER_IP=192.168.1.100
FRONTEND_PORT=8081
BACKEND_PORT=8002
SSL_MODE=self-signed
```

## Post-Installation Management

### Service Management
```bash
# Check service status
sudo systemctl status backoffice-invoice

# Start/stop/restart service
sudo systemctl start backoffice-invoice
sudo systemctl stop backoffice-invoice
sudo systemctl restart backoffice-invoice

# View service logs
sudo journalctl -u backoffice-invoice -f
```

### Application Management
```bash
# Quick maintenance commands
backoffice-maintenance start      # Start services
backoffice-maintenance stop       # Stop services
backoffice-maintenance restart    # Restart services
backoffice-maintenance status     # Check status
backoffice-maintenance logs       # View logs
backoffice-maintenance backup     # Create backup
backoffice-maintenance update     # Update containers
```

### Manual Docker Management
```bash
# Navigate to application directory
cd /opt/backoffice-invoice

# View running containers
docker-compose ps

# View logs
docker-compose logs -f

# Restart specific service
docker-compose restart backend
docker-compose restart nginx

# Rebuild and restart
docker-compose down
docker-compose build --no-cache
docker-compose up -d
```

## Backup and Restore

### Automatic Backups
- Created automatically during preserve/upgrade modes
- Stored in `/opt/backoffice-backups/`
- Includes SQLite database and configuration files
- Timestamped for easy identification

### Manual Backup
```bash
# Create backup using maintenance script
backoffice-maintenance backup

# Manual backup
cd /opt/backoffice-invoice
mkdir -p /opt/backoffice-backups/manual-$(date +%Y%m%d-%H%M%S)
cp docker-compose.yml .env /opt/backoffice-backups/manual-$(date +%Y%m%d-%H%M%S)/
docker run --rm -v sqlite_data:/data -v /opt/backoffice-backups/manual-$(date +%Y%m%d-%H%M%S):/backup alpine tar czf /backup/sqlite_data.tar.gz -C /data .
```

### Restore from Backup
```bash
# Stop services
docker-compose down

# Restore database
docker run --rm -v sqlite_data:/data -v /opt/backoffice-backups/backup-TIMESTAMP:/backup alpine tar xzf /backup/sqlite_data.tar.gz -C /data

# Restore configuration
cp /opt/backoffice-backups/backup-TIMESTAMP/docker-compose.yml .
cp /opt/backoffice-backups/backup-TIMESTAMP/.env .

# Restart services
docker-compose up -d
```

## Access Information

### Frontend Access
- **HTTP**: `http://your-server-ip:8081`
- **HTTPS**: `https://your-server-ip:443` (if SSL enabled)

### Backend API Access
- **API Endpoint**: `http://your-server-ip:8002`
- **Health Check**: `http://your-server-ip:8002/api/health`

### Default Credentials
- **Username**: `admin`
- **Password**: `admin123`

**⚠️ Important**: Change the default password immediately after first login!

## Monitoring and Maintenance

### Health Checks
The application includes built-in health checks:
- Backend: `/api/health`
- Frontend: `/health`
- Docker health checks with automatic restart

### Log Locations
```bash
# Application logs
docker-compose logs -f

# Nginx access logs
docker-compose exec nginx cat /var/log/nginx/access.log

# Nginx error logs
docker-compose exec nginx cat /var/log/nginx/error.log

# System service logs
sudo journalctl -u backoffice-invoice -f
```

### Performance Monitoring
```bash
# Container resource usage
docker stats

# System resource usage
htop
df -h
free -h

# Network connections
ss -tulpn | grep -E "(8002|8081|80|443)"
```

## Troubleshooting

### Common Issues

#### Port Already in Use
```bash
# Check what's using the port
sudo lsof -i :8081
sudo lsof -i :8002

# Stop conflicting services
sudo systemctl stop apache2
sudo systemctl stop nginx

# Or modify ports in docker-compose.yml
```

#### SSL Certificate Issues
```bash
# Regenerate self-signed certificates
cd /opt/backoffice-invoice/ssl
openssl genrsa -out private.key 2048
openssl req -new -key private.key -out cert.csr -subj "/C=US/ST=State/L=City/O=Organization/CN=YOUR-IP"
openssl x509 -req -in cert.csr -signkey private.key -out cert.pem -days 365
```

#### Database Connection Issues
```bash
# Check database permissions
docker-compose exec backend ls -la /app/data/

# Reset database (WARNING: This will delete all data)
docker volume rm sqlite_data
docker-compose up -d
```

#### CORS Errors
```bash
# Check CORS configuration
docker-compose exec backend env | grep CORS

# Update CORS origins
# Edit .env file and restart services
```

### Recovery Procedures

#### Complete System Recovery
```bash
# Stop all services
docker-compose down -v

# Restore from backup
./install-production.sh
# Select "Preserve Data" option

# Manually restore if needed
# (see Backup and Restore section)
```

#### Container Recovery
```bash
# Rebuild containers
docker-compose build --no-cache
docker-compose up -d

# Reset to clean state
docker system prune -a
docker volume prune
./install-production.sh
```

## Security Considerations

### Production Security Checklist
- [ ] Change default admin password
- [ ] Use strong SECRET_KEY (automatically generated)
- [ ] Configure proper SSL certificates
- [ ] Update firewall rules as needed
- [ ] Regular security updates
- [ ] Monitor access logs
- [ ] Backup encryption (recommended)

### Network Security
- UFW firewall automatically configured
- Rate limiting on API endpoints
- Security headers in Nginx configuration
- CORS properly configured for your domain

### Data Security
- SQLite database stored in Docker volumes
- Configuration files have restricted permissions
- SSL/TLS encryption for data in transit
- Regular automated backups

## Updating the Application

### Update Process
1. **Backup Current Installation**
   ```bash
   backoffice-maintenance backup
   ```

2. **Download Latest Code**
   ```bash
   # Replace application files with latest version
   # Keep the install-production.sh script
   ```

3. **Run Upgrade Installation**
   ```bash
   ./install-production.sh
   # Select "Upgrade" option
   ```

4. **Verify Operation**
   ```bash
   backoffice-maintenance status
   # Check web interface
   ```

### Rolling Back Updates
```bash
# Stop current services
docker-compose down

# Restore from backup
# (see Backup and Restore section)

# Restart services
docker-compose up -d
```

## Support and Maintenance

### Regular Maintenance Tasks
- **Weekly**: Check logs for errors
- **Monthly**: Create manual backups
- **Quarterly**: Update system packages
- **Annually**: Rotate SSL certificates

### Performance Optimization
- Monitor disk usage in `/opt/backoffice-invoice`
- Clean up old Docker images: `docker system prune`
- Rotate log files if they grow large
- Monitor container resource usage

### Support Resources
- Application logs: `docker-compose logs -f`
- System logs: `sudo journalctl -u backoffice-invoice -f`
- Configuration files: `/opt/backoffice-invoice/`
- Backup location: `/opt/backoffice-backups/`

## Conclusion

This production installation script provides a complete, secure, and maintainable deployment of the BackOffice Invoice System. It handles all aspects of production deployment while providing flexibility for different use cases and environments.

For additional support or customization needs, refer to the troubleshooting section or contact your system administrator.