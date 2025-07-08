// API Service for BackOffice Invoice System

class ApiService {
    constructor() {
        this.baseUrl = '/api';
        this.headers = {
            'Content-Type': 'application/json',
        };
    }

    async request(endpoint, options = {}) {
        const url = `${this.baseUrl}${endpoint}`;
        const config = {
            headers: this.headers,
            credentials: 'include',
            ...options
        };

        try {
            const response = await fetch(url, config);
            
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
            }

            return await response.json();
        } catch (error) {
            console.error('API request failed:', error);
            throw error;
        }
    }

    // Auth endpoints
    async login(credentials) {
        return this.request('/auth/login', {
            method: 'POST',
            body: JSON.stringify(credentials)
        });
    }

    async register(userData) {
        return this.request('/auth/register', {
            method: 'POST',
            body: JSON.stringify(userData)
        });
    }

    async logout() {
        return this.request('/auth/logout', {
            method: 'POST'
        });
    }

    async getCurrentUser() {
        return this.request('/auth/me');
    }

    // Database configuration endpoints
    async getDatabaseConfigs() {
        return this.request('/database/configs');
    }

    async createDatabaseConfig(config) {
        return this.request('/database/configs', {
            method: 'POST',
            body: JSON.stringify(config)
        });
    }

    async updateDatabaseConfig(id, config) {
        return this.request(`/database/configs/${id}`, {
            method: 'PUT',
            body: JSON.stringify(config)
        });
    }

    async deleteDatabaseConfig(id) {
        return this.request(`/database/configs/${id}`, {
            method: 'DELETE'
        });
    }

    async testDatabaseConnection(id) {
        return this.request(`/database/configs/${id}/test`, {
            method: 'POST'
        });
    }

    // Invoice endpoints
    async uploadExcel(formData) {
        // Remove Content-Type header for FormData
        const headers = { ...this.headers };
        delete headers['Content-Type'];

        return this.request('/invoice/upload', {
            method: 'POST',
            body: formData,
            headers
        });
    }

    async createInvoice(invoiceData) {
        return this.request('/invoice/create', {
            method: 'POST',
            body: JSON.stringify(invoiceData)
        });
    }

    async getNextInvoiceNumber(databaseConfigId) {
        return this.request(`/invoice/next-number/${databaseConfigId}`);
    }

    async validateUpcs(data) {
        return this.request('/invoice/validate-upcs', {
            method: 'POST',
            body: JSON.stringify(data)
        });
    }

    // Customer endpoints
    async searchCustomers(data) {
        return this.request('/customer/search', {
            method: 'POST',
            body: JSON.stringify(data)
        });
    }

    async getCustomer(customerId, databaseConfigId) {
        return this.request(`/customer/${customerId}?database_config_id=${databaseConfigId}`);
    }

    async validateCustomer(data) {
        return this.request('/customer/validate', {
            method: 'POST',
            body: JSON.stringify(data)
        });
    }

    // Health check
    async healthCheck() {
        return this.request('/health');
    }
}

// Global API instance
const api = new ApiService();