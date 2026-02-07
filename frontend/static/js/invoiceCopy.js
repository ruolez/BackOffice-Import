class InvoiceCopyManager {
    constructor() {
        this.sourceConfigId = null;
        this.destConfigId = null;
        this.selectedInvoice = null;
        this.selectedCustomer = null;
        this.currentPreview = null;
        this.currentPage = 1;
        this.searchTerm = '';
        this.init();
    }

    init() {
        this.setupEventListeners();
    }

    setupEventListeners() {
        const tab = document.getElementById('invoice-copy-tab');
        if (tab) {
            tab.addEventListener('shown.bs.tab', () => {
                this.initializeCopyWizard();
            });
        }
    }

    initializeCopyWizard() {
        const container = document.getElementById('invoice-copy-content');
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

        if (databaseOptions.length < 2) {
            container.innerHTML = `
                <div class="text-center py-5">
                    <i class="fas fa-exclamation-triangle fa-3x text-warning mb-3"></i>
                    <h5 class="text-warning">At Least 2 Database Configurations Required</h5>
                    <p class="text-muted">Copy Invoice requires a source and destination database. Please add another configuration.</p>
                    <button class="btn btn-primary" onclick="document.getElementById('databases-tab').click()">
                        <i class="fas fa-database me-2"></i>Go to Database Settings
                    </button>
                </div>
            `;
            return;
        }

        this.renderWizardSteps(databaseOptions);
    }

    renderWizardSteps(databaseOptions) {
        const container = document.getElementById('invoice-copy-content');

        const html = `
            <!-- Step 1: Select Source Database & Browse Invoices -->
            <div class="invoice-copy-step active" id="ic-step1">
                <div class="invoice-step-header">
                    <div class="invoice-step-number">1</div>
                    <h3 class="invoice-step-title">Select Source Invoice</h3>
                </div>
                <div class="row mb-3">
                    <div class="col-md-4">
                        <label for="icSourceDb" class="form-label">Source Database</label>
                        <select class="form-select" id="icSourceDb" required>
                            <option value="">Select source database...</option>
                            ${databaseOptions.map(db => `
                                <option value="${db.id}">${db.name} (${db.server}/${db.database})</option>
                            `).join('')}
                        </select>
                    </div>
                    <div class="col-md-4">
                        <label for="icInvoiceSearch" class="form-label">Search by Invoice Number</label>
                        <div class="input-group">
                            <input type="text" class="form-control" id="icInvoiceSearch" placeholder="Enter invoice number..." autocomplete="off">
                            <button class="btn btn-outline-secondary" type="button" id="icSearchBtn">
                                <i class="fas fa-search"></i>
                            </button>
                        </div>
                    </div>
                    <div class="col-md-4 d-flex align-items-end">
                        <button class="btn btn-secondary" type="button" id="icClearSearchBtn">
                            <i class="fas fa-times me-1"></i>Clear
                        </button>
                    </div>
                </div>
                <div id="icInvoicesTable">
                    <p class="text-muted">Select a source database to browse invoices.</p>
                </div>
            </div>

            <!-- Step 2: Review Source Invoice -->
            <div class="invoice-copy-step" id="ic-step2">
                <div class="invoice-step-header">
                    <div class="invoice-step-number">2</div>
                    <h3 class="invoice-step-title">Review Source Invoice</h3>
                </div>
                <div id="icSourceInvoiceDetail">
                </div>
            </div>

            <!-- Step 3: Select Destination Database & Customer -->
            <div class="invoice-copy-step" id="ic-step3">
                <div class="invoice-step-header">
                    <div class="invoice-step-number">3</div>
                    <h3 class="invoice-step-title">Select Destination Database & Customer</h3>
                </div>
                <div class="row">
                    <div class="col-md-4">
                        <label for="icDestDb" class="form-label">Destination Database</label>
                        <select class="form-select" id="icDestDb" required>
                            <option value="">Select destination database...</option>
                        </select>
                    </div>
                    <div class="col-md-4">
                        <label for="icCustomerSearch" class="form-label">Search Customer by Account Number</label>
                        <div class="input-group">
                            <input type="text" class="form-control" id="icCustomerSearch" placeholder="Enter account number..." autocomplete="off">
                            <button class="btn btn-outline-secondary" type="button" id="icSearchCustomerBtn">
                                <i class="fas fa-search"></i>
                            </button>
                        </div>
                        <div id="icCustomerResults" class="customer-results mt-2" style="display: none;"></div>
                    </div>
                    <div class="col-md-4">
                        <div id="icSelectedCustomerInfo" class="selected-customer-info mt-4" style="display: none;">
                            <div class="card">
                                <div class="card-body">
                                    <h6 class="card-title">Selected Customer</h6>
                                    <p class="card-text" id="icCustomerDisplayInfo"></p>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Step 4: UPC Matching & Preview -->
            <div class="invoice-copy-step" id="ic-step4">
                <div class="invoice-step-header">
                    <div class="invoice-step-number">4</div>
                    <h3 class="invoice-step-title">UPC Matching & Preview</h3>
                </div>
                <div id="icPreviewContainer">
                </div>
            </div>

            <!-- Step 5: Confirm & Create -->
            <div class="invoice-copy-step" id="ic-step5">
                <div class="invoice-step-header">
                    <div class="invoice-step-number">5</div>
                    <h3 class="invoice-step-title">Confirm & Create Invoice</h3>
                </div>
                <div id="icConfirmContainer">
                </div>
            </div>
        `;

        container.innerHTML = html;
        this.setupWizardEventListeners();
    }

    setupWizardEventListeners() {
        const sourceDb = document.getElementById('icSourceDb');
        if (sourceDb) {
            sourceDb.addEventListener('change', (e) => {
                this.sourceConfigId = e.target.value;
                this.selectedInvoice = null;
                this.currentPage = 1;
                this.searchTerm = '';
                const searchInput = document.getElementById('icInvoiceSearch');
                if (searchInput) searchInput.value = '';
                this.deactivateStep(2);
                this.deactivateStep(3);
                this.deactivateStep(4);
                this.deactivateStep(5);
                if (this.sourceConfigId) {
                    this.loadInvoices();
                } else {
                    document.getElementById('icInvoicesTable').innerHTML =
                        '<p class="text-muted">Select a source database to browse invoices.</p>';
                }
            });
        }

        const searchBtn = document.getElementById('icSearchBtn');
        const searchInput = document.getElementById('icInvoiceSearch');
        if (searchBtn) {
            searchBtn.addEventListener('click', () => {
                this.searchTerm = (document.getElementById('icInvoiceSearch').value || '').trim();
                this.currentPage = 1;
                this.loadInvoices();
            });
        }
        if (searchInput) {
            searchInput.addEventListener('keyup', (e) => {
                if (e.key === 'Enter') {
                    this.searchTerm = searchInput.value.trim();
                    this.currentPage = 1;
                    this.loadInvoices();
                }
            });
        }

        const clearBtn = document.getElementById('icClearSearchBtn');
        if (clearBtn) {
            clearBtn.addEventListener('click', () => {
                const input = document.getElementById('icInvoiceSearch');
                if (input) input.value = '';
                this.searchTerm = '';
                this.currentPage = 1;
                this.loadInvoices();
            });
        }

        const destDb = document.getElementById('icDestDb');
        if (destDb) {
            destDb.addEventListener('change', (e) => {
                this.destConfigId = e.target.value;
                this.selectedCustomer = null;
                this.deactivateStep(4);
                this.deactivateStep(5);
                const custInfo = document.getElementById('icSelectedCustomerInfo');
                if (custInfo) custInfo.style.display = 'none';
                const custResults = document.getElementById('icCustomerResults');
                if (custResults) custResults.style.display = 'none';
                const custSearch = document.getElementById('icCustomerSearch');
                if (custSearch) custSearch.value = '';
            });
        }

        const custSearchBtn = document.getElementById('icSearchCustomerBtn');
        const custSearchInput = document.getElementById('icCustomerSearch');
        if (custSearchBtn) {
            custSearchBtn.addEventListener('click', () => this.searchCustomers());
        }
        if (custSearchInput) {
            custSearchInput.addEventListener('keyup', (e) => {
                if (e.key === 'Enter') this.searchCustomers();
            });
        }
    }

    async loadInvoices() {
        if (!this.sourceConfigId) return;

        const tableContainer = document.getElementById('icInvoicesTable');
        tableContainer.innerHTML = '<p class="text-muted">Loading invoices...</p>';

        try {
            const response = await api.getInvoicesList(
                this.sourceConfigId, this.currentPage, 25, this.searchTerm
            );

            if (!response.invoices || response.invoices.length === 0) {
                tableContainer.innerHTML = '<p class="text-muted">No invoices found.</p>';
                return;
            }

            this.renderInvoicesTable(response.invoices, response.pagination);
        } catch (error) {
            tableContainer.innerHTML = `<div class="alert alert-danger">Failed to load invoices: ${error.message}</div>`;
        }
    }

    renderInvoicesTable(invoices, pagination) {
        const tableContainer = document.getElementById('icInvoicesTable');

        let html = `
            <div class="table-responsive">
                <table class="table table-striped invoice-browse-table">
                    <thead>
                        <tr>
                            <th>Invoice #</th>
                            <th>Date</th>
                            <th>Customer</th>
                            <th>Account #</th>
                            <th>Total</th>
                            <th>Lines</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${invoices.map(inv => `
                            <tr class="invoice-browse-row" data-invoice-id="${inv.InvoiceID}">
                                <td><strong>${inv.InvoiceNumber || ''}</strong></td>
                                <td>${inv.InvoiceDate ? inv.InvoiceDate.split(' ')[0] : ''}</td>
                                <td>${inv.BusinessName || ''}</td>
                                <td>${inv.AccountNo || ''}</td>
                                <td>$${(inv.InvoiceTotal || 0).toFixed(2)}</td>
                                <td>${inv.NoLines || 0}</td>
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
                        Showing page ${pagination.page} of ${pagination.total_pages} (${pagination.total} invoices)
                    </span>
                    <div>
                        <button class="btn btn-sm btn-outline-secondary me-1" id="icPrevPage" ${!pagination.has_prev ? 'disabled' : ''}>
                            <i class="fas fa-chevron-left"></i> Prev
                        </button>
                        <button class="btn btn-sm btn-outline-secondary" id="icNextPage" ${!pagination.has_next ? 'disabled' : ''}>
                            Next <i class="fas fa-chevron-right"></i>
                        </button>
                    </div>
                </div>
            `;
        }

        tableContainer.innerHTML = html;

        tableContainer.querySelectorAll('.invoice-browse-row').forEach(row => {
            row.addEventListener('click', () => {
                const invoiceId = row.dataset.invoiceId;
                this.selectSourceInvoice(parseInt(invoiceId));
            });
        });

        const prevBtn = document.getElementById('icPrevPage');
        const nextBtn = document.getElementById('icNextPage');
        if (prevBtn) {
            prevBtn.addEventListener('click', () => {
                this.currentPage--;
                this.loadInvoices();
            });
        }
        if (nextBtn) {
            nextBtn.addEventListener('click', () => {
                this.currentPage++;
                this.loadInvoices();
            });
        }
    }

    async selectSourceInvoice(invoiceId) {
        if (!this.sourceConfigId) return;

        try {
            authManager.showLoading(true);
            const response = await api.getInvoiceDetail(this.sourceConfigId, invoiceId);

            this.selectedInvoice = {
                invoice: response.invoice,
                details: response.details
            };

            this.renderSourceInvoiceDetail(response.invoice, response.details);
            this.activateStep(2);

            this.populateDestDbDropdown();
            this.activateStep(3);

            this.deactivateStep(4);
            this.deactivateStep(5);
            this.selectedCustomer = null;
            this.destConfigId = null;
            const destDb = document.getElementById('icDestDb');
            if (destDb) destDb.value = '';
            const custInfo = document.getElementById('icSelectedCustomerInfo');
            if (custInfo) custInfo.style.display = 'none';

            tableContainer: {
                const rows = document.querySelectorAll('.invoice-browse-row');
                rows.forEach(r => r.classList.remove('selected'));
                const selected = document.querySelector(`.invoice-browse-row[data-invoice-id="${invoiceId}"]`);
                if (selected) selected.classList.add('selected');
            }

        } catch (error) {
            authManager.showAlert('Failed to load invoice details: ' + error.message, 'danger');
        } finally {
            authManager.showLoading(false);
        }
    }

    renderSourceInvoiceDetail(invoice, details) {
        const container = document.getElementById('icSourceInvoiceDetail');

        let html = `
            <div class="invoice-preview">
                <div class="invoice-header">
                    <div class="row">
                        <div class="col-md-4">
                            <h5>Source Invoice #${invoice.InvoiceNumber || ''}</h5>
                            <p class="mb-1"><strong>Date:</strong> ${invoice.InvoiceDate ? invoice.InvoiceDate.split(' ')[0] : 'N/A'}</p>
                            <p class="mb-1"><strong>Type:</strong> ${invoice.InvoiceType || 'N/A'}</p>
                            <p class="mb-0"><strong>Lines:</strong> ${details.length}</p>
                        </div>
                        <div class="col-md-4">
                            <h6 class="text-primary mb-2">Customer</h6>
                            <p class="mb-1"><strong>${invoice.BusinessName || 'N/A'}</strong></p>
                            <p class="mb-1">Account: ${invoice.AccountNo || 'N/A'}</p>
                        </div>
                        <div class="col-md-4">
                            <h6 class="text-primary mb-2">Totals</h6>
                            <p class="mb-1"><strong>Subtotal:</strong> $${(invoice.InvoiceSubtotal || 0).toFixed(2)}</p>
                            <p class="mb-1"><strong>Total:</strong> $${(invoice.InvoiceTotal || 0).toFixed(2)}</p>
                        </div>
                    </div>
                </div>

                <div class="table-responsive">
                    <table class="table table-striped invoice-table">
                        <thead>
                            <tr>
                                <th>UPC</th>
                                <th>Description</th>
                                <th>Size</th>
                                <th>Unit Cost</th>
                                <th>Unit Price</th>
                                <th>Qty Ordered</th>
                                <th>Ext Cost</th>
                                <th>Ext Price</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${details.map(d => `
                                <tr>
                                    <td>${d.ProductUPC || ''}</td>
                                    <td>${d.ProductDescription || ''}</td>
                                    <td>${d.ItemSize || ''}</td>
                                    <td>$${(d.UnitCost || 0).toFixed(2)}</td>
                                    <td>$${(d.UnitPrice || 0).toFixed(2)}</td>
                                    <td>${d.QtyOrdered || 0}</td>
                                    <td>$${(d.ExtendedCost || 0).toFixed(2)}</td>
                                    <td>$${(d.ExtendedPrice || 0).toFixed(2)}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>

                <div class="text-center mt-3">
                    <button type="button" class="btn btn-primary" onclick="invoiceCopyManager.scrollToStep(3)">
                        <i class="fas fa-arrow-down me-2"></i>Continue to Destination
                    </button>
                </div>
            </div>
        `;

        container.innerHTML = html;
    }

    populateDestDbDropdown() {
        const destDb = document.getElementById('icDestDb');
        if (!destDb) return;

        const databaseOptions = databaseManager.getDatabaseOptions();

        let html = '<option value="">Select destination database...</option>';
        databaseOptions.forEach(db => {
            if (String(db.id) !== String(this.sourceConfigId)) {
                html += `<option value="${db.id}">${db.name} (${db.server}/${db.database})</option>`;
            }
        });

        destDb.innerHTML = html;
    }

    async searchCustomers() {
        const searchInput = document.getElementById('icCustomerSearch');
        const searchTerm = searchInput ? searchInput.value.trim() : '';

        if (!searchTerm) {
            authManager.showAlert('Please enter a search term', 'warning');
            return;
        }

        if (!this.destConfigId) {
            authManager.showAlert('Please select a destination database first', 'warning');
            return;
        }

        try {
            authManager.showLoading(true);
            const response = await api.searchCustomers({
                database_config_id: this.destConfigId,
                search_term: searchTerm
            });

            this.renderCustomerResults(response.customers);
        } catch (error) {
            authManager.showAlert('Failed to search customers: ' + error.message, 'danger');
        } finally {
            authManager.showLoading(false);
        }
    }

    renderCustomerResults(customers) {
        const resultsContainer = document.getElementById('icCustomerResults');

        if (!customers || customers.length === 0) {
            resultsContainer.innerHTML = `
                <div class="alert alert-info">
                    <i class="fas fa-info-circle me-2"></i>No customers found
                </div>
            `;
            resultsContainer.style.display = 'block';
            return;
        }

        const html = `
            <div class="list-group">
                ${customers.map(customer => `
                    <a href="#" class="list-group-item list-group-item-action ic-customer-item"
                       data-customer-id="${customer.CustomerID}"
                       data-account-no="${customer.AccountNo}"
                       data-business-name="${customer.BusinessName || ''}"
                       data-city="${customer.City || ''}"
                       data-state="${customer.State || ''}"
                       data-phone="${customer.Phone_Number || ''}">
                        <div class="d-flex w-100 justify-content-between">
                            <h6 class="mb-1">${customer.BusinessName || 'No Business Name'}</h6>
                            <small>${customer.AccountNo}</small>
                        </div>
                        <p class="mb-1">${customer.Address1 || ''} ${customer.City || ''}, ${customer.State || ''}</p>
                        <small>Contact: ${customer.Contactname || 'N/A'} | Phone: ${customer.Phone_Number || 'N/A'}</small>
                    </a>
                `).join('')}
            </div>
        `;

        resultsContainer.innerHTML = html;
        resultsContainer.style.display = 'block';

        resultsContainer.querySelectorAll('.ic-customer-item').forEach(item => {
            item.addEventListener('click', (e) => {
                e.preventDefault();
                this.selectCustomer({
                    CustomerID: parseInt(item.dataset.customerId),
                    AccountNo: item.dataset.accountNo,
                    BusinessName: item.dataset.businessName,
                    City: item.dataset.city,
                    State: item.dataset.state,
                    Phone_Number: item.dataset.phone
                });
            });
        });
    }

    selectCustomer(customer) {
        this.selectedCustomer = customer;

        const customerInfo = document.getElementById('icSelectedCustomerInfo');
        const customerDisplay = document.getElementById('icCustomerDisplayInfo');

        if (customerInfo && customerDisplay) {
            customerDisplay.innerHTML = `
                <strong>${customer.BusinessName || 'No Business Name'}</strong><br>
                Account: ${customer.AccountNo}<br>
                ${customer.City ? `${customer.City}, ${customer.State}` : ''}<br>
                ${customer.Phone_Number ? `Phone: ${customer.Phone_Number}` : ''}
            `;
            customerInfo.style.display = 'block';
        }

        const resultsContainer = document.getElementById('icCustomerResults');
        if (resultsContainer) resultsContainer.style.display = 'none';

        const searchInput = document.getElementById('icCustomerSearch');
        if (searchInput) searchInput.value = customer.AccountNo;

        this.prepareCopyPreview();
    }

    async prepareCopyPreview() {
        if (!this.sourceConfigId || !this.selectedInvoice || !this.destConfigId || !this.selectedCustomer) {
            return;
        }

        try {
            authManager.showLoading(true);

            const response = await api.prepareInvoiceCopy({
                source_config_id: this.sourceConfigId,
                source_invoice_id: this.selectedInvoice.invoice.InvoiceID,
                dest_config_id: this.destConfigId,
                customer_id: this.selectedCustomer.CustomerID
            });

            if (!response.success) {
                authManager.showAlert(response.error || 'Failed to prepare invoice copy', 'danger');
                if (response.missing_upcs && response.missing_upcs.length > 0) {
                    this.renderMissingUpcsOnly(response.missing_upcs);
                    this.activateStep(4);
                }
                return;
            }

            this.currentPreview = response.preview;
            this.renderCopyPreview(response.preview, response.missing_upcs);
            this.activateStep(4);

            this.renderConfirmation(response.preview);
            this.activateStep(5);

        } catch (error) {
            authManager.showAlert('Failed to prepare invoice copy: ' + error.message, 'danger');
        } finally {
            authManager.showLoading(false);
        }
    }

    renderMissingUpcsOnly(missingUpcs) {
        const container = document.getElementById('icPreviewContainer');
        container.innerHTML = `
            <div class="alert alert-danger">
                <h6><i class="fas fa-exclamation-triangle me-2"></i>All UPCs Missing</h6>
                <p>None of the source invoice items were found in the destination database.</p>
            </div>
            <div class="missing-upcs">
                <h6><i class="fas fa-exclamation-triangle me-2"></i>Missing UPCs (${missingUpcs.length})</h6>
                ${missingUpcs.map(upc => `
                    <div class="missing-upc-item">
                        <strong>UPC ${upc.upc}:</strong> ${upc.description || 'N/A'} (Price: $${(upc.unit_price || 0).toFixed(2)}, QTY: ${upc.qty || 0})
                    </div>
                `).join('')}
            </div>
        `;
    }

    renderCopyPreview(preview, missingUpcs) {
        const container = document.getElementById('icPreviewContainer');

        let html = '';

        if (missingUpcs && missingUpcs.length > 0) {
            html += `
                <div class="missing-upcs mb-4">
                    <h6><i class="fas fa-exclamation-triangle me-2"></i>Missing UPCs (${missingUpcs.length})</h6>
                    <p class="mb-2">The following UPCs were not found in the destination database:</p>
                    ${missingUpcs.map(upc => `
                        <div class="missing-upc-item">
                            <strong>UPC ${upc.upc}:</strong> ${upc.description || 'N/A'} (Price: $${(upc.unit_price || 0).toFixed(2)}, QTY: ${upc.qty || 0})
                        </div>
                    `).join('')}
                    <p class="mt-2 mb-0">
                        <small class="text-muted">
                            These items will be excluded from the copied invoice.
                        </small>
                    </p>
                </div>
            `;
        }

        html += `
            <div class="invoice-preview">
                <div class="invoice-header">
                    <div class="row">
                        <div class="col-md-4">
                            <h5>New Invoice #${preview.invoice_number}</h5>
                            <p class="mb-1"><strong>Date:</strong> ${preview.invoice_date}</p>
                            <p class="mb-1"><strong>Title:</strong> ${preview.invoice_title}</p>
                            <p class="mb-0"><strong>Items:</strong> ${preview.summary.total_items}</p>
                        </div>
                        <div class="col-md-4">
                            <h6 class="text-primary mb-2">Customer Information</h6>
                            <p class="mb-1"><strong>${preview.business_name || 'N/A'}</strong></p>
                            <p class="mb-1">Account: ${preview.account_no || 'N/A'}</p>
                            ${preview.ship_city ? `<p class="mb-1">${preview.ship_city}, ${preview.ship_state}</p>` : ''}
                        </div>
                        <div class="col-md-4">
                            <h6 class="text-primary mb-2">Shipping Address</h6>
                            ${preview.ship_to ? `<p class="mb-1"><strong>${preview.ship_to}</strong></p>` : ''}
                            ${preview.ship_address1 ? `<p class="mb-1">${preview.ship_address1}</p>` : ''}
                            ${preview.ship_city ? `<p class="mb-0">${preview.ship_city}, ${preview.ship_state} ${preview.ship_zipcode || ''}</p>` : ''}
                        </div>
                    </div>
                </div>

                <div class="table-responsive">
                    <table class="table table-striped invoice-table">
                        <thead>
                            <tr>
                                <th>UPC</th>
                                <th>Description</th>
                                <th>Size</th>
                                <th>Unit Cost</th>
                                <th>Unit Price</th>
                                <th>Qty Ordered</th>
                                <th>Ext Cost</th>
                                <th>Ext Price</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${preview.lines.map(line => `
                                <tr>
                                    <td>${line.ProductUPC}</td>
                                    <td>${line.ProductDescription || 'N/A'}</td>
                                    <td>${line.ItemSize || 'N/A'}</td>
                                    <td>$${(line.UnitCost || 0).toFixed(2)}</td>
                                    <td>$${(line.UnitPrice || 0).toFixed(2)}</td>
                                    <td>${line.QtyOrdered || 0}</td>
                                    <td>$${(line.ExtendedCost || 0).toFixed(2)}</td>
                                    <td>$${(line.ExtendedPrice || 0).toFixed(2)}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>

                <div class="invoice-summary">
                    <div class="row">
                        <div class="col-md-8"></div>
                        <div class="col-md-4">
                            <table class="table table-sm">
                                <tr>
                                    <td><strong>Total Qty Ordered:</strong></td>
                                    <td class="text-end">${preview.summary.total_quantity_ordered}</td>
                                </tr>
                                <tr>
                                    <td><strong>Total Qty Shipped:</strong></td>
                                    <td class="text-end">${preview.summary.total_quantity_shipped}</td>
                                </tr>
                                <tr>
                                    <td><strong>Total Weight:</strong></td>
                                    <td class="text-end">${preview.summary.total_weight.toFixed(2)} lbs</td>
                                </tr>
                                <tr>
                                    <td><strong>Total Cost:</strong></td>
                                    <td class="text-end">$${preview.summary.total_cost.toFixed(2)}</td>
                                </tr>
                                <tr>
                                    <td><strong>Subtotal:</strong></td>
                                    <td class="text-end">$${preview.summary.total_price.toFixed(2)}</td>
                                </tr>
                                <tr>
                                    <td><strong>Taxes:</strong></td>
                                    <td class="text-end">$${preview.summary.total_taxes.toFixed(2)}</td>
                                </tr>
                                <tr class="invoice-total">
                                    <td><strong>Total:</strong></td>
                                    <td class="text-end">$${preview.summary.final_total.toFixed(2)}</td>
                                </tr>
                            </table>
                        </div>
                    </div>
                </div>
            </div>
        `;

        container.innerHTML = html;
    }

    renderConfirmation(preview) {
        const container = document.getElementById('icConfirmContainer');

        container.innerHTML = `
            <div class="text-center py-3">
                <p class="mb-3">
                    Ready to create <strong>Invoice #${preview.invoice_number}</strong>
                    with <strong>${preview.summary.total_items} items</strong>
                    totaling <strong>$${preview.summary.final_total.toFixed(2)}</strong>
                    in the destination database.
                </p>
                <button type="button" class="btn btn-success btn-lg" onclick="invoiceCopyManager.createInvoice()">
                    <i class="fas fa-check me-2"></i>Create Invoice
                </button>
                <button type="button" class="btn btn-secondary btn-lg ms-2" onclick="invoiceCopyManager.resetWorkflow()">
                    <i class="fas fa-undo me-2"></i>Start Over
                </button>
            </div>
        `;
    }

    async createInvoice() {
        if (!this.currentPreview || !this.destConfigId) {
            authManager.showAlert('No invoice data available', 'danger');
            return;
        }

        const confirmation = confirm(`Are you sure you want to create invoice #${this.currentPreview.invoice_number}?`);
        if (!confirmation) return;

        try {
            authManager.showLoading(true);

            const invoiceData = {
                dest_config_id: this.destConfigId,
                invoice_data: {
                    invoice_number: this.currentPreview.invoice_number,
                    invoice_date: this.currentPreview.invoice_date,
                    invoice_type: this.currentPreview.invoice_type,
                    invoice_title: this.currentPreview.invoice_title,
                    customer_id: this.currentPreview.customer_id,
                    business_name: this.currentPreview.business_name,
                    account_no: this.currentPreview.account_no,
                    ship_to: this.currentPreview.ship_to,
                    ship_address1: this.currentPreview.ship_address1,
                    ship_address2: this.currentPreview.ship_address2,
                    ship_city: this.currentPreview.ship_city,
                    ship_state: this.currentPreview.ship_state,
                    ship_zipcode: this.currentPreview.ship_zipcode,
                    ship_phone: this.currentPreview.ship_phone,
                    term_id: this.currentPreview.term_id,
                    sales_rep_id: this.currentPreview.sales_rep_id,
                    total_qty_ordered: this.currentPreview.total_qty_ordered,
                    total_qty_shipped: this.currentPreview.total_qty_shipped,
                    no_lines: this.currentPreview.no_lines,
                    total_weight: this.currentPreview.total_weight,
                    invoice_subtotal: this.currentPreview.invoice_subtotal,
                    total_taxes: this.currentPreview.total_taxes,
                    invoice_total: this.currentPreview.invoice_total
                },
                invoice_details: this.currentPreview.lines
            };

            const response = await api.createCopiedInvoice(invoiceData);

            authManager.showAlert(`Invoice #${response.invoice_number} created successfully!`, 'success');
            this.resetWorkflow();

        } catch (error) {
            authManager.showAlert('Failed to create invoice: ' + error.message, 'danger');
        } finally {
            authManager.showLoading(false);
        }
    }

    resetWorkflow() {
        this.sourceConfigId = null;
        this.destConfigId = null;
        this.selectedInvoice = null;
        this.selectedCustomer = null;
        this.currentPreview = null;
        this.currentPage = 1;
        this.searchTerm = '';

        this.initializeCopyWizard();
    }

    activateStep(stepNumber) {
        const step = document.getElementById(`ic-step${stepNumber}`);
        if (step) step.classList.add('active');
    }

    deactivateStep(stepNumber) {
        const step = document.getElementById(`ic-step${stepNumber}`);
        if (step) step.classList.remove('active');
    }

    scrollToStep(stepNumber) {
        const step = document.getElementById(`ic-step${stepNumber}`);
        if (step) step.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}

const invoiceCopyManager = new InvoiceCopyManager();
