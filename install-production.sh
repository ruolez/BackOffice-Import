#!/bin/bash

# BackOffice Invoice System - Production Installation Script
# Compatible with Ubuntu 24.04 LTS and similar Debian-based systems
# Version: 1.0

set -euo pipefail

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
APP_NAME="BackOffice Invoice System"
APP_DIR="/opt/backoffice-invoice"
BACKUP_DIR="/opt/backoffice-backups"
SERVICE_NAME="backoffice-invoice"
FRONTEND_PORT="8081"
BACKEND_PORT="8002"
SSL_PORT="443"
HTTP_PORT="80"

# Logging function
log() {
    echo -e "${GREEN}[$(date +'%Y-%m-%d %H:%M:%S')] $1${NC}"
}

error() {
    echo -e "${RED}[ERROR] $1${NC}" >&2
}

warning() {
    echo -e "${YELLOW}[WARNING] $1${NC}"
}

info() {
    echo -e "${BLUE}[INFO] $1${NC}"
}

# Check if running as root
check_root() {
    if [[ $EUID -eq 0 ]]; then
        error "This script should not be run as root. Please run as a regular user with sudo privileges."
        exit 1
    fi
}

# Check if user has sudo privileges
check_sudo() {
    if ! sudo -n true 2>/dev/null; then
        error "This script requires sudo privileges. Please run with a user that has sudo access."
        exit 1
    fi
}

# Check Ubuntu version
check_ubuntu_version() {
    if [[ ! -f /etc/os-release ]]; then
        error "Cannot determine OS version. This script is designed for Ubuntu 24.04 LTS."
        exit 1
    fi
    
    source /etc/os-release
    if [[ "$ID" != "ubuntu" ]]; then
        warning "This script is designed for Ubuntu. Your OS: $ID $VERSION_ID"
        read -p "Continue anyway? (y/N): " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            exit 1
        fi
    fi
}

# Get server IP address
get_server_ip() {
    local ip_address=""
    
    # Try to get external IP first
    if command -v curl &> /dev/null; then
        ip_address=$(curl -s https://ipinfo.io/ip 2>/dev/null || echo "")
    fi
    
    # If that fails, get local IP
    if [[ -z "$ip_address" ]]; then
        ip_address=$(hostname -I | awk '{print $1}')
    fi
    
    # If still empty, use localhost
    if [[ -z "$ip_address" ]]; then
        ip_address="127.0.0.1"
    fi
    
    echo "$ip_address"
}

# Prompt for server IP
prompt_server_ip() {
    local default_ip=$(get_server_ip)
    
    echo
    info "CORS Configuration"
    echo "The application needs to know the server IP address for CORS configuration."
    echo "Detected IP address: $default_ip"
    echo
    
    while true; do
        read -p "Enter server IP address (or press Enter for $default_ip): " SERVER_IP
        
        if [[ -z "$SERVER_IP" ]]; then
            SERVER_IP="$default_ip"
        fi
        
        # Basic IP validation
        if [[ $SERVER_IP =~ ^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$ ]]; then
            break
        else
            error "Invalid IP address format. Please enter a valid IP address."
        fi
    done
    
    log "Server IP set to: $SERVER_IP"
}

# Installation mode selection
select_installation_mode() {
    echo
    info "Installation Mode Selection"
    echo "1) Clean Install (Remove all existing data and containers)"
    echo "2) Preserve Data (Keep existing SQLite database and configurations)"
    echo "3) Data Cleanup Only (Remove data without installing)"
    echo "4) Upgrade (Preserve data, update application)"
    echo
    
    while true; do
        read -p "Select installation mode (1-4): " -n 1 -r
        echo
        case $REPLY in
            1)
                INSTALL_MODE="clean"
                warning "This will remove all existing data and containers!"
                read -p "Are you sure? (y/N): " -n 1 -r
                echo
                if [[ ! $REPLY =~ ^[Yy]$ ]]; then
                    select_installation_mode
                    return
                fi
                break
                ;;
            2)
                INSTALL_MODE="preserve"
                log "Data will be preserved during installation"
                break
                ;;
            3)
                INSTALL_MODE="cleanup"
                warning "This will only remove data without installing the application!"
                read -p "Are you sure? (y/N): " -n 1 -r
                echo
                if [[ ! $REPLY =~ ^[Yy]$ ]]; then
                    select_installation_mode
                    return
                fi
                break
                ;;
            4)
                INSTALL_MODE="upgrade"
                log "Application will be upgraded while preserving data"
                break
                ;;
            *)
                error "Invalid selection. Please choose 1-4."
                ;;
        esac
    done
}

# SSL Configuration
configure_ssl() {
    echo
    info "SSL Configuration"
    echo "1) Generate self-signed certificate"
    echo "2) I have my own SSL certificate"
    echo "3) Skip SSL configuration (HTTP only)"
    echo
    
    while true; do
        read -p "Select SSL configuration (1-3): " -n 1 -r
        echo
        case $REPLY in
            1)
                SSL_MODE="self-signed"
                break
                ;;
            2)
                SSL_MODE="custom"
                break
                ;;
            3)
                SSL_MODE="none"
                warning "Application will run without SSL encryption"
                break
                ;;
            *)
                error "Invalid selection. Please choose 1-3."
                ;;
        esac
    done
}

# Install system dependencies
install_dependencies() {
    log "Installing system dependencies..."
    
    # Update package lists
    sudo apt-get update
    
    # Install required packages
    sudo apt-get install -y \
        curl \
        wget \
        gnupg \
        lsb-release \
        ca-certificates \
        apt-transport-https \
        software-properties-common \
        ufw \
        openssl \
        jq \
        rsync
    
    log "System dependencies installed"
}

# Install Docker
install_docker() {
    if command -v docker &> /dev/null; then
        log "Docker is already installed"
        return
    fi
    
    log "Installing Docker..."
    
    # Add Docker's official GPG key
    sudo mkdir -p /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    
    # Set up the repository
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
    
    # Install Docker Engine
    sudo apt-get update
    sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
    
    # Add current user to docker group
    sudo usermod -aG docker $USER
    
    # Start and enable Docker service
    sudo systemctl start docker
    sudo systemctl enable docker
    
    log "Docker installed successfully"
}

# Backup existing data
backup_data() {
    if [[ ! -d "$APP_DIR" ]]; then
        return
    fi
    
    log "Creating backup of existing data..."
    
    # Create backup directory
    sudo mkdir -p "$BACKUP_DIR"
    
    # Create timestamped backup
    local backup_name="backup-$(date +%Y%m%d-%H%M%S)"
    local backup_path="$BACKUP_DIR/$backup_name"
    
    # Create backup directory
    sudo mkdir -p "$backup_path"
    
    # Backup docker-compose.yml if exists
    if [[ -f "$APP_DIR/docker-compose.yml" ]]; then
        sudo cp "$APP_DIR/docker-compose.yml" "$backup_path/"
    fi
    
    # Backup environment files if they exist
    if [[ -f "$APP_DIR/.env" ]]; then
        sudo cp "$APP_DIR/.env" "$backup_path/"
    fi
    
    # Backup Docker volumes
    if docker volume ls | grep -q "sqlite_data"; then
        log "Backing up SQLite database..."
        docker run --rm -v sqlite_data:/data -v "$backup_path":/backup alpine tar czf /backup/sqlite_data.tar.gz -C /data .
    fi
    
    # Set proper permissions
    sudo chown -R $USER:$USER "$backup_path"
    
    log "Backup created at: $backup_path"
}

# Clean up existing installation
cleanup_existing() {
    log "Cleaning up existing installation..."
    
    # Stop and remove containers
    if [[ -f "$APP_DIR/docker-compose.yml" ]]; then
        cd "$APP_DIR"
        docker-compose down --remove-orphans 2>/dev/null || true
    fi
    
    # Remove application directory
    if [[ -d "$APP_DIR" ]]; then
        sudo rm -rf "$APP_DIR"
    fi
    
    # Remove Docker volumes if clean install
    if [[ "$INSTALL_MODE" == "clean" ]]; then
        docker volume rm sqlite_data 2>/dev/null || true
    fi
    
    log "Cleanup completed"
}

# Setup application directory
setup_app_directory() {
    log "Setting up application directory..."
    
    # Create application directory
    sudo mkdir -p "$APP_DIR"
    sudo chown -R $USER:$USER "$APP_DIR"
    
    # Copy application files
    local script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
    
    # Copy all files except the install script
    rsync -av --exclude="install-production.sh" \
              --exclude=".git" \
              --exclude="*.log" \
              --exclude="__pycache__" \
              --exclude="*.pyc" \
              "$script_dir/" "$APP_DIR/"
    
    log "Application files copied to $APP_DIR"
}

# Generate SSL certificates
generate_ssl_certificates() {
    if [[ "$SSL_MODE" != "self-signed" ]]; then
        return
    fi
    
    log "Generating self-signed SSL certificates..."
    
    local ssl_dir="$APP_DIR/ssl"
    mkdir -p "$ssl_dir"
    
    # Generate private key
    openssl genrsa -out "$ssl_dir/private.key" 2048
    
    # Generate certificate signing request
    openssl req -new -key "$ssl_dir/private.key" -out "$ssl_dir/cert.csr" -subj "/C=US/ST=State/L=City/O=Organization/CN=$SERVER_IP"
    
    # Generate self-signed certificate
    openssl x509 -req -in "$ssl_dir/cert.csr" -signkey "$ssl_dir/private.key" -out "$ssl_dir/cert.pem" -days 365
    
    # Set proper permissions
    chmod 600 "$ssl_dir/private.key"
    chmod 644 "$ssl_dir/cert.pem"
    
    log "SSL certificates generated"
}

# Configure production environment
configure_production_environment() {
    log "Configuring production environment..."
    
    # Generate production secret key
    local secret_key=$(openssl rand -base64 32)
    
    # Create production environment file
    cat > "$APP_DIR/.env" <<EOF
# Production Configuration
FLASK_ENV=production
FLASK_DEBUG=0
SECRET_KEY=$secret_key
DATABASE_URL=sqlite:////app/data/backoffice.db

# Server Configuration
SERVER_IP=$SERVER_IP
FRONTEND_PORT=$FRONTEND_PORT
BACKEND_PORT=$BACKEND_PORT

# SSL Configuration
SSL_MODE=$SSL_MODE
EOF
    
    # Set proper permissions
    chmod 600 "$APP_DIR/.env"
    
    log "Production environment configured"
}

# Create production Docker Compose file
create_production_docker_compose() {
    log "Creating production Docker Compose configuration..."
    
    # Determine ports and SSL configuration
    local frontend_port_mapping=""
    local ssl_volume_mapping=""
    
    if [[ "$SSL_MODE" == "self-signed" ]]; then
        frontend_port_mapping="$HTTP_PORT:80\n      - $SSL_PORT:443"
        ssl_volume_mapping="- ./ssl:/etc/nginx/ssl:ro"
    else
        frontend_port_mapping="$FRONTEND_PORT:80"
    fi
    
    # Create production docker-compose.yml
    cat > "$APP_DIR/docker-compose.yml" <<EOF
version: '3.8'

services:
  backend:
    build: ./backend
    ports:
      - "$BACKEND_PORT:8000"
    volumes:
      - sqlite_data:/app/data
    environment:
      - FLASK_ENV=production
      - FLASK_DEBUG=0
      - DATABASE_URL=sqlite:////app/data/backoffice.db
      - SECRET_KEY=\${SECRET_KEY}
      - CORS_ORIGINS=http://$SERVER_IP:$FRONTEND_PORT,https://$SERVER_IP:$SSL_PORT,http://$SERVER_IP,https://$SERVER_IP
    networks:
      - backoffice-network
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8000/api/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s

  nginx:
    image: nginx:alpine
    ports:
      - "$frontend_port_mapping"
    volumes:
      - ./frontend:/usr/share/nginx/html:ro
      - ./nginx-production.conf:/etc/nginx/nginx.conf:ro
      $ssl_volume_mapping
    depends_on:
      - backend
    networks:
      - backoffice-network
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost/api/health"]
      interval: 30s
      timeout: 10s
      retries: 3

volumes:
  sqlite_data:
    driver: local

networks:
  backoffice-network:
    driver: bridge
EOF
    
    log "Production Docker Compose file created"
}

# Create production Nginx configuration
create_production_nginx_config() {
    log "Creating production Nginx configuration..."
    
    # Create base configuration
    cat > "$APP_DIR/nginx-production.conf" <<EOF
events {
    worker_connections 1024;
}

http {
    include /etc/nginx/mime.types;
    default_type application/octet-stream;
    
    # Logging
    access_log /var/log/nginx/access.log;
    error_log /var/log/nginx/error.log;
    
    # Gzip compression
    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_proxied any;
    gzip_comp_level 6;
    gzip_types text/plain text/css text/xml text/javascript application/javascript application/xml+rss application/json;
    
    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    
    # Rate limiting
    limit_req_zone \$binary_remote_addr zone=api:10m rate=10r/s;
    limit_req_zone \$binary_remote_addr zone=upload:10m rate=5r/s;
    
    # Upstream backend
    upstream backend {
        server backend:8000;
    }
    
    # HTTP server
    server {
        listen 80;
        server_name $SERVER_IP;
        
        # Security headers
        add_header X-Frame-Options "SAMEORIGIN" always;
        add_header X-Content-Type-Options "nosniff" always;
        add_header X-XSS-Protection "1; mode=block" always;
        
        # Serve static files with caching
        location /static/ {
            alias /usr/share/nginx/html/static/;
            expires 1y;
            add_header Cache-Control "public, no-transform";
        }
        
        # API requests with rate limiting
        location /api/ {
            limit_req zone=api burst=20 nodelay;
            proxy_pass http://backend;
            proxy_set_header Host \$host;
            proxy_set_header X-Real-IP \$remote_addr;
            proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto \$scheme;
            proxy_read_timeout 300;
            proxy_connect_timeout 300;
        }
        
        # Upload endpoint with special rate limiting
        location /api/invoice/upload {
            limit_req zone=upload burst=5 nodelay;
            proxy_pass http://backend;
            proxy_set_header Host \$host;
            proxy_set_header X-Real-IP \$remote_addr;
            proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto \$scheme;
            proxy_read_timeout 300;
            proxy_connect_timeout 300;
            client_max_body_size 16M;
        }
        
        # Serve frontend files
        location / {
            root /usr/share/nginx/html;
            try_files \$uri \$uri/ /index.html;
            expires 1h;
            add_header Cache-Control "public, no-transform";
        }
        
        # Health check endpoint
        location /health {
            access_log off;
            return 200 "OK";
            add_header Content-Type text/plain;
        }
        
        # File upload size limit
        client_max_body_size 16M;
    }
EOF
    
    # Add SSL configuration if enabled
    if [[ "$SSL_MODE" == "self-signed" ]]; then
        cat >> "$APP_DIR/nginx-production.conf" <<EOF
    
    # HTTPS server
    server {
        listen 443 ssl http2;
        server_name $SERVER_IP;
        
        # SSL configuration
        ssl_certificate /etc/nginx/ssl/cert.pem;
        ssl_certificate_key /etc/nginx/ssl/private.key;
        ssl_protocols TLSv1.2 TLSv1.3;
        ssl_ciphers ECDHE-RSA-AES128-GCM-SHA256:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-RSA-AES128-SHA256:ECDHE-RSA-AES256-SHA384;
        ssl_prefer_server_ciphers off;
        ssl_session_cache shared:SSL:10m;
        ssl_session_timeout 1d;
        
        # Security headers
        add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
        add_header X-Frame-Options "SAMEORIGIN" always;
        add_header X-Content-Type-Options "nosniff" always;
        add_header X-XSS-Protection "1; mode=block" always;
        
        # Redirect HTTP to HTTPS
        if (\$scheme != "https") {
            return 301 https://\$server_name\$request_uri;
        }
        
        # Same location blocks as HTTP server
        location /static/ {
            alias /usr/share/nginx/html/static/;
            expires 1y;
            add_header Cache-Control "public, no-transform";
        }
        
        location /api/ {
            limit_req zone=api burst=20 nodelay;
            proxy_pass http://backend;
            proxy_set_header Host \$host;
            proxy_set_header X-Real-IP \$remote_addr;
            proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto https;
            proxy_read_timeout 300;
            proxy_connect_timeout 300;
        }
        
        location /api/invoice/upload {
            limit_req zone=upload burst=5 nodelay;
            proxy_pass http://backend;
            proxy_set_header Host \$host;
            proxy_set_header X-Real-IP \$remote_addr;
            proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto https;
            proxy_read_timeout 300;
            proxy_connect_timeout 300;
            client_max_body_size 16M;
        }
        
        location / {
            root /usr/share/nginx/html;
            try_files \$uri \$uri/ /index.html;
            expires 1h;
            add_header Cache-Control "public, no-transform";
        }
        
        location /health {
            access_log off;
            return 200 "OK";
            add_header Content-Type text/plain;
        }
        
        client_max_body_size 16M;
    }
EOF
    fi
    
    echo "}" >> "$APP_DIR/nginx-production.conf"
    
    log "Production Nginx configuration created"
}

# Update Flask app for production CORS
update_flask_cors_config() {
    log "Updating Flask CORS configuration for production..."
    
    # Create a patch for production CORS configuration
    cat > "$APP_DIR/backend/production_cors.py" <<EOF
import os
from flask_cors import CORS

def configure_production_cors(app):
    """Configure CORS for production environment"""
    server_ip = os.environ.get('SERVER_IP', 'localhost')
    frontend_port = os.environ.get('FRONTEND_PORT', '8081')
    
    # Configure allowed origins for production
    origins = [
        f"http://{server_ip}:{frontend_port}",
        f"https://{server_ip}:443",
        f"http://{server_ip}",
        f"https://{server_ip}"
    ]
    
    # Additional origins from environment
    cors_origins = os.environ.get('CORS_ORIGINS', '')
    if cors_origins:
        origins.extend(cors_origins.split(','))
    
    # Configure CORS
    CORS(app, 
         origins=origins,
         supports_credentials=True,
         allow_headers=['Content-Type', 'Authorization', 'X-Requested-With'],
         expose_headers=['Content-Type', 'Authorization']
    )
    
    return app
EOF
    
    # Update app.py to use production CORS configuration
    sed -i 's/CORS(app)/from production_cors import configure_production_cors; configure_production_cors(app)/' "$APP_DIR/backend/app.py"
    
    log "Flask CORS configuration updated"
}

# Configure firewall
configure_firewall() {
    log "Configuring firewall..."
    
    # Enable UFW if not already enabled
    sudo ufw --force enable
    
    # Allow SSH
    sudo ufw allow ssh
    
    # Allow HTTP and HTTPS
    sudo ufw allow 80/tcp
    sudo ufw allow 443/tcp
    
    # Allow backend port for API access
    sudo ufw allow $BACKEND_PORT/tcp
    
    # Allow frontend port
    sudo ufw allow $FRONTEND_PORT/tcp
    
    log "Firewall configured"
}

# Create systemd service
create_systemd_service() {
    log "Creating systemd service..."
    
    cat > "/tmp/${SERVICE_NAME}.service" <<EOF
[Unit]
Description=BackOffice Invoice System
Requires=docker.service
After=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=$APP_DIR
ExecStart=/usr/bin/docker-compose up -d
ExecStop=/usr/bin/docker-compose down
ExecReload=/usr/bin/docker-compose restart
User=$USER
Group=$USER

[Install]
WantedBy=multi-user.target
EOF
    
    # Move service file and set permissions
    sudo mv "/tmp/${SERVICE_NAME}.service" "/etc/systemd/system/"
    sudo systemctl daemon-reload
    sudo systemctl enable "$SERVICE_NAME"
    
    log "Systemd service created and enabled"
}

# Build and start application
build_and_start() {
    log "Building and starting application..."
    
    cd "$APP_DIR"
    
    # Load environment variables
    if [[ -f ".env" ]]; then
        export $(cat .env | grep -v '^#' | xargs)
    fi
    
    # Build and start containers
    docker-compose build --no-cache
    docker-compose up -d
    
    # Wait for services to be ready
    log "Waiting for services to start..."
    sleep 30
    
    # Check if services are running
    if docker-compose ps | grep -q "Up"; then
        log "Services started successfully"
    else
        error "Failed to start services"
        docker-compose logs
        exit 1
    fi
}

# Restore data from backup
restore_data() {
    if [[ "$INSTALL_MODE" != "preserve" ]] && [[ "$INSTALL_MODE" != "upgrade" ]]; then
        return
    fi
    
    # Find latest backup
    local latest_backup=$(find "$BACKUP_DIR" -name "backup-*" -type d | sort -r | head -1)
    
    if [[ -z "$latest_backup" ]]; then
        warning "No backup found to restore"
        return
    fi
    
    log "Restoring data from backup: $latest_backup"
    
    # Restore SQLite database
    if [[ -f "$latest_backup/sqlite_data.tar.gz" ]]; then
        docker run --rm -v sqlite_data:/data -v "$latest_backup":/backup alpine tar xzf /backup/sqlite_data.tar.gz -C /data
        log "Database restored"
    fi
}

# Post-installation tasks
post_installation() {
    log "Performing post-installation tasks..."
    
    # Create log directory
    sudo mkdir -p /var/log/backoffice-invoice
    sudo chown -R $USER:$USER /var/log/backoffice-invoice
    
    # Create maintenance script
    cat > "$APP_DIR/maintenance.sh" <<'EOF'
#!/bin/bash

# BackOffice Invoice System Maintenance Script

case "$1" in
    start)
        docker-compose up -d
        ;;
    stop)
        docker-compose down
        ;;
    restart)
        docker-compose restart
        ;;
    status)
        docker-compose ps
        ;;
    logs)
        docker-compose logs -f
        ;;
    backup)
        BACKUP_DIR="/opt/backoffice-backups"
        backup_name="backup-$(date +%Y%m%d-%H%M%S)"
        backup_path="$BACKUP_DIR/$backup_name"
        
        mkdir -p "$backup_path"
        cp docker-compose.yml "$backup_path/"
        cp .env "$backup_path/"
        
        if docker volume ls | grep -q "sqlite_data"; then
            docker run --rm -v sqlite_data:/data -v "$backup_path":/backup alpine tar czf /backup/sqlite_data.tar.gz -C /data .
        fi
        
        echo "Backup created at: $backup_path"
        ;;
    update)
        docker-compose pull
        docker-compose up -d
        ;;
    *)
        echo "Usage: $0 {start|stop|restart|status|logs|backup|update}"
        exit 1
        ;;
esac
EOF
    
    chmod +x "$APP_DIR/maintenance.sh"
    
    # Create symlink for easy access
    sudo ln -sf "$APP_DIR/maintenance.sh" /usr/local/bin/backoffice-maintenance
    
    log "Post-installation tasks completed"
}

# Display installation summary
display_summary() {
    echo
    echo "======================================"
    echo "  Installation Summary"
    echo "======================================"
    echo
    log "✅ $APP_NAME installed successfully!"
    echo
    info "Access Information:"
    if [[ "$SSL_MODE" == "self-signed" ]]; then
        echo "  🌐 Frontend (HTTPS): https://$SERVER_IP:$SSL_PORT"
        echo "  🌐 Frontend (HTTP):  http://$SERVER_IP:$HTTP_PORT"
    else
        echo "  🌐 Frontend: http://$SERVER_IP:$FRONTEND_PORT"
    fi
    echo "  🔧 Backend API: http://$SERVER_IP:$BACKEND_PORT"
    echo
    info "Default Login Credentials:"
    echo "  👤 Username: admin"
    echo "  🔐 Password: admin123"
    echo
    warning "⚠️  Please change the default password after first login!"
    echo
    info "Management Commands:"
    echo "  🔧 Service status: sudo systemctl status $SERVICE_NAME"
    echo "  🔄 Restart service: sudo systemctl restart $SERVICE_NAME"
    echo "  📋 View logs: docker-compose logs -f"
    echo "  🛠️  Maintenance: backoffice-maintenance {start|stop|restart|status|logs|backup|update}"
    echo
    info "Files and Directories:"
    echo "  📁 Application: $APP_DIR"
    echo "  💾 Backups: $BACKUP_DIR"
    echo "  🔧 Config: $APP_DIR/docker-compose.yml"
    echo "  🔐 Environment: $APP_DIR/.env"
    echo
    if [[ "$SSL_MODE" == "self-signed" ]]; then
        warning "Self-signed SSL certificate generated. For production use, consider using a proper SSL certificate."
    fi
    echo
    log "Installation completed successfully! 🎉"
}

# Main execution
main() {
    echo
    echo "======================================"
    echo "  $APP_NAME"
    echo "  Production Installation Script"
    echo "======================================"
    echo
    
    # Pre-installation checks
    check_root
    check_sudo
    check_ubuntu_version
    
    # Interactive configuration
    prompt_server_ip
    select_installation_mode
    
    # Handle cleanup-only mode
    if [[ "$INSTALL_MODE" == "cleanup" ]]; then
        backup_data
        cleanup_existing
        log "Cleanup completed"
        exit 0
    fi
    
    configure_ssl
    
    # Installation process
    install_dependencies
    install_docker
    
    # Handle data preservation
    if [[ "$INSTALL_MODE" == "preserve" ]] || [[ "$INSTALL_MODE" == "upgrade" ]]; then
        backup_data
    fi
    
    cleanup_existing
    setup_app_directory
    configure_production_environment
    
    # SSL setup
    generate_ssl_certificates
    
    # Configuration
    create_production_docker_compose
    create_production_nginx_config
    update_flask_cors_config
    configure_firewall
    create_systemd_service
    
    # Application startup
    build_and_start
    
    # Data restoration
    restore_data
    
    # Finalization
    post_installation
    display_summary
}

# Run main function
main "$@"