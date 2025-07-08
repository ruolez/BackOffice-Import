// Invoice management module

class InvoiceManager {
    constructor() {
        this.currentPreview = null;
        this.selectedDatabaseId = null;
        this.selectedCustomer = null;
        this.uploadedFile = null;
        this.init();
    }

    init() {
        this.setupEventListeners();
    }

    setupEventListeners() {
        // Tab switch listener
        const invoiceTab = document.getElementById('invoice-tab');
        if (invoiceTab) {
            invoiceTab.addEventListener('shown.bs.tab', () => {
                this.initializeInvoiceCreation();
            });
        }
    }

    initializeInvoiceCreation() {
        const container = document.getElementById('invoice-creation-content');
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

        this.renderInvoiceCreationSteps(databaseOptions);
    }

    renderInvoiceCreationSteps(databaseOptions) {
        const container = document.getElementById('invoice-creation-content');
        
        const html = `
            <!-- Step 1: Select Database -->
            <div class="invoice-step active" id="step1">
                <div class="invoice-step-header">
                    <div class="invoice-step-number">1</div>
                    <h3 class="invoice-step-title">Select Database</h3>
                </div>
                <div class="row">
                    <div class="col-md-6">
                        <label for="databaseSelect" class="form-label">Choose Database Configuration</label>
                        <select class="form-select" id="databaseSelect" required>
                            <option value="">Select a database...</option>
                            ${databaseOptions.map(db => `
                                <option value="${db.id}">${db.name} (${db.server}/${db.database})</option>
                            `).join('')}
                        </select>
                    </div>
                    <div class="col-md-6">
                        <label for="nextInvoiceNumber" class="form-label">Next Invoice Number</label>
                        <input type="text" class="form-control" id="nextInvoiceNumber" readonly placeholder="Select database first">
                    </div>
                </div>
            </div>

            <!-- Step 2: Select Customer -->
            <div class="invoice-step" id="step2">
                <div class="invoice-step-header">
                    <div class="invoice-step-number">2</div>
                    <h3 class="invoice-step-title">Select Customer</h3>
                </div>
                <div class="row">
                    <div class="col-md-8">
                        <label for="customerSearch" class="form-label">Search Customer by Account Number</label>
                        <div class="input-group">
                            <input type="text" class="form-control" id="customerSearch" placeholder="Enter account number..." autocomplete="off">
                            <button class="btn btn-outline-secondary" type="button" id="searchCustomerBtn">
                                <i class="fas fa-search"></i>
                            </button>
                        </div>
                        <div id="customerResults" class="customer-results mt-2" style="display: none;"></div>
                    </div>
                    <div class="col-md-4">
                        <div id="selectedCustomerInfo" class="selected-customer-info mt-4" style="display: none;">
                            <div class="card">
                                <div class="card-body">
                                    <h6 class="card-title">Selected Customer</h6>
                                    <p class="card-text" id="customerDisplayInfo"></p>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Step 3: Upload Excel File -->
            <div class="invoice-step" id="step3">
                <div class="invoice-step-header">
                    <div class="invoice-step-number">3</div>
                    <h3 class="invoice-step-title">Upload Excel File</h3>
                </div>
                <div class="file-upload-area" id="fileUploadArea">
                    <div class="file-upload-icon">
                        <i class="fas fa-cloud-upload-alt"></i>
                    </div>
                    <h5>Drop Excel file here or click to browse</h5>
                    <p class="text-muted">Supported formats: .xlsx, .xls<br>Required columns: UPC, Cost, QTY</p>
                    <input type="file" id="fileInput" accept=".xlsx,.xls" class="d-none">
                    <button type="button" class="btn btn-outline-primary" id="browseButton">
                        <i class="fas fa-folder-open me-2"></i>Browse Files
                    </button>
                </div>
                <div id="fileInfo" class="mt-3 d-none">
                    <div class="alert alert-info">
                        <i class="fas fa-file-excel me-2"></i>
                        <strong>Selected file:</strong> <span id="fileName"></span>
                    </div>
                    <button type="button" class="btn btn-primary" id="processFileBtn">
                        <i class="fas fa-cogs me-2"></i>Process File
                    </button>
                </div>
            </div>

            <!-- Step 4: Review & Create Invoice -->
            <div class="invoice-step" id="step4">
                <div class="invoice-step-header">
                    <div class="invoice-step-number">4</div>
                    <h3 class="invoice-step-title">Review & Create Invoice</h3>
                </div>
                <div id="invoicePreviewContainer">
                    <!-- Invoice preview will be populated here -->
                </div>
            </div>
        `;

        container.innerHTML = html;
        this.setupInvoiceEventListeners();
    }

    setupInvoiceEventListeners() {
        // Database selection
        const databaseSelect = document.getElementById('databaseSelect');
        if (databaseSelect) {
            databaseSelect.addEventListener('change', (e) => {
                this.selectedDatabaseId = e.target.value;
                if (this.selectedDatabaseId) {
                    this.loadNextInvoiceNumber();
                    this.activateStep(2);
                } else {
                    this.deactivateStep(2);
                    this.deactivateStep(3);
                    this.deactivateStep(4);
                }
            });
        }

        // Customer search
        const customerSearch = document.getElementById('customerSearch');
        const searchCustomerBtn = document.getElementById('searchCustomerBtn');
        
        if (customerSearch) {
            customerSearch.addEventListener('keyup', (e) => {
                if (e.key === 'Enter') {
                    this.searchCustomers();
                }
            });
        }
        
        if (searchCustomerBtn) {
            searchCustomerBtn.addEventListener('click', () => {
                this.searchCustomers();
            });
        }

        // File upload
        const fileInput = document.getElementById('fileInput');
        const fileUploadArea = document.getElementById('fileUploadArea');
        const browseButton = document.getElementById('browseButton');
        const processFileBtn = document.getElementById('processFileBtn');

        if (fileInput) {
            fileInput.addEventListener('change', (e) => {
                this.handleFileSelection(e.target.files[0]);
            });
        }

        if (browseButton) {
            browseButton.addEventListener('click', (e) => {
                e.stopPropagation();
                if (!this.selectedDatabaseId) {
                    authManager.showAlert('Please select a database first', 'warning');
                    return;
                }
                if (!this.selectedCustomer) {
                    authManager.showAlert('Please select a customer first', 'warning');
                    return;
                }
                fileInput.click();
            });
        }

        if (fileUploadArea) {
            fileUploadArea.addEventListener('click', (e) => {
                // Only trigger if not clicking on the browse button
                if (!e.target.closest('#browseButton')) {
                    if (!this.selectedDatabaseId) {
                        authManager.showAlert('Please select a database first', 'warning');
                        return;
                    }
                    if (!this.selectedCustomer) {
                        authManager.showAlert('Please select a customer first', 'warning');
                        return;
                    }
                    fileInput.click();
                }
            });

            // Drag and drop
            fileUploadArea.addEventListener('dragover', (e) => {
                e.preventDefault();
                fileUploadArea.classList.add('drag-over');
            });

            fileUploadArea.addEventListener('dragleave', () => {
                fileUploadArea.classList.remove('drag-over');
            });

            fileUploadArea.addEventListener('drop', (e) => {
                e.preventDefault();
                fileUploadArea.classList.remove('drag-over');
                
                if (!this.selectedDatabaseId) {
                    authManager.showAlert('Please select a database first', 'warning');
                    return;
                }
                
                if (!this.selectedCustomer) {
                    authManager.showAlert('Please select a customer first', 'warning');
                    return;
                }

                const files = e.dataTransfer.files;
                if (files.length > 0) {
                    this.handleFileSelection(files[0]);
                }
            });
        }

        if (processFileBtn) {
            processFileBtn.addEventListener('click', () => {
                this.processExcelFile();
            });
        }
    }

    async loadNextInvoiceNumber() {
        if (!this.selectedDatabaseId) return;

        try {
            const response = await api.getNextInvoiceNumber(this.selectedDatabaseId);
            const input = document.getElementById('nextInvoiceNumber');
            if (input) {
                input.value = response.next_number;
            }
        } catch (error) {
            authManager.showAlert('Failed to get next invoice number: ' + error.message, 'danger');
        }
    }

    async searchCustomers() {
        const searchInput = document.getElementById('customerSearch');
        const searchTerm = searchInput.value.trim();
        
        if (!searchTerm) {
            authManager.showAlert('Please enter a search term', 'warning');
            return;
        }
        
        if (!this.selectedDatabaseId) {
            authManager.showAlert('Please select a database first', 'warning');
            return;
        }

        try {
            authManager.showLoading(true);
            const response = await api.searchCustomers({
                database_config_id: this.selectedDatabaseId,
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
        const resultsContainer = document.getElementById('customerResults');
        
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
                    <a href="#" class="list-group-item list-group-item-action customer-item" 
                       data-customer-id="${customer.CustomerID}"
                       data-account-no="${customer.AccountNo}"
                       data-business-name="${customer.BusinessName || ''}"
                       data-location="${customer.Location_Number || ''}"
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

        // Add click event listeners to customer items
        const customerItems = resultsContainer.querySelectorAll('.customer-item');
        customerItems.forEach(item => {
            item.addEventListener('click', (e) => {
                e.preventDefault();
                this.selectCustomer({
                    CustomerID: parseInt(item.dataset.customerId),
                    AccountNo: item.dataset.accountNo,
                    BusinessName: item.dataset.businessName,
                    Location_Number: item.dataset.location,
                    City: item.dataset.city,
                    State: item.dataset.state,
                    Phone_Number: item.dataset.phone
                });
            });
        });
    }

    selectCustomer(customer) {
        this.selectedCustomer = customer;
        
        // Update UI to show selected customer
        const customerInfo = document.getElementById('selectedCustomerInfo');
        const customerDisplay = document.getElementById('customerDisplayInfo');
        
        if (customerInfo && customerDisplay) {
            customerDisplay.innerHTML = `
                <strong>${customer.BusinessName || 'No Business Name'}</strong><br>
                Account: ${customer.AccountNo}<br>
                ${customer.City ? `${customer.City}, ${customer.State}` : ''}<br>
                ${customer.Phone_Number ? `Phone: ${customer.Phone_Number}` : ''}
            `;
            customerInfo.style.display = 'block';
        }
        
        // Hide search results
        const resultsContainer = document.getElementById('customerResults');
        if (resultsContainer) {
            resultsContainer.style.display = 'none';
        }
        
        // Clear search input
        const searchInput = document.getElementById('customerSearch');
        if (searchInput) {
            searchInput.value = customer.AccountNo;
        }
        
        // Activate next step
        this.activateStep(3);
        
        authManager.showAlert('Customer selected successfully', 'success');
    }

    handleFileSelection(file) {
        if (!file) return;

        const allowedTypes = [
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'application/vnd.ms-excel'
        ];

        if (!allowedTypes.includes(file.type)) {
            authManager.showAlert('Please select a valid Excel file (.xlsx or .xls)', 'danger');
            return;
        }

        this.uploadedFile = file;
        
        const fileInfo = document.getElementById('fileInfo');
        const fileName = document.getElementById('fileName');
        
        if (fileInfo && fileName) {
            fileName.textContent = file.name;
            fileInfo.classList.remove('d-none');
        }
    }

    async processExcelFile() {
        if (!this.uploadedFile || !this.selectedDatabaseId || !this.selectedCustomer) {
            authManager.showAlert('Please select database, customer, and file', 'warning');
            return;
        }

        const formData = new FormData();
        formData.append('file', this.uploadedFile);
        formData.append('database_config_id', this.selectedDatabaseId);
        formData.append('customer_id', this.selectedCustomer.CustomerID);

        try {
            authManager.showLoading(true);
            const response = await api.uploadExcel(formData);
            
            this.currentPreview = response.preview;
            this.renderInvoicePreview(response.preview, response.missing_upcs);
            this.activateStep(4);
            
            authManager.showAlert('Excel file processed successfully', 'success');
            
        } catch (error) {
            authManager.showAlert('Failed to process Excel file: ' + error.message, 'danger');
        } finally {
            authManager.showLoading(false);
        }
    }

    renderInvoicePreview(preview, missingUpcs) {
        const container = document.getElementById('invoicePreviewContainer');
        if (!container) return;

        let html = '';

        // Missing UPCs warning
        if (missingUpcs && missingUpcs.length > 0) {
            html += `
                <div class="missing-upcs mb-4">
                    <h6><i class="fas fa-exclamation-triangle me-2"></i>Missing UPCs (${missingUpcs.length})</h6>
                    <p class="mb-2">The following UPCs were not found in the database:</p>
                    ${missingUpcs.map(upc => `
                        <div class="missing-upc-item">
                            <strong>Row ${upc.row_number}:</strong> UPC ${upc.upc} (Cost: $${upc.cost}, QTY: ${upc.qty})
                        </div>
                    `).join('')}
                    <p class="mt-2 mb-0">
                        <small class="text-muted">
                            These items will be excluded from the invoice. 
                            ${missingUpcs.length > 0 ? 'You can still create the invoice with the remaining items.' : ''}
                        </small>
                    </p>
                </div>
            `;
        }

        // Invoice preview
        html += `
            <div class="invoice-preview">
                <div class="invoice-header">
                    <div class="row">
                        <div class="col-md-4">
                            <h4>Invoice Preview</h4>
                            <p class="text-muted">Invoice #${preview.invoice_number}</p>
                            <p class="mb-1"><strong>Date:</strong> ${preview.invoice_date}</p>
                            <p class="mb-1"><strong>Type:</strong> ${preview.invoice_type}</p>
                            <p class="mb-0"><strong>Items:</strong> ${preview.summary.total_items}</p>
                        </div>
                        <div class="col-md-4">
                            <h6 class="text-primary mb-2">Customer Information</h6>
                            <p class="mb-1"><strong>${preview.business_name || 'N/A'}</strong></p>
                            <p class="mb-1">Account: ${preview.account_no || 'N/A'}</p>
                            ${preview.ship_city ? `<p class="mb-1">${preview.ship_city}, ${preview.ship_state}</p>` : ''}
                            ${preview.ship_phone ? `<p class="mb-0">Phone: ${preview.ship_phone}</p>` : ''}
                        </div>
                        <div class="col-md-4">
                            <h6 class="text-primary mb-2">Shipping Address</h6>
                            ${preview.ship_to ? `<p class="mb-1"><strong>${preview.ship_to}</strong></p>` : ''}
                            ${preview.ship_address1 ? `<p class="mb-1">${preview.ship_address1}</p>` : ''}
                            ${preview.ship_address2 ? `<p class="mb-1">${preview.ship_address2}</p>` : ''}
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
                                <th>Quantity</th>
                                <th>Extended Cost</th>
                                <th>Extended Price</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${preview.lines.map(line => `
                                <tr>
                                    <td>${line.ProductUPC}</td>
                                    <td>${line.ProductDescription || 'N/A'}</td>
                                    <td>${line.ItemSize || 'N/A'}</td>
                                    <td>$${line.UnitCost.toFixed(2)}</td>
                                    <td>$${(line.UnitPrice || 0).toFixed(2)}</td>
                                    <td>${line.QtyOrdered}</td>
                                    <td>$${line.ExtendedCost.toFixed(2)}</td>
                                    <td>$${line.ExtendedPrice.toFixed(2)}</td>
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
                                    <td><strong>Total Quantity Ordered:</strong></td>
                                    <td class="text-end">${preview.summary.total_quantity_ordered}</td>
                                </tr>
                                <tr>
                                    <td><strong>Total Quantity Shipped:</strong></td>
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

                <div class="text-center mt-4">
                    <button type="button" class="btn btn-success btn-lg" onclick="invoiceManager.createInvoice()">
                        <i class="fas fa-check me-2"></i>Create Invoice
                    </button>
                    <button type="button" class="btn btn-secondary btn-lg ms-2" onclick="invoiceManager.resetWorkflow()">
                        <i class="fas fa-undo me-2"></i>Start Over
                    </button>
                </div>
            </div>
        `;

        container.innerHTML = html;
    }

    async createInvoice() {
        if (!this.currentPreview || !this.selectedDatabaseId) {
            authManager.showAlert('No invoice data available', 'danger');
            return;
        }

        const confirmation = confirm(`Are you sure you want to create invoice #${this.currentPreview.invoice_number}?`);
        if (!confirmation) return;

        try {
            authManager.showLoading(true);
            
            const invoiceData = {
                database_config_id: this.selectedDatabaseId,
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

            const response = await api.createInvoice(invoiceData);
            
            authManager.showAlert(`Invoice #${response.invoice_number} created successfully!`, 'success');
            this.resetWorkflow();
            
        } catch (error) {
            authManager.showAlert('Failed to create invoice: ' + error.message, 'danger');
        } finally {
            authManager.showLoading(false);
        }
    }

    resetWorkflow() {
        this.currentPreview = null;
        this.selectedDatabaseId = null;
        this.selectedCustomer = null;
        this.uploadedFile = null;
        
        // Reset form
        const databaseSelect = document.getElementById('databaseSelect');
        if (databaseSelect) {
            databaseSelect.value = '';
        }
        
        const customerSearch = document.getElementById('customerSearch');
        if (customerSearch) {
            customerSearch.value = '';
        }
        
        const customerResults = document.getElementById('customerResults');
        if (customerResults) {
            customerResults.style.display = 'none';
        }
        
        const selectedCustomerInfo = document.getElementById('selectedCustomerInfo');
        if (selectedCustomerInfo) {
            selectedCustomerInfo.style.display = 'none';
        }
        
        const fileInput = document.getElementById('fileInput');
        if (fileInput) {
            fileInput.value = '';
        }
        
        const fileInfo = document.getElementById('fileInfo');
        if (fileInfo) {
            fileInfo.classList.add('d-none');
        }
        
        const nextInvoiceNumber = document.getElementById('nextInvoiceNumber');
        if (nextInvoiceNumber) {
            nextInvoiceNumber.value = '';
        }
        
        // Reset steps
        this.activateStep(1);
        this.deactivateStep(2);
        this.deactivateStep(3);
        this.deactivateStep(4);
        
        // Clear preview
        const container = document.getElementById('invoicePreviewContainer');
        if (container) {
            container.innerHTML = '';
        }
    }

    activateStep(stepNumber) {
        const step = document.getElementById(`step${stepNumber}`);
        if (step) {
            step.classList.add('active');
        }
    }

    deactivateStep(stepNumber) {
        const step = document.getElementById(`step${stepNumber}`);
        if (step) {
            step.classList.remove('active');
        }
    }
}

// Global invoice manager instance
const invoiceManager = new InvoiceManager();