// Database configuration management

class DatabaseManager {
    constructor() {
        this.databases = [];
        this.currentEditingId = null;
        this.init();
    }

    init() {
        this.setupEventListeners();
    }

    setupEventListeners() {
        // Save database configuration
        const saveBtn = document.getElementById('saveDatabaseBtn');
        if (saveBtn) {
            saveBtn.addEventListener('click', () => this.handleSave());
        }

        // Test connection
        const testBtn = document.getElementById('testConnectionBtn');
        if (testBtn) {
            testBtn.addEventListener('click', () => this.handleTestConnection());
        }

        // Modal events
        const modal = document.getElementById('databaseModal');
        if (modal) {
            modal.addEventListener('show.bs.modal', (e) => {
                const button = e.relatedTarget;
                if (button && button.dataset.configId) {
                    this.loadConfigForEdit(button.dataset.configId);
                } else {
                    this.resetForm();
                }
            });

            modal.addEventListener('hidden.bs.modal', () => {
                this.resetForm();
            });
        }
    }

    async loadDatabaseConfigs() {
        try {
            authManager.showLoading(true);
            const response = await api.getDatabaseConfigs();
            this.databases = response.configs;
            this.renderDatabaseList();
        } catch (error) {
            authManager.showAlert('Failed to load database configurations: ' + error.message, 'danger');
        } finally {
            authManager.showLoading(false);
        }
    }

    renderDatabaseList() {
        const container = document.getElementById('database-list');
        if (!container) return;

        if (this.databases.length === 0) {
            container.innerHTML = `
                <div class="text-center py-5">
                    <i class="fas fa-database fa-3x text-muted mb-3"></i>
                    <h5 class="text-muted">No database configurations found</h5>
                    <p class="text-muted">Click "Add Database" to create your first configuration</p>
                </div>
            `;
            return;
        }

        const html = this.databases.map(config => `
            <div class="card database-card mb-3">
                <div class="card-body">
                    <div class="row align-items-center">
                        <div class="col-md-8">
                            <h5 class="card-title mb-1">
                                <i class="fas fa-database me-2"></i>${config.name}
                            </h5>
                            <p class="card-text text-muted mb-2">
                                <i class="fas fa-server me-2"></i>${config.server}:${config.port}
                                <i class="fas fa-table ms-3 me-2"></i>${config.database}
                            </p>
                            <div class="d-flex align-items-center">
                                <span class="database-status ${config.is_active ? 'active' : 'inactive'}">
                                    ${config.is_active ? 'Active' : 'Inactive'}
                                </span>
                                ${config.last_tested ? `
                                    <small class="text-muted ms-3">
                                        <i class="fas fa-clock me-1"></i>
                                        Last tested: ${new Date(config.last_tested).toLocaleDateString()}
                                    </small>
                                ` : ''}
                            </div>
                        </div>
                        <div class="col-md-4 text-end">
                            <div class="btn-group">
                                <button class="btn btn-sm btn-outline-info" onclick="databaseManager.testConnection(${config.id})">
                                    <i class="fas fa-plug me-1"></i>Test
                                </button>
                                <button class="btn btn-sm btn-outline-primary" data-bs-toggle="modal" data-bs-target="#databaseModal" data-config-id="${config.id}">
                                    <i class="fas fa-edit me-1"></i>Edit
                                </button>
                                <button class="btn btn-sm btn-outline-danger" onclick="databaseManager.deleteConfig(${config.id})">
                                    <i class="fas fa-trash me-1"></i>Delete
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `).join('');

        container.innerHTML = html;
    }

    async handleSave() {
        const form = document.getElementById('databaseForm');
        const password = document.getElementById('databasePassword').value;
        
        // For new configs, password is required
        if (!this.currentEditingId && !password.trim()) {
            document.getElementById('databasePassword').setCustomValidity('Password is required');
            form.reportValidity();
            return;
        } else {
            document.getElementById('databasePassword').setCustomValidity('');
        }
        
        if (!form.checkValidity()) {
            form.reportValidity();
            return;
        }

        const configData = {
            name: document.getElementById('databaseName').value,
            server: document.getElementById('databaseServer').value,
            port: parseInt(document.getElementById('databasePort').value),
            database: document.getElementById('databaseDbName').value,
            username: document.getElementById('databaseUsername').value,
            driver: document.getElementById('databaseDriver').value,
            encrypt_connection: document.getElementById('encryptConnection').checked,
            trust_server_certificate: document.getElementById('trustServerCertificate').checked,
            tls_min_protocol: document.getElementById('tlsMinProtocol').value || null
        };

        // Only include password if it's provided (for edits, blank means keep existing)
        if (password.trim() !== '') {
            configData.password = password;
        }

        try {
            authManager.showLoading(true);
            
            if (this.currentEditingId) {
                await api.updateDatabaseConfig(this.currentEditingId, configData);
                authManager.showAlert('Database configuration updated successfully', 'success');
            } else {
                await api.createDatabaseConfig(configData);
                authManager.showAlert('Database configuration created successfully', 'success');
            }

            // Close modal
            const modal = bootstrap.Modal.getInstance(document.getElementById('databaseModal'));
            modal.hide();

            // Reload list
            await this.loadDatabaseConfigs();

        } catch (error) {
            authManager.showAlert('Failed to save database configuration: ' + error.message, 'danger');
        } finally {
            authManager.showLoading(false);
        }
    }

    async handleTestConnection() {
        const configId = this.currentEditingId;
        if (!configId) {
            authManager.showAlert('Please save the configuration first', 'warning');
            return;
        }

        await this.testConnection(configId);
    }

    async testConnection(configId) {
        try {
            authManager.showLoading(true);
            const response = await api.testDatabaseConnection(configId);
            
            if (response.success) {
                authManager.showAlert('Connection successful!', 'success');
                // Reload list to update last_tested timestamp
                await this.loadDatabaseConfigs();
            } else {
                authManager.showAlert('Connection failed: ' + response.message, 'danger');
            }
        } catch (error) {
            authManager.showAlert('Connection test failed: ' + error.message, 'danger');
        } finally {
            authManager.showLoading(false);
        }
    }

    async deleteConfig(configId) {
        const config = this.databases.find(db => db.id === configId);
        if (!config) return;

        if (!confirm(`Are you sure you want to delete the database configuration "${config.name}"?`)) {
            return;
        }

        try {
            authManager.showLoading(true);
            await api.deleteDatabaseConfig(configId);
            authManager.showAlert('Database configuration deleted successfully', 'success');
            await this.loadDatabaseConfigs();
        } catch (error) {
            authManager.showAlert('Failed to delete database configuration: ' + error.message, 'danger');
        } finally {
            authManager.showLoading(false);
        }
    }

    loadConfigForEdit(configId) {
        const config = this.databases.find(db => db.id === parseInt(configId));
        if (!config) return;

        this.currentEditingId = config.id;
        document.getElementById('databaseId').value = config.id;
        document.getElementById('databaseName').value = config.name;
        document.getElementById('databaseServer').value = config.server;
        document.getElementById('databasePort').value = config.port;
        document.getElementById('databaseDbName').value = config.database;
        document.getElementById('databaseUsername').value = config.username;
        document.getElementById('databasePassword').value = ''; // Don't show password
        document.getElementById('databaseDriver').value = config.driver || 'ODBC Driver 18 for SQL Server';
        
        // Update password field
        const passwordField = document.getElementById('databasePassword');
        const passwordHelp = document.getElementById('passwordHelp');
        if (config.has_password) {
            passwordField.removeAttribute('required');
            passwordField.placeholder = 'Leave blank to keep existing password';
            passwordHelp.textContent = 'Leave blank to keep existing password';
            passwordHelp.classList.add('text-muted');
        } else {
            passwordField.setAttribute('required', 'required');
            passwordField.placeholder = 'Enter password';
            passwordHelp.textContent = 'Password is required';
            passwordHelp.classList.remove('text-muted');
        }
        
        // Load connection security options
        document.getElementById('encryptConnection').checked = config.encrypt_connection !== undefined ? config.encrypt_connection : true;
        document.getElementById('trustServerCertificate').checked = config.trust_server_certificate !== undefined ? config.trust_server_certificate : true;
        document.getElementById('tlsMinProtocol').value = config.tls_min_protocol || '';
        
        // Update modal title
        const modalTitle = document.querySelector('#databaseModal .modal-title');
        if (modalTitle) {
            modalTitle.textContent = 'Edit Database Configuration';
        }
    }

    resetForm() {
        this.currentEditingId = null;
        const form = document.getElementById('databaseForm');
        if (form) {
            form.reset();
        }
        document.getElementById('databasePort').value = '1433';
        document.getElementById('databaseDriver').value = 'ODBC Driver 18 for SQL Server';
        
        // Reset password field
        const passwordField = document.getElementById('databasePassword');
        const passwordHelp = document.getElementById('passwordHelp');
        passwordField.setAttribute('required', 'required');
        passwordField.placeholder = 'Enter password';
        passwordHelp.textContent = 'Password is required';
        passwordHelp.classList.remove('text-muted');
        
        // Reset connection security options to defaults
        document.getElementById('encryptConnection').checked = true;
        document.getElementById('trustServerCertificate').checked = true;
        document.getElementById('tlsMinProtocol').value = '';
        
        // Reset modal title
        const modalTitle = document.querySelector('#databaseModal .modal-title');
        if (modalTitle) {
            modalTitle.textContent = 'Database Configuration';
        }
    }

    getDatabaseOptions() {
        return this.databases.filter(db => db.is_active).map(db => ({
            id: db.id,
            name: db.name,
            server: db.server,
            database: db.database
        }));
    }
}

// Global database manager instance
const databaseManager = new DatabaseManager();