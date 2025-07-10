// Purchase Order management module

class PurchaseOrderManager {
    constructor() {
        this.currentPreview = null;
        this.selectedDatabaseId = null;
        this.selectedSupplier = null;
        this.uploadedFile = null;
        this.init();
    }

    init() {
        this.setupEventListeners();
    }

    setupEventListeners() {
        // Tab switch listener
        const purchaseOrderTab = document.getElementById('purchase-order-tab');
        if (purchaseOrderTab) {
            purchaseOrderTab.addEventListener('shown.bs.tab', () => {
                this.initializePurchaseOrderCreation();
            });
        }
    }

    initializePurchaseOrderCreation() {
        const container = document.getElementById('purchase-order-creation-content');
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

        this.renderPurchaseOrderCreationSteps(databaseOptions);
    }

    renderPurchaseOrderCreationSteps(databaseOptions) {
        const container = document.getElementById('purchase-order-creation-content');
        
        const html = `
            <!-- Step 1: Select Database -->
            <div class="purchase-order-step active" id="po-step1">
                <div class="purchase-order-step-header">
                    <div class="purchase-order-step-number">1</div>
                    <h3 class="purchase-order-step-title">Select Database</h3>
                </div>
                <div class="row">
                    <div class="col-md-6">
                        <label for="poDatabaseSelect" class="form-label">Choose Database Configuration</label>
                        <select class="form-select" id="poDatabaseSelect" required>
                            <option value="">Select a database...</option>
                            ${databaseOptions.map(db => `
                                <option value="${db.id}">${db.name} (${db.server}/${db.database})</option>
                            `).join('')}
                        </select>
                    </div>
                    <div class="col-md-6">
                        <label for="nextPoNumber" class="form-label">Next PO Number</label>
                        <input type="text" class="form-control" id="nextPoNumber" readonly placeholder="Select database first">
                    </div>
                </div>
            </div>

            <!-- Step 2: Select Supplier -->
            <div class="purchase-order-step" id="po-step2">
                <div class="purchase-order-step-header">
                    <div class="purchase-order-step-number">2</div>
                    <h3 class="purchase-order-step-title">Select Supplier</h3>
                </div>
                <div class="row">
                    <div class="col-md-8">
                        <label for="supplierSearch" class="form-label">Search Supplier by Account Number</label>
                        <div class="input-group">
                            <input type="text" class="form-control" id="supplierSearch" placeholder="Enter account number..." autocomplete="off">
                            <button class="btn btn-outline-secondary" type="button" id="searchSupplierBtn">
                                <i class="fas fa-search"></i>
                            </button>
                        </div>
                        <div id="supplierResults" class="supplier-results mt-2" style="display: none;"></div>
                    </div>
                    <div class="col-md-4">
                        <div id="selectedSupplierInfo" class="selected-supplier-info mt-4" style="display: none;">
                            <div class="card">
                                <div class="card-body">
                                    <h6 class="card-title">Selected Supplier</h6>
                                    <p class="card-text" id="supplierDisplayInfo"></p>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Step 3: Upload Excel File -->
            <div class="purchase-order-step" id="po-step3">
                <div class="purchase-order-step-header">
                    <div class="purchase-order-step-number">3</div>
                    <h3 class="purchase-order-step-title">Upload Excel File</h3>
                </div>
                <div class="file-upload-area" id="poFileUploadArea">
                    <div class="file-upload-icon">
                        <i class="fas fa-cloud-upload-alt"></i>
                    </div>
                    <h5>Drop Excel file here or click to browse</h5>
                    <p class="text-muted">Supported formats: .xlsx, .xls<br>Required columns: UPC, Cost, QTY</p>
                    <input type="file" id="poFileInput" accept=".xlsx,.xls" class="d-none">
                    <button type="button" class="btn btn-outline-primary" id="poBrowseButton">
                        <i class="fas fa-folder-open me-2"></i>Browse Files
                    </button>
                </div>
                <div id="poFileInfo" class="mt-3 d-none">
                    <div class="alert alert-info">
                        <i class="fas fa-file-excel me-2"></i>
                        <strong>Selected file:</strong> <span id="poFileName"></span>
                    </div>
                    <button type="button" class="btn btn-primary" id="processPoFileBtn">
                        <i class="fas fa-cogs me-2"></i>Process File
                    </button>
                </div>
            </div>

            <!-- Step 4: Review & Create Purchase Order -->
            <div class="purchase-order-step" id="po-step4">
                <div class="purchase-order-step-header">
                    <div class="purchase-order-step-number">4</div>
                    <h3 class="purchase-order-step-title">Review & Create Purchase Order</h3>
                </div>
                <div id="poPreviewContainer">
                    <!-- Purchase order preview will be populated here -->
                </div>
            </div>
        `;

        container.innerHTML = html;
        this.setupPurchaseOrderEventListeners();
    }

    setupPurchaseOrderEventListeners() {
        // Database selection
        const databaseSelect = document.getElementById('poDatabaseSelect');
        if (databaseSelect) {
            databaseSelect.addEventListener('change', (e) => {
                this.selectedDatabaseId = e.target.value;
                if (this.selectedDatabaseId) {
                    this.loadNextPoNumber();
                    this.activateStep(2);
                } else {
                    this.deactivateStep(2);
                    this.deactivateStep(3);
                    this.deactivateStep(4);
                }
            });
        }

        // Supplier search
        const supplierSearch = document.getElementById('supplierSearch');
        const searchSupplierBtn = document.getElementById('searchSupplierBtn');
        
        if (supplierSearch) {
            supplierSearch.addEventListener('keyup', (e) => {
                if (e.key === 'Enter') {
                    this.searchSuppliers();
                }
            });
        }
        
        if (searchSupplierBtn) {
            searchSupplierBtn.addEventListener('click', () => {
                this.searchSuppliers();
            });
        }

        // File upload
        const fileInput = document.getElementById('poFileInput');
        const fileUploadArea = document.getElementById('poFileUploadArea');
        const browseButton = document.getElementById('poBrowseButton');
        const processFileBtn = document.getElementById('processPoFileBtn');

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
                if (!this.selectedSupplier) {
                    authManager.showAlert('Please select a supplier first', 'warning');
                    return;
                }
                fileInput.click();
            });
        }

        if (fileUploadArea) {
            fileUploadArea.addEventListener('click', (e) => {
                // Only trigger if not clicking on the browse button
                if (!e.target.closest('#poBrowseButton')) {
                    if (!this.selectedDatabaseId) {
                        authManager.showAlert('Please select a database first', 'warning');
                        return;
                    }
                    if (!this.selectedSupplier) {
                        authManager.showAlert('Please select a supplier first', 'warning');
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
                
                if (!this.selectedSupplier) {
                    authManager.showAlert('Please select a supplier first', 'warning');
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

    async loadNextPoNumber() {
        if (!this.selectedDatabaseId) return;

        try {
            const response = await api.getNextPONumber(this.selectedDatabaseId);
            const input = document.getElementById('nextPoNumber');
            if (input) {
                input.value = response.next_number;
            }
        } catch (error) {
            authManager.showAlert('Failed to get next PO number: ' + error.message, 'danger');
        }
    }

    async searchSuppliers() {
        const searchInput = document.getElementById('supplierSearch');
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
            const response = await api.searchSuppliers({
                database_config_id: this.selectedDatabaseId,
                search_term: searchTerm
            });
            
            this.renderSupplierResults(response.suppliers);
            
        } catch (error) {
            authManager.showAlert('Failed to search suppliers: ' + error.message, 'danger');
        } finally {
            authManager.showLoading(false);
        }
    }

    renderSupplierResults(suppliers) {
        const resultsContainer = document.getElementById('supplierResults');
        
        if (!suppliers || suppliers.length === 0) {
            resultsContainer.innerHTML = `
                <div class="alert alert-info">
                    <i class="fas fa-info-circle me-2"></i>No suppliers found
                </div>
            `;
            resultsContainer.style.display = 'block';
            return;
        }

        const html = `
            <div class="list-group">
                ${suppliers.map(supplier => `
                    <a href="#" class="list-group-item list-group-item-action supplier-item" 
                       data-supplier-id="${supplier.SupplierID}"
                       data-account-no="${supplier.AccountNo}"
                       data-business-name="${supplier.BusinessName || ''}"
                       data-city="${supplier.City || ''}"
                       data-state="${supplier.State || ''}"
                       data-phone="${supplier.Phone_Number || ''}">
                        <div class="d-flex w-100 justify-content-between">
                            <h6 class="mb-1">${supplier.BusinessName || 'No Business Name'}</h6>
                            <small>${supplier.AccountNo}</small>
                        </div>
                        <p class="mb-1">${supplier.Address1 || ''} ${supplier.City || ''}, ${supplier.State || ''}</p>
                        <small>Contact: ${supplier.Contactname || 'N/A'} | Phone: ${supplier.Phone_Number || 'N/A'}</small>
                    </a>
                `).join('')}
            </div>
        `;

        resultsContainer.innerHTML = html;
        resultsContainer.style.display = 'block';

        // Add click event listeners to supplier items
        const supplierItems = resultsContainer.querySelectorAll('.supplier-item');
        supplierItems.forEach(item => {
            item.addEventListener('click', (e) => {
                e.preventDefault();
                this.selectSupplier({
                    SupplierID: parseInt(item.dataset.supplierId),
                    AccountNo: item.dataset.accountNo,
                    BusinessName: item.dataset.businessName,
                    City: item.dataset.city,
                    State: item.dataset.state,
                    Phone_Number: item.dataset.phone
                });
            });
        });
    }

    selectSupplier(supplier) {
        this.selectedSupplier = supplier;
        
        // Update UI to show selected supplier
        const supplierInfo = document.getElementById('selectedSupplierInfo');
        const supplierDisplay = document.getElementById('supplierDisplayInfo');
        
        if (supplierInfo && supplierDisplay) {
            supplierDisplay.innerHTML = `
                <strong>${supplier.BusinessName || 'No Business Name'}</strong><br>
                Account: ${supplier.AccountNo}<br>
                ${supplier.City ? `${supplier.City}, ${supplier.State}` : ''}<br>
                ${supplier.Phone_Number ? `Phone: ${supplier.Phone_Number}` : ''}
            `;
            supplierInfo.style.display = 'block';
        }
        
        // Hide search results
        const resultsContainer = document.getElementById('supplierResults');
        if (resultsContainer) {
            resultsContainer.style.display = 'none';
        }
        
        // Clear search input
        const searchInput = document.getElementById('supplierSearch');
        if (searchInput) {
            searchInput.value = supplier.AccountNo;
        }
        
        // Activate next step
        this.activateStep(3);
        
        authManager.showAlert('Supplier selected successfully', 'success');
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
        
        const fileInfo = document.getElementById('poFileInfo');
        const fileName = document.getElementById('poFileName');
        
        if (fileInfo && fileName) {
            fileName.textContent = file.name;
            fileInfo.classList.remove('d-none');
        }
    }

    async processExcelFile() {
        if (!this.uploadedFile || !this.selectedDatabaseId || !this.selectedSupplier) {
            authManager.showAlert('Please select database, supplier, and file', 'warning');
            return;
        }

        const formData = new FormData();
        formData.append('file', this.uploadedFile);
        formData.append('database_config_id', this.selectedDatabaseId);
        formData.append('supplier_id', this.selectedSupplier.SupplierID);

        try {
            authManager.showLoading(true);
            const response = await api.uploadExcelPO(formData);
            
            this.currentPreview = response.preview;
            this.renderPurchaseOrderPreview(response.preview, response.missing_upcs);
            this.activateStep(4);
            
            authManager.showAlert('Excel file processed successfully', 'success');
            
        } catch (error) {
            authManager.showAlert('Failed to process Excel file: ' + error.message, 'danger');
        } finally {
            authManager.showLoading(false);
        }
    }

    renderPurchaseOrderPreview(preview, missingUpcs) {
        const container = document.getElementById('poPreviewContainer');
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
                            These items will be excluded from the purchase order. 
                            ${missingUpcs.length > 0 ? 'You can still create the purchase order with the remaining items.' : ''}
                        </small>
                    </p>
                </div>
            `;
        }

        // Purchase order preview
        html += `
            <div class="purchase-order-preview">
                <div class="purchase-order-header">
                    <div class="row">
                        <div class="col-md-4">
                            <h4>Purchase Order Preview</h4>
                            <p class="text-muted">PO #${preview.po_number}</p>
                            <p class="mb-1"><strong>Date:</strong> ${preview.po_date}</p>
                            <p class="mb-1"><strong>Required Date:</strong> ${preview.required_date}</p>
                            <p class="mb-0"><strong>Items:</strong> ${preview.summary.total_items}</p>
                        </div>
                        <div class="col-md-4">
                            <h6 class="text-primary mb-2">Supplier Information</h6>
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
                    <table class="table table-striped purchase-order-table">
                        <thead>
                            <tr>
                                <th>UPC</th>
                                <th>Description</th>
                                <th>Size</th>
                                <th>Unit Cost</th>
                                <th>Qty Ordered</th>
                                <th>Qty Received</th>
                                <th>Extended Cost</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${preview.lines.map(line => `
                                <tr>
                                    <td>${line.ProductUPC}</td>
                                    <td>${line.ProductDescription || 'N/A'}</td>
                                    <td>${line.ItemSize || 'N/A'}</td>
                                    <td>$${line.UnitCost.toFixed(2)}</td>
                                    <td>${line.QtyOrdered}</td>
                                    <td>${line.QtyReceived}</td>
                                    <td>$${line.ExtendedCost.toFixed(2)}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>

                <div class="purchase-order-summary">
                    <div class="row">
                        <div class="col-md-8"></div>
                        <div class="col-md-4">
                            <table class="table table-sm">
                                <tr>
                                    <td><strong>Total Quantity Ordered:</strong></td>
                                    <td class="text-end">${preview.summary.total_quantity_ordered}</td>
                                </tr>
                                <tr>
                                    <td><strong>Total Quantity Received:</strong></td>
                                    <td class="text-end">${preview.summary.total_quantity_received}</td>
                                </tr>
                                <tr class="purchase-order-total">
                                    <td><strong>Total Cost:</strong></td>
                                    <td class="text-end">$${preview.summary.total_cost.toFixed(2)}</td>
                                </tr>
                            </table>
                        </div>
                    </div>
                </div>

                <div class="text-center mt-4">
                    <button type="button" class="btn btn-success btn-lg" onclick="purchaseOrderManager.createPurchaseOrder()">
                        <i class="fas fa-check me-2"></i>Create Purchase Order
                    </button>
                    <button type="button" class="btn btn-secondary btn-lg ms-2" onclick="purchaseOrderManager.resetWorkflow()">
                        <i class="fas fa-undo me-2"></i>Start Over
                    </button>
                </div>
            </div>
        `;

        container.innerHTML = html;
    }

    async createPurchaseOrder() {
        if (!this.currentPreview || !this.selectedDatabaseId) {
            authManager.showAlert('No purchase order data available', 'danger');
            return;
        }

        const confirmation = confirm(`Are you sure you want to create purchase order #${this.currentPreview.po_number}?`);
        if (!confirmation) return;

        try {
            authManager.showLoading(true);
            
            const poData = {
                database_config_id: this.selectedDatabaseId,
                po_data: {
                    po_number: this.currentPreview.po_number,
                    po_date: this.currentPreview.po_date,
                    required_date: this.currentPreview.required_date,
                    po_title: this.currentPreview.po_title,
                    status: this.currentPreview.status,
                    supplier_id: this.currentPreview.supplier_id,
                    business_name: this.currentPreview.business_name,
                    account_no: this.currentPreview.account_no,
                    ship_to: this.currentPreview.ship_to,
                    ship_address1: this.currentPreview.ship_address1,
                    ship_address2: this.currentPreview.ship_address2,
                    ship_contact: this.currentPreview.ship_contact,
                    ship_city: this.currentPreview.ship_city,
                    ship_state: this.currentPreview.ship_state,
                    ship_zipcode: this.currentPreview.ship_zipcode,
                    ship_phone: this.currentPreview.ship_phone,
                    employee_id: this.currentPreview.employee_id,
                    term_id: this.currentPreview.term_id,
                    shipper_id: this.currentPreview.shipper_id,
                    total_qty_ordered: this.currentPreview.total_qty_ordered,
                    total_qty_received: this.currentPreview.total_qty_received,
                    no_lines: this.currentPreview.no_lines,
                    po_total: this.currentPreview.po_total
                },
                po_details: this.currentPreview.lines
            };

            const response = await api.createPurchaseOrder(poData);
            
            authManager.showAlert(`Purchase Order #${response.po_number} created successfully!`, 'success');
            this.resetWorkflow();
            
        } catch (error) {
            authManager.showAlert('Failed to create purchase order: ' + error.message, 'danger');
        } finally {
            authManager.showLoading(false);
        }
    }

    resetWorkflow() {
        this.currentPreview = null;
        this.selectedDatabaseId = null;
        this.selectedSupplier = null;
        this.uploadedFile = null;
        
        // Reset form
        const databaseSelect = document.getElementById('poDatabaseSelect');
        if (databaseSelect) {
            databaseSelect.value = '';
        }
        
        const supplierSearch = document.getElementById('supplierSearch');
        if (supplierSearch) {
            supplierSearch.value = '';
        }
        
        const supplierResults = document.getElementById('supplierResults');
        if (supplierResults) {
            supplierResults.style.display = 'none';
        }
        
        const selectedSupplierInfo = document.getElementById('selectedSupplierInfo');
        if (selectedSupplierInfo) {
            selectedSupplierInfo.style.display = 'none';
        }
        
        const fileInput = document.getElementById('poFileInput');
        if (fileInput) {
            fileInput.value = '';
        }
        
        const fileInfo = document.getElementById('poFileInfo');
        if (fileInfo) {
            fileInfo.classList.add('d-none');
        }
        
        const nextPoNumber = document.getElementById('nextPoNumber');
        if (nextPoNumber) {
            nextPoNumber.value = '';
        }
        
        // Reset steps
        this.activateStep(1);
        this.deactivateStep(2);
        this.deactivateStep(3);
        this.deactivateStep(4);
        
        // Clear preview
        const container = document.getElementById('poPreviewContainer');
        if (container) {
            container.innerHTML = '';
        }
    }

    activateStep(stepNumber) {
        const step = document.getElementById(`po-step${stepNumber}`);
        if (step) {
            step.classList.add('active');
        }
    }

    deactivateStep(stepNumber) {
        const step = document.getElementById(`po-step${stepNumber}`);
        if (step) {
            step.classList.remove('active');
        }
    }
}

// Global purchase order manager instance
const purchaseOrderManager = new PurchaseOrderManager();