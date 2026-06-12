class ExportManager {
    constructor() {
        this.configId = null;
        this.recordType = 'invoice'; // 'invoice' | 'po'
        this.currentPage = 1;
        this.searchTerm = '';
        this.init();
    }

    init() {
        const tab = document.getElementById('export-tab');
        if (tab) {
            tab.addEventListener('shown.bs.tab', () => this.initializeExportView());
        }
    }

    initializeExportView() {
        const container = document.getElementById('export-content');
        if (!container) return;

        const databaseOptions = databaseManager.getDatabaseOptions();

        if (databaseOptions.length === 0) {
            container.innerHTML = `
                <div class="text-center py-5">
                    <i class="fas fa-exclamation-triangle fa-3x text-warning mb-3"></i>
                    <h5 class="text-warning">No Database Configurations Found</h5>
                    <p class="text-muted">Please add and test a database configuration first</p>
                    <button class="btn btn-primary" onclick="document.getElementById('databases-tab').click()">
                        <i class="fas fa-database me-2"></i>Go to Database Settings
                    </button>
                </div>
            `;
            return;
        }

        this.render(databaseOptions);
    }

    render(databaseOptions) {
        const container = document.getElementById('export-content');

        container.innerHTML = `
            <div class="d-flex justify-content-between align-items-center mb-4">
                <div>
                    <h5 class="mb-0">Export Data</h5>
                    <p class="text-muted mb-0 small">Download a saved invoice or purchase order as an Excel file (UPC, QTY, Cost, Description) that can be re-imported.</p>
                </div>
            </div>

            <div class="row mb-3">
                <div class="col-md-4">
                    <label for="exportDb" class="form-label">Database</label>
                    <select class="form-select" id="exportDb" required>
                        <option value="">Select database...</option>
                        ${databaseOptions.map(db => `
                            <option value="${db.id}" ${String(db.id) === String(this.configId) ? 'selected' : ''}>${db.name} (${db.server}/${db.database})</option>
                        `).join('')}
                    </select>
                </div>
                <div class="col-md-4">
                    <label class="form-label">Record Type</label>
                    <div class="btn-group w-100" role="group" id="exportTypeToggle">
                        <button type="button" class="btn ${this.recordType === 'invoice' ? 'btn-primary' : 'btn-outline-primary'}" data-type="invoice">Invoices</button>
                        <button type="button" class="btn ${this.recordType === 'po' ? 'btn-primary' : 'btn-outline-primary'}" data-type="po">Purchase Orders</button>
                    </div>
                </div>
                <div class="col-md-4">
                    <label for="exportSearch" class="form-label">Search by Number</label>
                    <div class="input-group">
                        <input type="text" class="form-control" id="exportSearch" placeholder="Enter number..." autocomplete="off" value="${this.searchTerm}">
                        <button class="btn btn-outline-secondary" type="button" id="exportSearchBtn">
                            <i class="fas fa-search"></i>
                        </button>
                        <button class="btn btn-secondary" type="button" id="exportClearBtn">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                </div>
            </div>

            <div id="exportTable">
                <p class="text-muted">Select a database to browse records.</p>
            </div>
        `;

        this.attachControlEvents();

        if (this.configId) {
            this.loadRecords();
        }
    }

    attachControlEvents() {
        const dbSelect = document.getElementById('exportDb');
        dbSelect.addEventListener('change', () => {
            this.configId = dbSelect.value || null;
            this.currentPage = 1;
            this.loadRecords();
        });

        document.querySelectorAll('#exportTypeToggle button').forEach(btn => {
            btn.addEventListener('click', () => {
                const type = btn.dataset.type;
                if (type === this.recordType) return;
                this.recordType = type;
                this.currentPage = 1;
                this.searchTerm = '';
                const dbOptions = databaseManager.getDatabaseOptions();
                this.render(dbOptions); // re-render to update toggle + search + table
            });
        });

        const runSearch = () => {
            this.searchTerm = document.getElementById('exportSearch').value.trim();
            this.currentPage = 1;
            this.loadRecords();
        };
        document.getElementById('exportSearchBtn').addEventListener('click', runSearch);
        document.getElementById('exportSearch').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') runSearch();
        });
        document.getElementById('exportClearBtn').addEventListener('click', () => {
            this.searchTerm = '';
            document.getElementById('exportSearch').value = '';
            this.currentPage = 1;
            this.loadRecords();
        });
    }

    async loadRecords() {
        if (!this.configId) return;

        const tableContainer = document.getElementById('exportTable');
        tableContainer.innerHTML = '<p class="text-muted">Loading...</p>';

        try {
            const response = this.recordType === 'invoice'
                ? await api.getExportInvoicesList(this.configId, this.currentPage, 25, this.searchTerm)
                : await api.getExportPurchaseOrdersList(this.configId, this.currentPage, 25, this.searchTerm);

            const records = this.recordType === 'invoice' ? response.invoices : response.purchase_orders;

            if (!records || records.length === 0) {
                tableContainer.innerHTML = '<p class="text-muted">No records found.</p>';
                return;
            }

            this.renderTable(records, response.pagination);
        } catch (error) {
            tableContainer.innerHTML = `<div class="alert alert-danger">Failed to load records: ${error.message}</div>`;
        }
    }

    renderTable(records, pagination) {
        const tableContainer = document.getElementById('exportTable');
        const isInvoice = this.recordType === 'invoice';
        const numberLabel = isInvoice ? 'Invoice #' : 'PO #';

        const normalized = records.map(r => ({
            id: isInvoice ? r.InvoiceID : r.PoID,
            number: isInvoice ? r.InvoiceNumber : r.PoNumber,
            date: isInvoice ? r.InvoiceDate : r.PoDate,
            business: r.BusinessName,
            account: r.AccountNo,
            total: isInvoice ? r.InvoiceTotal : r.PoTotal,
            lines: r.NoLines
        }));

        let html = `
            <div class="table-responsive">
                <table class="table table-striped invoice-browse-table">
                    <thead>
                        <tr>
                            <th>${numberLabel}</th>
                            <th>Date</th>
                            <th>${isInvoice ? 'Customer' : 'Supplier'}</th>
                            <th>Account #</th>
                            <th>Total</th>
                            <th>Lines</th>
                            <th class="text-end">Action</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${normalized.map(r => `
                            <tr>
                                <td><strong>${r.number || ''}</strong></td>
                                <td>${r.date ? String(r.date).split(' ')[0] : ''}</td>
                                <td>${r.business || ''}</td>
                                <td>${r.account || ''}</td>
                                <td>$${parseFloat(r.total || 0).toFixed(2)}</td>
                                <td>${r.lines || 0}</td>
                                <td class="text-end">
                                    <button class="btn btn-sm btn-primary export-record-btn" data-id="${r.id}" data-number="${r.number || ''}">
                                        <i class="fas fa-file-excel me-1"></i>Export
                                    </button>
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `;

        if (pagination && pagination.total_pages > 1) {
            html += `
                <div class="invoice-pagination d-flex justify-content-between align-items-center mt-2">
                    <span class="text-muted small">
                        Showing page ${pagination.page} of ${pagination.total_pages} (${pagination.total} records)
                    </span>
                    <div>
                        <button class="btn btn-sm btn-outline-secondary me-1" id="exportPrevPage" ${!pagination.has_prev ? 'disabled' : ''}>
                            <i class="fas fa-chevron-left"></i> Prev
                        </button>
                        <button class="btn btn-sm btn-outline-secondary" id="exportNextPage" ${!pagination.has_next ? 'disabled' : ''}>
                            Next <i class="fas fa-chevron-right"></i>
                        </button>
                    </div>
                </div>
            `;
        }

        tableContainer.innerHTML = html;

        tableContainer.querySelectorAll('.export-record-btn').forEach(btn => {
            btn.addEventListener('click', () => this.exportRecord(parseInt(btn.dataset.id), btn.dataset.number));
        });

        const prevBtn = document.getElementById('exportPrevPage');
        const nextBtn = document.getElementById('exportNextPage');
        if (prevBtn) prevBtn.addEventListener('click', () => { this.currentPage--; this.loadRecords(); });
        if (nextBtn) nextBtn.addEventListener('click', () => { this.currentPage++; this.loadRecords(); });
    }

    async exportRecord(id, number) {
        if (!this.configId) return;

        try {
            authManager.showLoading(true);
            const isInvoice = this.recordType === 'invoice';
            const blob = isInvoice
                ? await api.exportInvoiceExcel(this.configId, id)
                : await api.exportPurchaseOrderExcel(this.configId, id);

            const prefix = isInvoice ? 'Invoice' : 'PO';
            utils.downloadBlob(blob, `${prefix}_${number || id}.xlsx`);
        } catch (error) {
            authManager.showAlert('Failed to export: ' + error.message, 'danger');
        } finally {
            authManager.showLoading(false);
        }
    }
}

// Global export manager instance
const exportManager = new ExportManager();
