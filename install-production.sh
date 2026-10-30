#!/bin/bash

# BackOffice Invoice System - Production Installation Script
# Compatible with Ubuntu 24.04 LTS and similar Debian-based systems
# Version: 1.1

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
GITHUB_REPO="https://github.com/ruolez/BackOffice-Import.git"
FRONTEND_PORT="80"
BACKEND_PORT="8002"
SSL_PORT="443"
HTTP_PORT="80"
BACKUP_KEEP=10          # backups kept in $BACKUP_DIR; older ones are deleted
HEALTH_TIMEOUT=120      # seconds to wait for the app to answer after (re)starting
LAST_BACKUP=""

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
    if ! sudo -v; then
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

# Docker volume that holds the SQLite database. Compose prefixes volume names
# with the project name, so ask the backend container where /app/data lives.
data_volume_name() {
    local cid="" name=""
    if [[ -f "$APP_DIR/docker-compose.yml" ]]; then
        cid=$(cd "$APP_DIR" && docker compose ps -aq backend 2>/dev/null | head -1) || true
    fi
    if [[ -n "$cid" ]]; then
        name=$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/app/data"}}{{.Name}}{{end}}{{end}}' "$cid" 2>/dev/null) || true
    fi
    if [[ -z "$name" ]]; then
        local fallback
        fallback="$(basename "$APP_DIR")_sqlite_data"
        if docker volume inspect "$fallback" &>/dev/null; then
            name="$fallback"
        fi
    fi
    echo "$name"
}

# Backup existing data (sets LAST_BACKUP). Stops the backend so the SQLite
# file isn't written mid-copy; callers start it again or replace it.
backup_data() {
    if [[ ! -d "$APP_DIR" ]]; then
        return 0
    fi

    log "Creating backup of existing data..."

    sudo mkdir -p "$BACKUP_DIR"
    sudo chown "$USER:$(id -gn)" "$BACKUP_DIR"

    local backup_path
    backup_path="$BACKUP_DIR/backup-$(date +%Y%m%d-%H%M%S)"
    mkdir -p "$backup_path"

    local f
    for f in docker-compose.yml .env nginx-production.conf; do
        if [[ -f "$APP_DIR/$f" ]]; then
            cp "$APP_DIR/$f" "$backup_path/"
        fi
    done
    if [[ -d "$APP_DIR/ssl" ]]; then
        cp -r "$APP_DIR/ssl" "$backup_path/"
    fi
    git -C "$APP_DIR" rev-parse HEAD > "$backup_path/commit" 2>/dev/null || rm -f "$backup_path/commit"

    local volume_name
    volume_name=$(data_volume_name)
    if [[ -n "$volume_name" ]]; then
        log "Backing up SQLite database (volume: $volume_name)..."
        (cd "$APP_DIR" && docker compose stop backend >/dev/null 2>&1) || true
        docker run --rm -v "$volume_name":/data:ro -v "$backup_path":/backup alpine \
            tar czf /backup/sqlite_data.tar.gz -C /data . || true
        if ! tar tzf "$backup_path/sqlite_data.tar.gz" >/dev/null 2>&1; then
            error "Database backup in $backup_path is missing or unreadable"
            return 1
        fi
    else
        warning "No SQLite data volume found; backed up configuration files only"
    fi

    sudo chown -R "$USER:$(id -gn)" "$backup_path"
    LAST_BACKUP="$backup_path"
    log "Backup created at: $backup_path"
}

# Replace the database volume's contents with a backup's sqlite_data.tar.gz
restore_volume_from_backup() {
    local backup_path="$1"
    if [[ ! -f "$backup_path/sqlite_data.tar.gz" ]]; then
        warning "No database archive in $backup_path"
        return 1
    fi

    local volume_name
    volume_name=$(data_volume_name)
    if [[ -z "$volume_name" ]]; then
        warning "SQLite volume not found; cannot restore $backup_path"
        return 1
    fi

    (cd "$APP_DIR" && docker compose stop backend >/dev/null 2>&1) || true
    docker run --rm -v "$volume_name":/data -v "$backup_path":/backup:ro alpine \
        sh -c 'find /data -mindepth 1 -delete && tar xzf /backup/sqlite_data.tar.gz -C /data'
    (cd "$APP_DIR" && docker compose start backend >/dev/null 2>&1) || true
    log "Database restored from $backup_path (volume: $volume_name)"
}

# Keep the newest $BACKUP_KEEP backups
rotate_backups() {
    if [[ ! -d "$BACKUP_DIR" ]]; then
        return 0
    fi
    local old
    old=$(find "$BACKUP_DIR" -maxdepth 1 -type d -name 'backup-*' | sort -r | tail -n +$((BACKUP_KEEP + 1)))
    if [[ -n "$old" ]]; then
        log "Removing backups older than the newest $BACKUP_KEEP..."
        echo "$old" | xargs sudo rm -rf --
    fi
}

# Remove images left dangling by rebuilds (the previous backend image, the old
# nginx:alpine) and unused build cache. Tagged images and images used by any
# container, including other applications', are left alone.
cleanup_docker_images() {
    if ! command -v docker &>/dev/null; then
        return 0
    fi
    log "Removing unused Docker images and build cache..."
    local reclaimed=""
    reclaimed=$(docker image prune -f 2>/dev/null | tail -1) || true
    docker builder prune -f >/dev/null 2>&1 || true
    log "Docker cleanup done${reclaimed:+ ($reclaimed)}"
}

# Clean up existing installation
cleanup_existing() {
    log "Cleaning up existing installation..."

    # Clean install and cleanup-only remove the database; preserve keeps it
    local volume_name=""
    if [[ "$INSTALL_MODE" == "clean" ]] || [[ "$INSTALL_MODE" == "cleanup" ]]; then
        volume_name=$(data_volume_name)
    fi

    # Stop and remove containers
    if [[ -f "$APP_DIR/docker-compose.yml" ]]; then
        (cd "$APP_DIR" && docker compose down --remove-orphans 2>/dev/null) || true
    fi

    # Remove application directory
    if [[ -d "$APP_DIR" ]]; then
        sudo rm -rf "$APP_DIR"
    fi

    if [[ -n "$volume_name" ]]; then
        if docker volume rm "$volume_name" >/dev/null 2>&1; then
            log "Removed data volume $volume_name"
        else
            warning "Could not remove data volume $volume_name"
        fi
    fi

    cleanup_docker_images
    log "Cleanup completed"
}

# Version the CSS/JS URLs in index.html so browsers load the new files after an
# update instead of serving stale ones from cache
stamp_asset_versions() {
    local index="$APP_DIR/frontend/index.html"
    if [[ ! -f "$index" ]]; then
        return 0
    fi
    local version
    version=$(git -C "$APP_DIR" rev-parse --short HEAD 2>/dev/null || date +%Y%m%d%H%M%S)
    sed -i -E "s#((href|src)=\"static/[^\"?]+\.(css|js))(\?v=[^\"]*)?\"#\1?v=${version}\"#g" "$index"
    log "Frontend asset URLs versioned ($version)"
}

# Installs made before v1.1 let browsers cache index.html for an hour; serve it
# with revalidation so an update shows on the next page load
migrate_nginx_cache_headers() {
    local conf="$APP_DIR/nginx-production.conf"
    if [[ ! -f "$conf" ]] || ! grep -q 'expires 1h;' "$conf"; then
        return 0
    fi
    sed -i -e 's/expires 1h;/expires off;/' \
           -e '/location \/ {/,/}/ s/add_header Cache-Control "public, no-transform";/add_header Cache-Control "no-cache";/' \
           "$conf"
    log "Updated nginx cache headers for index.html"
}

# Changes the installer makes to the checked-out source; re-applied after every checkout
apply_production_patches() {
    update_flask_cors_config
    stamp_asset_versions
    migrate_nginx_cache_headers
}

# Move the source tree to a git ref, keeping the generated production files
# (docker-compose.yml is tracked, so a plain reset would swap in the dev one)
checkout_preserving_configs() {
    local ref="$1"
    local keep_dir f
    keep_dir=$(mktemp -d)
    for f in .env docker-compose.yml nginx-production.conf; do
        if [[ -f "$APP_DIR/$f" ]]; then
            cp -p "$APP_DIR/$f" "$keep_dir/"
        fi
    done

    git -C "$APP_DIR" reset -q --hard "$ref"

    for f in .env docker-compose.yml nginx-production.conf; do
        if [[ -f "$keep_dir/$f" ]]; then
            cp -p "$keep_dir/$f" "$APP_DIR/$f"
        fi
    done
    rm -rf "$keep_dir"
}

# Wait until nginx answers and proxies a healthy backend response
wait_for_healthy() {
    local port=""
    if [[ -f "$APP_DIR/.env" ]]; then
        port=$(grep -E '^FRONTEND_PORT=' "$APP_DIR/.env" | tail -1 | cut -d= -f2) || true
    fi
    local url="http://localhost:${port:-$FRONTEND_PORT}/api/health"
    local waited=0

    log "Waiting for the application to respond at $url ..."
    while (( waited < HEALTH_TIMEOUT )); do
        if curl -fsS -o /dev/null --max-time 5 "$url" 2>/dev/null; then
            log "Application is healthy"
            return 0
        fi
        sleep 5
        waited=$((waited + 5))
    done

    error "Application did not become healthy within ${HEALTH_TIMEOUT}s"
    (cd "$APP_DIR" && docker compose ps && docker compose logs --tail=40) || true
    return 1
}

# Pull the latest nginx image and build the backend; running containers keep
# serving the current version until they are recreated
build_images() {
    log "Building images..."
    (cd "$APP_DIR" && docker compose pull nginx) || warning "Could not pull the latest nginx image; using the local one"
    (cd "$APP_DIR" && docker compose build --pull --no-cache)
}

# Setup application directory
setup_app_directory() {
    log "Setting up application directory..."

    # Ensure parent directory allows creation
    sudo mkdir -p "$(dirname "$APP_DIR")"

    # Install git if needed
    if ! command -v git &> /dev/null; then
        sudo apt-get install -y git
    fi

    # Clone from GitHub (clone creates the target directory itself)
    log "Cloning repository from GitHub..."
    sudo git clone "$GITHUB_REPO" "$APP_DIR"
    sudo chown -R $USER:$USER "$APP_DIR"

    log "Application cloned to $APP_DIR"
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
        
        # Serve frontend files (revalidated so updates show immediately;
        # static/ URLs carry a version, so they can be cached long-term)
        location / {
            root /usr/share/nginx/html;
            try_files \$uri \$uri/ /index.html;
            expires off;
            add_header Cache-Control "no-cache";
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
            expires off;
            add_header Cache-Control "no-cache";
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
ExecStart=/usr/bin/docker compose up -d
ExecStop=/usr/bin/docker compose down
ExecReload=/usr/bin/docker compose restart
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

    build_images
    docker compose up -d --remove-orphans

    if ! wait_for_healthy; then
        error "Failed to start services"
        exit 1
    fi

    cleanup_docker_images
}

# Restore data from backup
restore_data() {
    if [[ "$INSTALL_MODE" != "preserve" ]] && [[ "$INSTALL_MODE" != "upgrade" ]]; then
        return
    fi

    local backup="$LAST_BACKUP"
    if [[ -z "$backup" ]]; then
        backup=$(find "$BACKUP_DIR" -maxdepth 1 -name "backup-*" -type d 2>/dev/null | sort -r | head -1) || true
    fi

    if [[ -z "$backup" ]]; then
        warning "No backup found to restore"
        return
    fi

    log "Restoring data from backup: $backup"
    restore_volume_from_backup "$backup" || warning "Data was not restored; the existing volume is kept as is"
}

# Write the backoffice-maintenance helper (regenerated on every install/upgrade)
write_maintenance_script() {
    cat > "$APP_DIR/maintenance.sh" <<'EOF'
#!/bin/bash

# BackOffice Invoice System Maintenance Script (generated by install-production.sh)

set -euo pipefail

APP_DIR="__APP_DIR__"
BACKUP_DIR="__BACKUP_DIR__"
cd "$APP_DIR"

data_volume() {
    local cid name=""
    cid=$(docker compose ps -aq backend 2>/dev/null | head -1) || true
    if [[ -n "$cid" ]]; then
        name=$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/app/data"}}{{.Name}}{{end}}{{end}}' "$cid" 2>/dev/null) || true
    fi
    echo "${name:-$(basename "$APP_DIR")_sqlite_data}"
}

case "${1:-}" in
    start)
        docker compose up -d
        ;;
    stop)
        docker compose down
        ;;
    restart)
        docker compose restart
        ;;
    status)
        docker compose ps
        ;;
    logs)
        docker compose logs -f
        ;;
    backup)
        backup_path="$BACKUP_DIR/backup-$(date +%Y%m%d-%H%M%S)"
        sudo mkdir -p "$BACKUP_DIR"
        sudo chown "$USER:$(id -gn)" "$BACKUP_DIR"
        mkdir -p "$backup_path"
        cp docker-compose.yml "$backup_path/"
        cp .env nginx-production.conf "$backup_path/" 2>/dev/null || true
        git rev-parse HEAD > "$backup_path/commit" 2>/dev/null || true

        # Stop the backend so SQLite isn't written mid-copy
        volume=$(data_volume)
        trap 'docker compose start backend >/dev/null 2>&1 || true' EXIT
        docker compose stop backend >/dev/null
        docker run --rm -v "$volume":/data:ro -v "$backup_path":/backup alpine \
            tar czf /backup/sqlite_data.tar.gz -C /data .
        tar tzf "$backup_path/sqlite_data.tar.gz" >/dev/null
        echo "Backup created at: $backup_path"
        ;;
    restore)
        backup_path="${2:-}"
        if [[ -z "$backup_path" ]] || [[ ! -f "$backup_path/sqlite_data.tar.gz" ]]; then
            echo "Usage: $0 restore <backup-dir>"
            echo "Available backups:"
            ls -1d "$BACKUP_DIR"/backup-* 2>/dev/null || echo "  (none)"
            exit 1
        fi
        read -p "Replace the current database with $backup_path? (y/N): " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            exit 0
        fi
        volume=$(data_volume)
        trap 'docker compose start backend >/dev/null 2>&1 || true' EXIT
        docker compose stop backend >/dev/null
        docker run --rm -v "$volume":/data -v "$backup_path":/backup:ro alpine \
            sh -c 'find /data -mindepth 1 -delete && tar xzf /backup/sqlite_data.tar.gz -C /data'
        echo "Database restored from $backup_path"
        ;;
    update)
        # Run the newest installer's upgrade: backup, update, rebuild, health check, cleanup
        git fetch -q origin main
        installer=$(mktemp)
        trap 'rm -f "$installer"' EXIT
        git show origin/main:install-production.sh > "$installer"
        bash "$installer" --upgrade
        ;;
    cleanup)
        docker image prune -f
        docker builder prune -f
        ;;
    *)
        echo "Usage: $0 {start|stop|restart|status|logs|backup|restore <backup-dir>|update|cleanup}"
        exit 1
        ;;
esac
EOF

    sed -i -e "s#__APP_DIR__#$APP_DIR#" -e "s#__BACKUP_DIR__#$BACKUP_DIR#" "$APP_DIR/maintenance.sh"
    chmod +x "$APP_DIR/maintenance.sh"
    sudo ln -sf "$APP_DIR/maintenance.sh" /usr/local/bin/backoffice-maintenance
}

# Post-installation tasks
post_installation() {
    log "Performing post-installation tasks..."
    
    # Create log directory
    sudo mkdir -p /var/log/backoffice-invoice
    sudo chown -R $USER:$USER /var/log/backoffice-invoice
    
    write_maintenance_script
    rotate_backups

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
        echo "  🌐 Frontend (HTTPS): https://$SERVER_IP"
        echo "  🌐 Frontend (HTTP):  http://$SERVER_IP"
    else
        echo "  🌐 Frontend: http://$SERVER_IP"
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
    echo "  📋 View logs: docker compose logs -f"
    echo "  🛠️  Maintenance: backoffice-maintenance {start|stop|restart|status|logs|backup|restore|update|cleanup}"
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

# Return the source tree to a previous commit. With "rebuild", also rebuild and
# restart the containers on it (used when the new version failed to start).
rollback_source() {
    local previous_commit="$1"
    local rebuild="${2:-}"

    if [[ -z "$previous_commit" ]]; then
        warning "No previous version recorded; cannot roll back automatically"
        return 1
    fi

    warning "Rolling back to ${previous_commit:0:7}..."
    checkout_preserving_configs "$previous_commit"
    apply_production_patches

    if [[ "$rebuild" == "rebuild" ]]; then
        if ! (cd "$APP_DIR" && docker compose build && docker compose up -d --force-recreate --remove-orphans); then
            error "Rollback rebuild failed"
            return 1
        fi
        wait_for_healthy || return 1
    fi

    log "Rolled back to ${previous_commit:0:7}"
}

# Upgrade application from GitHub (preserves data and config)
#   1. back up the database + configs (backend stopped for a few seconds)
#   2. update the source, keeping the generated production files
#   3. build new images while the current version keeps running
#   4. recreate containers and wait for a health check; roll back on failure
#   5. remove dangling images/build cache and old backups
upgrade_application() {
    log "Starting upgrade..."

    if [[ ! -d "$APP_DIR" ]]; then
        error "Application not found at $APP_DIR. Please run a fresh install first."
        exit 1
    fi

    if ! command -v git &> /dev/null; then
        sudo apt-get update && sudo apt-get install -y git
    fi

    cd "$APP_DIR"

    # Installs from before git support: turn the directory into a clone in place
    if [[ ! -d "$APP_DIR/.git" ]]; then
        warning "No git repository found. Initializing from GitHub..."
        git init -q
        git remote add origin "$GITHUB_REPO"
    fi

    local previous_commit=""
    previous_commit=$(git rev-parse -q --verify HEAD 2>/dev/null) || true

    # 1. Backup
    if ! backup_data; then
        (cd "$APP_DIR" && docker compose start backend >/dev/null 2>&1) || true
        error "Backup failed; upgrade aborted. Nothing was changed."
        exit 1
    fi
    (cd "$APP_DIR" && docker compose start backend >/dev/null 2>&1) || true

    # 2. Source
    log "Fetching latest version from GitHub..."
    git fetch -q origin main
    local target
    target=$(git rev-parse origin/main)
    if [[ "$previous_commit" == "$target" ]]; then
        log "Already on the latest version (${target:0:7}); rebuilding to pick up base image updates"
    fi
    checkout_preserving_configs "$target"
    apply_production_patches
    log "Source updated: ${previous_commit:0:7} -> ${target:0:7}"

    # Load environment variables if they exist
    if [[ -f ".env" ]]; then
        export $(cat .env | grep -v '^#' | xargs)
    fi

    # 3. Build
    if ! build_images; then
        error "Build failed; the running version was not touched"
        rollback_source "$previous_commit" || true
        exit 1
    fi

    # 4. Restart on the new images (force-recreate so nginx re-reads its config)
    log "Restarting containers..."
    docker compose up -d --force-recreate --remove-orphans

    if ! wait_for_healthy; then
        error "New version failed its health check"
        if rollback_source "$previous_commit" rebuild; then
            warning "Upgrade rolled back; the previous version is running again."
        else
            error "Automatic rollback failed. Check 'docker compose logs' in $APP_DIR."
        fi
        if [[ -n "$LAST_BACKUP" ]]; then
            info "The database was backed up before the upgrade. To restore it:"
            echo "  backoffice-maintenance restore $LAST_BACKUP"
        fi
        exit 1
    fi

    # 5. Cleanup
    write_maintenance_script
    cleanup_docker_images
    rotate_backups

    echo
    log "Application upgraded successfully to ${target:0:7}! Data and settings preserved."
    if [[ -n "$LAST_BACKUP" ]]; then
        info "Pre-upgrade backup: $LAST_BACKUP"
    fi
    info "Access the application at the same URL as before."
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

    # Select mode first (upgrade doesn't need IP prompt).
    # "--upgrade" skips the menu; backoffice-maintenance update uses it.
    if [[ "${1:-}" == "--upgrade" ]]; then
        INSTALL_MODE="upgrade"
    else
        select_installation_mode
    fi

    # Only prompt for IP on fresh installs
    if [[ "$INSTALL_MODE" != "upgrade" ]]; then
        prompt_server_ip
    fi
    
    # Handle cleanup-only mode
    if [[ "$INSTALL_MODE" == "cleanup" ]]; then
        if ! backup_data; then
            error "Backup failed; cleanup aborted. Nothing was removed."
            exit 1
        fi
        cleanup_existing
        log "Cleanup completed"
        exit 0
    fi

    # Handle upgrade mode (pull from GitHub, rebuild, preserve data)
    if [[ "$INSTALL_MODE" == "upgrade" ]]; then
        upgrade_application
        exit 0
    fi

    configure_ssl
    
    # Installation process
    install_dependencies
    install_docker
    
    # Handle data preservation
    if [[ "$INSTALL_MODE" == "preserve" ]]; then
        if ! backup_data; then
            error "Backup failed; installation aborted. Nothing was changed."
            exit 1
        fi
    fi
    
    cleanup_existing
    setup_app_directory
    configure_production_environment
    
    # SSL setup
    generate_ssl_certificates
    
    # Configuration
    create_production_docker_compose
    create_production_nginx_config
    apply_production_patches
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