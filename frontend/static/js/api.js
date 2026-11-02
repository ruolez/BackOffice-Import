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

    // Purchase Order endpoints
    async uploadExcelPO(formData) {
        // Remove Content-Type header for FormData
        const headers = { ...this.headers };
        delete headers['Content-Type'];

        return this.request('/po/upload', {
            method: 'POST',
            body: formData,
            headers
        });
    }

    async createPurchaseOrder(poData) {
        return this.request('/po/create', {
            method: 'POST',
            body: JSON.stringify(poData)
        });
    }

    async getNextPONumber(databaseConfigId) {
        return this.request(`/po/next-number/${databaseConfigId}`);
    }

    async validatePoUpcs(data) {
        return this.request('/po/validate-upcs', {
            method: 'POST',
            body: JSON.stringify(data)
        });
    }

    // Supplier endpoints
    async searchSuppliers(data) {
        return this.request('/supplier/search', {
            method: 'POST',
            body: JSON.stringify(data)
        });
    }

    async getSupplier(supplierId, databaseConfigId) {
        return this.request(`/supplier/${supplierId}?database_config_id=${databaseConfigId}`);
    }

    async validateSupplier(data) {
        return this.request('/supplier/validate', {
            method: 'POST',
            body: JSON.stringify(data)
        });
    }

    // Invoice Copy endpoints
    async getInvoicesList(configId, page = 1, perPage = 25, search = '') {
        let url = `/invoice-copy/invoices/${configId}?page=${page}&per_page=${perPage}`;
        if (search) url += `&search=${encodeURIComponent(search)}`;
        return this.request(url);
    }

    async getInvoiceDetail(configId, invoiceId) {
        return this.request(`/invoice-copy/invoice-detail/${configId}/${invoiceId}`);
    }

    async prepareInvoiceCopy(data) {
        return this.request('/invoice-copy/prepare', {
            method: 'POST',
            body: JSON.stringify(data)
        });
    }

    async createCopiedInvoice(data) {
        return this.request('/invoice-copy/create', {
            method: 'POST',
            body: JSON.stringify(data)
        });
    }

    // Export endpoints
    async getExportInvoicesList(configId, page = 1, perPage = 25, search = '') {
        let url = `/export/invoices/${configId}?page=${page}&per_page=${perPage}`;
        if (search) url += `&search=${encodeURIComponent(search)}`;
        return this.request(url);
    }

    async getExportPurchaseOrdersList(configId, page = 1, perPage = 25, search = '') {
        let url = `/export/purchase-orders/${configId}?page=${page}&per_page=${perPage}`;
        if (search) url += `&search=${encodeURIComponent(search)}`;
        return this.request(url);
    }

    async exportInvoiceExcel(configId, invoiceId) {
        return this.requestBlob(`/export/invoice/${configId}/${invoiceId}`);
    }

    async exportPurchaseOrderExcel(configId, poId) {
        return this.requestBlob(`/export/purchase-order/${configId}/${poId}`);
    }

    // Fetch a binary file response as a Blob (the standard request() assumes JSON)
    // Monthly run (batch) endpoints
    async getBatchRules() {
        return this.request('/batch/rules');
    }

    async saveBatchRule(rule) {
        return this.request(rule.id ? `/batch/rules/${rule.id}` : '/batch/rules', {
            method: rule.id ? 'PUT' : 'POST',
            body: JSON.stringify(rule)
        });
    }

    async deleteBatchRule(ruleId) {
        return this.request(`/batch/rules/${ruleId}`, { method: 'DELETE' });
    }

    async getBatchRuns() {
        return this.request('/batch/runs');
    }

    async createBatchRun() {
        return this.request('/batch/runs', { method: 'POST' });
    }

    async getBatchRun(runId, withLogs = false) {
        return this.request(`/batch/runs/${runId}${withLogs ? '?logs=1' : ''}`);
    }

    async discardBatchRun(runId) {
        return this.request(`/batch/runs/${runId}`, { method: 'DELETE' });
    }

    async addBatchRunFile(runId, file) {
        const formData = new FormData();
        formData.append('file', file);
        const headers = { ...this.headers };
        delete headers['Content-Type'];
        return this.request(`/batch/runs/${runId}/files`, { method: 'POST', body: formData, headers });
    }

    async setBatchFileRule(runId, fileId, ruleId) {
        return this.request(`/batch/runs/${runId}/files/${fileId}`, {
            method: 'PUT',
            body: JSON.stringify({ rule_id: ruleId })
        });
    }

    async removeBatchRunFile(runId, fileId) {
        return this.request(`/batch/runs/${runId}/files/${fileId}`, { method: 'DELETE' });
    }

    async setBatchStepIncluded(runId, stepId, included) {
        return this.request(`/batch/runs/${runId}/steps/${stepId}`, {
            method: 'PATCH',
            body: JSON.stringify({ included })
        });
    }

    async setBatchStepHold(runId, stepId, hold) {
        return this.request(`/batch/runs/${runId}/steps/${stepId}`, {
            method: 'PATCH',
            body: JSON.stringify({ hold })
        });
    }

    async recheckBatchRun(runId, fileId = null) {
        return this.request(`/batch/runs/${runId}/recheck`, {
            method: 'POST',
            body: JSON.stringify(fileId ? { file_id: fileId } : {})
        });
    }

    async executeBatchRun(runId) {
        return this.request(`/batch/runs/${runId}/execute`, { method: 'POST' });
    }

    async cancelBatchRun(runId) {
        return this.request(`/batch/runs/${runId}/cancel`, { method: 'POST' });
    }

    async getBatchRunReport(runId) {
        return this.request(`/batch/runs/${runId}/report`);
    }

    async downloadBatchRunReport(runId) {
        return this.requestBlob(`/batch/runs/${runId}/report.xlsx`);
    }

    async downloadBatchRunLog(runId) {
        return this.requestBlob(`/batch/runs/${runId}/log.txt`);
    }

    // Sales presets
    async getSalesPresets() {
        return this.request('/batch/presets');
    }

    async saveSalesPreset(preset) {
        return this.request(preset.id ? `/batch/presets/${preset.id}` : '/batch/presets', {
            method: preset.id ? 'PUT' : 'POST',
            body: JSON.stringify(preset)
        });
    }

    async deleteSalesPreset(presetId) {
        return this.request(`/batch/presets/${presetId}`, { method: 'DELETE' });
    }

    async testSalesPreset(preset) {
        return this.request('/batch/presets/test', { method: 'POST', body: JSON.stringify(preset) });
    }

    async getSourceCategories(configId) {
        return this.request(`/batch/sources/${configId}/categories`);
    }

    async searchSourceItems(configId, term) {
        return this.request(`/batch/sources/${configId}/items?q=${encodeURIComponent(term)}`);
    }

    async addBatchSales(runId, presetId) {
        return this.request(`/batch/runs/${runId}/sales`, { method: 'POST', body: JSON.stringify({ preset_id: presetId }) });
    }

    async repullBatchSales(runId, fileId) {
        return this.request(`/batch/runs/${runId}/files/${fileId}/pull`, { method: 'POST' });
    }

    async downloadBatchFileRows(runId, fileId) {
        return this.requestBlob(`/batch/runs/${runId}/files/${fileId}/rows.xlsx`);
    }

    async requestBlob(endpoint) {
        const response = await fetch(`${this.baseUrl}${endpoint}`, {
            credentials: 'include'
        });
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
        }
        return await response.blob();
    }

    // Health check
    async healthCheck() {
        return this.request('/health');
    }
}

// Global API instance
const api = new ApiService();