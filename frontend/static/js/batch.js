// Monthly Run: saved rules + batch creation of invoices, copies and purchase orders

const BATCH_STEP_TYPES = {
    invoice: { label: 'Invoice from Excel', short: 'Invoice', icon: 'fa-file-invoice-dollar', party: 'customer' },
    po: { label: 'Purchase order from Excel', short: 'Purchase order', icon: 'fa-truck-ramp-box', party: 'supplier' },
    copy: { label: 'Copy the invoice to another database', short: 'Copy invoice', icon: 'fa-copy', party: 'customer' }
};

const BATCH_STATUS = {
    pending: { label: 'Will create', cls: 'neutral', icon: 'fa-circle' },
    excluded: { label: 'Skipped', cls: 'muted', icon: 'fa-ban' },
    running: { label: 'Creating…', cls: 'info', icon: 'fa-spinner fa-spin' },
    success: { label: 'Created', cls: 'success', icon: 'fa-check' },
    failed: { label: 'Failed', cls: 'danger', icon: 'fa-xmark' },
    blocked: { label: 'Not run', cls: 'warning', icon: 'fa-link-slash' },
    interrupted: { label: 'Check manually', cls: 'danger', icon: 'fa-triangle-exclamation' }
};

const RUN_STATUS = {
    draft: { label: 'Not started', cls: 'neutral' },
    running: { label: 'Running', cls: 'info' },
    completed: { label: 'Completed', cls: 'success' },
    completed_with_errors: { label: 'Completed with errors', cls: 'warning' },
    interrupted: { label: 'Interrupted', cls: 'danger' }
};

const RETRYABLE = ['pending', 'failed', 'blocked'];
const EXECUTABLE_RUNS = ['draft', 'completed_with_errors', 'interrupted'];

const esc = (value) => utils.escapeHtml(String(value ?? ''));
const money = (value) => utils.formatCurrency(Number(value || 0));

function statusPill(map, status, extra = '') {
    const s = map[status] || { label: status, cls: 'neutral' };
    return `<span class="status-pill status-${s.cls}">${s.icon ? `<i class="fas ${s.icon}"></i>` : ''}${esc(s.label)}${extra}</span>`;
}

function runSteps(run) {
    return (run.files || []).filter(f => !f.error).flatMap(f => f.steps);
}

// Renders a run's files and steps. Used by Monthly Run (editable) and Run History (read only).
function renderBatchFiles(run, { editable, rules }) {
    const canToggle = EXECUTABLE_RUNS.includes(run.status);
    return run.files.map(file => {
        const ruleControl = editable
            ? `<select class="form-select form-select-sm batch-rule-select" data-file-id="${file.id}" ${file.error ? 'disabled' : ''}>
                    <option value="">Choose a rule…</option>
                    ${rules.map(r => `<option value="${r.id}" ${r.id === file.rule_id ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}
               </select>`
            : `<span class="text-muted small">${file.rule_name ? `Rule: <strong>${esc(file.rule_name)}</strong>` : 'No rule'}</span>`;

        const warnings = (file.warnings || []).map(w =>
            `<div class="batch-note batch-note-warning"><i class="fas fa-triangle-exclamation"></i>${esc(w)}</div>`).join('');
        const error = file.error
            ? `<div class="batch-note batch-note-danger"><i class="fas fa-circle-xmark"></i>Could not read this file: ${esc(file.error)}</div>` : '';
        const noRule = !file.error && !file.rule_id
            ? `<div class="batch-note"><i class="fas fa-circle-info"></i>No rule matched this file name. Choose one to see what will be created.</div>` : '';

        return `
            <div class="card batch-file">
                <div class="batch-file-head">
                    <div class="batch-file-icon"><i class="fas fa-file-excel"></i></div>
                    <div class="batch-file-title">
                        <div class="batch-file-name">${esc(file.filename)}</div>
                        <div class="text-muted small">${file.error ? 'Not readable' : `${file.row_count} row(s)`}</div>
                    </div>
                    <div class="batch-file-rule">${ruleControl}</div>
                    ${editable ? `<button class="icon-btn batch-remove-file" data-file-id="${file.id}" title="Remove file" aria-label="Remove file"><i class="fas fa-trash"></i></button>` : ''}
                </div>
                ${error}${warnings}${noRule}
                ${file.steps.length ? renderBatchSteps(file, canToggle && !file.error) : ''}
            </div>`;
    }).join('');
}

function renderBatchSteps(file, canToggle) {
    const byKey = Object.fromEntries(file.steps.map(s => [s.key, s]));
    const rows = file.steps.map(step => {
        const type = BATCH_STEP_TYPES[step.type] || { short: step.type, icon: 'fa-circle' };
        const p = step.preview || {};
        const number = step.doc_number ? `#${esc(step.doc_number)}` : (step.projected_number ? `<span class="text-muted">#${step.projected_number}?</span>` : '—');
        const toggleable = canToggle && (RETRYABLE.includes(step.status) || step.status === 'excluded');
        const included = step.status !== 'excluded';

        const issues = [];
        if (p.error) issues.push(`<div class="batch-issue text-danger">${esc(p.error)}</div>`);
        if (step.message && !['success', 'pending', 'excluded'].includes(step.status) && step.message !== p.error) {
            issues.push(`<div class="batch-issue text-danger">${esc(step.message)}</div>`);
        }
        if (step.type === 'copy' && included && byKey[step.source_step_key]?.status === 'excluded' && step.status !== 'success') {
            issues.push(`<div class="batch-issue text-warning">The invoice it copies is skipped, so this will not run</div>`);
        }
        if (p.missing_upcs?.length) {
            issues.push(`
                <details class="batch-issue">
                    <summary class="text-warning">${p.missing_upcs.length} UPC(s) not found, lines skipped</summary>
                    <ul class="batch-upc-list">${p.missing_upcs.map(m =>
                        `<li><code>${esc(m.upc)}</code>${m.row ? ` row ${m.row}` : ''}${m.qty != null ? ` · qty ${esc(m.qty)}` : ''}${m.description ? ` · ${esc(m.description)}` : ''}</li>`).join('')}
                    </ul>
                </details>`);
        }
        if (p.products_added) {
            issues.push(`<div class="batch-issue text-info">${p.products_added} product(s) ${step.status === 'success' ? 'were' : 'will be'} added to ${esc(step.database_name)}</div>`);
        }

        return `
            <tr class="${included ? '' : 'is-excluded'}">
                <td class="batch-col-check">
                    ${toggleable ? `<input class="form-check-input batch-step-toggle" type="checkbox" data-step-id="${step.id}" ${included ? 'checked' : ''} aria-label="Include step">` : ''}
                </td>
                <td>
                    <div class="batch-step-name"><i class="fas ${type.icon}"></i>${esc(type.short)} <span class="text-muted">→</span> ${esc(step.database_name)}</div>
                    <div class="text-muted small">${esc(step.party_label || p.party_name || '')}</div>
                    ${issues.join('')}
                </td>
                <td class="text-nowrap">${number}</td>
                <td class="text-end text-nowrap">${p.lines != null ? p.lines : '—'}</td>
                <td class="text-end text-nowrap">${p.total != null ? money(p.total) : '—'}</td>
                <td class="text-end">${statusPill(BATCH_STATUS, step.status)}</td>
            </tr>`;
    }).join('');

    return `
        <div class="table-responsive">
            <table class="table batch-steps mb-0">
                <thead><tr><th class="batch-col-check"></th><th>Document</th><th class="batch-col-number">Number</th><th class="batch-col-lines text-end">Lines</th><th class="batch-col-total text-end">Total</th><th class="batch-col-status text-end">Status</th></tr></thead>
                <tbody>${rows}</tbody>
            </table>
        </div>`;
}

function renderBatchLog(logs, filter) {
    const shown = logs.filter(l => filter === 'all' || l.level === filter);
    if (!shown.length) return '<p class="text-muted mb-0">Nothing logged.</p>';
    const icon = { info: 'fa-circle-info', warning: 'fa-triangle-exclamation', error: 'fa-circle-xmark' };
    return `<ul class="batch-log">${shown.map(l => `
        <li class="batch-log-${l.level}">
            <i class="fas ${icon[l.level] || 'fa-circle'}"></i>
            <div>
                <div><span class="batch-log-time">${utils.formatDateTime(l.created_at, { second: '2-digit' })}</span>${esc(l.message)}</div>
                ${l.details ? `<details><summary>Details</summary><pre>${esc(l.details)}</pre></details>` : ''}
            </div>
        </li>`).join('')}</ul>`;
}

async function downloadRunLog(runId) {
    try {
        const blob = await api.downloadBatchRunLog(runId);
        utils.downloadBlob(blob, `batch-run-${runId}-log.txt`);
    } catch (error) {
        authManager.showAlert('Failed to download log: ' + error.message, 'danger');
    }
}


class BatchRulesManager {
    constructor() {
        this.rules = [];
        this.loaded = false;
        this.editing = null;
        this.searchResults = {};
        this.init();
    }

    init() {
        document.getElementById('batch-rules-tab')?.addEventListener('shown.bs.tab', () => this.load());
        document.getElementById('newBatchRuleBtn')?.addEventListener('click', () => this.openEditor(null));
        document.getElementById('saveBatchRuleBtn')?.addEventListener('click', () => this.save());
    }

    async fetchRules() {
        const response = await api.getBatchRules();
        this.rules = response.rules;
        this.loaded = true;
        return this.rules;
    }

    async load() {
        const container = document.getElementById('batch-rules-content');
        try {
            await this.fetchRules();
            this.renderList();
        } catch (error) {
            container.innerHTML = `<div class="alert alert-danger">Failed to load rules: ${esc(error.message)}</div>`;
        }
    }

    databaseName(id) {
        return databaseManager.getDatabaseOptions().find(d => d.id === id)?.name || '(deleted database)';
    }

    renderList() {
        const container = document.getElementById('batch-rules-content');
        if (!this.rules.length) {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon"><i class="fas fa-list-check"></i></div>
                    <h5>No rules yet</h5>
                    <p>Create one rule per kind of sales report file, for example "Acme": invoice in database A,
                       copy it to database B, purchase order in database A.</p>
                    <button class="btn btn-primary" onclick="batchRulesManager.openEditor(null)"><i class="fas fa-plus me-2"></i>Create the first rule</button>
                </div>`;
            return;
        }

        container.innerHTML = `<div class="batch-rule-list">${this.rules.map(rule => `
            <div class="card batch-rule-card">
                <div class="card-body">
                    <div class="batch-rule-head">
                        <div>
                            <h5 class="card-title mb-1">${esc(rule.name)}</h5>
                            <div class="text-muted small">${rule.match_text
                                ? `Used for files whose name contains <code>${esc(rule.match_text)}</code>`
                                : 'Not matched automatically. Choose it by hand in Monthly Run.'}</div>
                        </div>
                        <div class="d-flex gap-2">
                            <button class="btn btn-sm btn-outline-secondary" data-edit-rule="${rule.id}"><i class="fas fa-pen me-1"></i>Edit</button>
                            <button class="btn btn-sm btn-outline-secondary" data-copy-rule="${rule.id}" title="Duplicate"><i class="fas fa-clone"></i></button>
                            <button class="btn btn-sm btn-outline-secondary text-danger" data-delete-rule="${rule.id}" title="Delete"><i class="fas fa-trash"></i></button>
                        </div>
                    </div>
                    <ol class="batch-rule-steps">${rule.steps.map(step => `
                        <li><i class="fas ${BATCH_STEP_TYPES[step.type]?.icon}"></i>
                            <strong>${esc(BATCH_STEP_TYPES[step.type]?.short)}</strong> in ${esc(this.databaseName(step.database_config_id))}
                            <span class="text-muted">· ${esc(step.party_label)}</span>
                            ${step.type === 'copy' ? `<span class="text-muted">(of step ${rule.steps.findIndex(s => s.id === step.source_step_id) + 1})</span>` : ''}
                        </li>`).join('')}
                    </ol>
                </div>
            </div>`).join('')}</div>`;

        container.querySelectorAll('[data-edit-rule]').forEach(b => b.addEventListener('click', () =>
            this.openEditor(this.rules.find(r => r.id === Number(b.dataset.editRule)))));
        container.querySelectorAll('[data-copy-rule]').forEach(b => b.addEventListener('click', () => {
            const rule = this.rules.find(r => r.id === Number(b.dataset.copyRule));
            this.openEditor({ ...rule, id: null, name: `${rule.name} (copy)` });
        }));
        container.querySelectorAll('[data-delete-rule]').forEach(b => b.addEventListener('click', () =>
            this.remove(Number(b.dataset.deleteRule))));
    }

    newStepId() {
        return 's' + Math.random().toString(36).slice(2, 10);
    }

    openEditor(rule) {
        if (!databaseManager.getDatabaseOptions().length) {
            authManager.showAlert('Add a database first (Databases tab)', 'warning');
            return;
        }
        this.editing = rule
            ? { id: rule.id, name: rule.name, match_text: rule.match_text, steps: rule.steps.map(s => ({ ...s })) }
            : { id: null, name: '', match_text: '', steps: [] };
        this.searchResults = {};
        document.getElementById('batchRuleModalTitle').textContent = this.editing.id ? 'Edit Rule' : 'New Rule';
        this.renderEditor();
        bootstrap.Modal.getOrCreateInstance(document.getElementById('batchRuleModal')).show();
    }

    renderEditor() {
        const r = this.editing;
        const body = document.getElementById('batchRuleModalBody');
        const hasInvoice = r.steps.some(s => s.type === 'invoice');

        body.innerHTML = `
            <div id="batchRuleErrors"></div>
            <div class="row g-3 mb-4">
                <div class="col-md-6">
                    <label class="form-label" for="ruleName">Rule name</label>
                    <input class="form-control" id="ruleName" value="${esc(r.name)}" placeholder="e.g. Acme">
                </div>
                <div class="col-md-6">
                    <label class="form-label" for="ruleMatch">File name contains</label>
                    <input class="form-control" id="ruleMatch" value="${esc(r.match_text)}" placeholder="e.g. acme">
                    <div class="form-text">Files whose name contains this text use this rule automatically (not case-sensitive). Leave empty to pick the rule by hand.</div>
                </div>
            </div>

            <div class="form-section-title">Steps, in order</div>
            <div id="ruleSteps">${r.steps.map((step, i) => this.renderEditorStep(step, i)).join('') ||
                '<p class="text-muted">Add the documents this file should create.</p>'}</div>

            <div class="d-flex flex-wrap gap-2 mt-3">
                <button type="button" class="btn btn-outline-primary" data-add-step="invoice"><i class="fas fa-file-invoice-dollar me-2"></i>Add invoice</button>
                <button type="button" class="btn btn-outline-primary" data-add-step="copy" ${hasInvoice ? '' : 'disabled title="Add an invoice step first"'}><i class="fas fa-copy me-2"></i>Add copy of an invoice</button>
                <button type="button" class="btn btn-outline-primary" data-add-step="po"><i class="fas fa-truck-ramp-box me-2"></i>Add purchase order</button>
            </div>`;

        body.querySelector('#ruleName').addEventListener('input', e => { r.name = e.target.value; });
        body.querySelector('#ruleMatch').addEventListener('input', e => { r.match_text = e.target.value; });
        body.querySelectorAll('[data-add-step]').forEach(b => b.addEventListener('click', () => this.addStep(b.dataset.addStep)));
        r.steps.forEach((step, i) => this.bindEditorStep(step, i));
    }

    renderEditorStep(step, index) {
        const type = BATCH_STEP_TYPES[step.type];
        const dbOptions = databaseManager.getDatabaseOptions();
        const earlierInvoices = this.editing.steps.slice(0, index).map((s, i) => ({ s, i })).filter(x => x.s.type === 'invoice');
        const partyWord = type.party === 'supplier' ? 'Supplier' : 'Customer';

        return `
            <div class="rule-step" data-step-index="${index}">
                <div class="rule-step-head">
                    <span class="rule-step-num">${index + 1}</span>
                    <i class="fas ${type.icon}"></i><strong>${type.label}</strong>
                    <div class="ms-auto d-flex gap-1">
                        <button type="button" class="icon-btn" data-move="-1" ${index === 0 ? 'disabled' : ''} aria-label="Move up"><i class="fas fa-arrow-up"></i></button>
                        <button type="button" class="icon-btn" data-move="1" ${index === this.editing.steps.length - 1 ? 'disabled' : ''} aria-label="Move down"><i class="fas fa-arrow-down"></i></button>
                        <button type="button" class="icon-btn" data-remove-step aria-label="Remove step"><i class="fas fa-trash"></i></button>
                    </div>
                </div>
                <div class="row g-3">
                    ${step.type === 'copy' ? `
                    <div class="col-md-4">
                        <label class="form-label">Copy the invoice from</label>
                        <select class="form-select" data-field="source_step_id">
                            <option value="">Choose a step…</option>
                            ${earlierInvoices.map(({ s, i }) => `<option value="${s.id}" ${s.id === step.source_step_id ? 'selected' : ''}>Step ${i + 1}: invoice in ${esc(this.databaseName(s.database_config_id))}</option>`).join('')}
                        </select>
                    </div>` : ''}
                    <div class="col-md-4">
                        <label class="form-label">${step.type === 'copy' ? 'Into database' : 'Database'}</label>
                        <select class="form-select" data-field="database_config_id">
                            <option value="">Choose a database…</option>
                            ${dbOptions.map(d => `<option value="${d.id}" ${d.id === step.database_config_id ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}
                        </select>
                    </div>
                    <div class="${step.type === 'copy' ? 'col-md-4' : 'col-md-8'}">
                        <label class="form-label">${partyWord}</label>
                        ${step.party_id ? `
                            <div class="rule-party-selected">
                                <i class="fas fa-${type.party === 'supplier' ? 'truck' : 'user'}"></i>
                                <span>${esc(step.party_label)}</span>
                                <button type="button" class="btn btn-sm btn-link ms-auto" data-change-party>Change</button>
                            </div>` : `
                            <div class="input-group">
                                <input class="form-control" data-party-search placeholder="Search by account number" ${step.database_config_id ? '' : 'disabled'}>
                                <button type="button" class="btn btn-outline-secondary" data-party-search-btn ${step.database_config_id ? '' : 'disabled'}><i class="fas fa-search"></i></button>
                            </div>
                            ${step.database_config_id ? '' : '<div class="form-text">Choose the database first</div>'}
                            <div class="rule-party-results" data-party-results></div>`}
                    </div>
                </div>
            </div>`;
    }

    bindEditorStep(step, index) {
        const el = document.querySelector(`#ruleSteps [data-step-index="${index}"]`);
        if (!el) return;

        el.querySelectorAll('[data-field]').forEach(input => input.addEventListener('change', () => {
            const field = input.dataset.field;
            if (field === 'database_config_id') {
                step.database_config_id = input.value ? Number(input.value) : null;
                step.party_id = null;
                step.party_label = '';
                this.renderEditor();
            } else {
                step[field] = input.value;
            }
        }));
        el.querySelector('[data-remove-step]').addEventListener('click', () => {
            this.editing.steps.splice(index, 1);
            this.editing.steps.forEach(s => {
                if (s.type === 'copy' && s.source_step_id === step.id) s.source_step_id = '';
            });
            this.renderEditor();
        });
        el.querySelectorAll('[data-move]').forEach(b => b.addEventListener('click', () => {
            const target = index + Number(b.dataset.move);
            const steps = this.editing.steps;
            [steps[index], steps[target]] = [steps[target], steps[index]];
            this.renderEditor();
        }));
        el.querySelector('[data-change-party]')?.addEventListener('click', () => {
            step.party_id = null;
            step.party_label = '';
            this.renderEditor();
        });

        const searchInput = el.querySelector('[data-party-search]');
        if (searchInput) {
            const run = () => this.searchParty(step, searchInput.value.trim(), el.querySelector('[data-party-results]'));
            el.querySelector('[data-party-search-btn]').addEventListener('click', run);
            searchInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); run(); } });
        }
    }

    async searchParty(step, term, resultsEl) {
        if (!term) return;
        const isSupplier = BATCH_STEP_TYPES[step.type].party === 'supplier';
        resultsEl.innerHTML = '<div class="text-muted small p-2">Searching…</div>';
        try {
            const payload = { database_config_id: step.database_config_id, search_term: term };
            const response = isSupplier ? await api.searchSuppliers(payload) : await api.searchCustomers(payload);
            const people = (isSupplier ? response.suppliers : response.customers) || [];
            if (!people.length) {
                resultsEl.innerHTML = '<div class="text-muted small p-2">Nothing found</div>';
                return;
            }
            resultsEl.innerHTML = `<div class="list-group">${people.slice(0, 25).map((p, i) => `
                <button type="button" class="list-group-item list-group-item-action" data-pick="${i}">
                    <strong>${esc(p.AccountNo)}</strong> — ${esc(p.BusinessName || 'No business name')}
                    <span class="text-muted small">${esc([p.City, p.State].filter(Boolean).join(', '))}</span>
                </button>`).join('')}</div>`;
            resultsEl.querySelectorAll('[data-pick]').forEach(b => b.addEventListener('click', () => {
                const p = people[Number(b.dataset.pick)];
                step.party_id = isSupplier ? p.SupplierID : p.CustomerID;
                step.party_label = `${p.AccountNo} — ${p.BusinessName || ''}`.trim();
                this.renderEditor();
            }));
        } catch (error) {
            resultsEl.innerHTML = `<div class="text-danger small p-2">Search failed: ${esc(error.message)}</div>`;
        }
    }

    addStep(type) {
        const steps = this.editing.steps;
        const lastInvoice = [...steps].reverse().find(s => s.type === 'invoice');
        const step = { id: this.newStepId(), type, database_config_id: null, party_id: null, party_label: '' };
        if (type === 'copy') step.source_step_id = lastInvoice?.id || '';
        steps.push(step);
        this.renderEditor();
    }

    async save() {
        const errorsEl = document.getElementById('batchRuleErrors');
        try {
            await api.saveBatchRule(this.editing);
            bootstrap.Modal.getInstance(document.getElementById('batchRuleModal'))?.hide();
            authManager.showAlert('Rule saved', 'success');
            await this.load();
        } catch (error) {
            errorsEl.innerHTML = `<div class="alert alert-danger">${esc(error.message).replace(/; /g, '<br>')}</div>`;
            document.getElementById('batchRuleModalBody').scrollTop = 0;
        }
    }

    async remove(ruleId) {
        const rule = this.rules.find(r => r.id === ruleId);
        if (!confirm(`Delete rule "${rule?.name}"? Past runs keep their history.`)) return;
        try {
            await api.deleteBatchRule(ruleId);
            await this.load();
        } catch (error) {
            authManager.showAlert('Failed to delete rule: ' + error.message, 'danger');
        }
    }
}


class MonthlyRunManager {
    constructor() {
        this.run = null;
        this.pollTimer = null;
        this.uploading = null;
        this.init();
    }

    init() {
        document.getElementById('batch-run-tab')?.addEventListener('shown.bs.tab', () => this.open());
    }

    async open() {
        const container = document.getElementById('batch-run-content');
        try {
            await batchRulesManager.fetchRules();
            if (!this.run || this.run.status === 'draft') {
                const { runs } = await api.getBatchRuns();
                const active = runs.find(r => r.status === 'running') || runs.find(r => r.status === 'draft');
                this.run = active ? (await api.getBatchRun(active.id)).run : null;
            } else {
                this.run = (await api.getBatchRun(this.run.id)).run;
            }
            this.render();
            if (this.run?.status === 'running') this.startPolling();
        } catch (error) {
            container.innerHTML = `<div class="alert alert-danger">Failed to load: ${esc(error.message)}</div>`;
        }
    }

    async openRun(runId) {
        this.run = (await api.getBatchRun(runId)).run;
        document.getElementById('batch-run-tab').click();
    }

    render() {
        const container = document.getElementById('batch-run-content');
        const rules = batchRulesManager.rules;
        const run = this.run;

        if (!rules.length) {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon"><i class="fas fa-list-check"></i></div>
                    <h5>Create a rule first</h5>
                    <p>Rules tell the Monthly Run what to create from each file.</p>
                    <button class="btn btn-primary" onclick="document.getElementById('batch-rules-tab').click()">Go to Rules</button>
                </div>`;
            return;
        }

        const isDraft = !run || run.status === 'draft';
        const dropZone = isDraft ? `
            <div class="file-upload-area batch-drop mb-3" id="batchDrop">
                <div class="file-upload-icon"><i class="fas fa-cloud-arrow-up"></i></div>
                <h5>${run?.files.length ? 'Add more files' : 'Drop this month\'s sales report files here'}</h5>
                <p>or click to choose. Several .xlsx / .xls files at once. Each file is matched to a rule by its name.</p>
                <input type="file" id="batchFileInput" accept=".xlsx,.xls" multiple hidden>
            </div>
            ${this.uploading ? `<div class="batch-progress mb-3"><span class="spinner-border spinner-border-sm me-2"></span>${esc(this.uploading)}</div>` : ''}` : '';

        container.innerHTML = `
            ${run && !isDraft ? this.renderResultBanner(run) : ''}
            ${dropZone}
            ${run?.files.length ? renderBatchFiles(run, { editable: isDraft, rules }) : ''}
            ${run?.files.length ? this.renderActionBar(run) : ''}`;

        this.bind();
    }

    renderResultBanner(run) {
        const steps = runSteps(run).filter(s => s.status !== 'excluded');
        const created = steps.filter(s => s.status === 'success').length;
        const problems = steps.filter(s => ['failed', 'blocked', 'interrupted'].includes(s.status)).length;
        const when = run.started_at ? utils.formatDateTime(run.started_at) : '';
        let text;
        if (run.status === 'running') {
            text = `<span class="spinner-border spinner-border-sm me-2"></span>Creating documents: ${created} of ${steps.length} done…`;
        } else if (problems) {
            text = `${created} of ${steps.length} documents created. ${problems} need attention. Read the messages below.`;
        } else {
            text = `All ${created} documents were created.`;
        }
        return `
            <div class="batch-banner batch-banner-${RUN_STATUS[run.status]?.cls || 'neutral'} mb-3">
                <div>
                    <div class="fw-semibold">Run #${run.id} ${statusPill(RUN_STATUS, run.status)}</div>
                    <div class="small mt-1">${text}</div>
                    ${when ? `<div class="small text-muted">Started ${when}</div>` : ''}
                </div>
            </div>`;
    }

    renderActionBar(run) {
        const steps = runSteps(run);
        const todo = steps.filter(s => RETRYABLE.includes(s.status));
        const blockedCopies = todo.filter(s => s.type === 'copy' && steps.find(x => x.key === s.source_step_key && x.status === 'excluded')).length;
        const skipped = steps.filter(s => s.status === 'excluded').length;
        const issues = steps.filter(s => s.status !== 'success' && (s.preview?.error || s.preview?.missing_upcs?.length)).length;
        const unassigned = run.files.filter(f => !f.error && !f.rule_id).length;

        const parts = [`${run.files.length} file(s)`, `<strong>${todo.length}</strong> document(s) to create`];
        if (skipped) parts.push(`${skipped} skipped`);
        if (issues) parts.push(`<span class="text-warning">${issues} with warnings</span>`);
        if (unassigned) parts.push(`<span class="text-danger">${unassigned} file(s) without a rule</span>`);

        const isDraft = run.status === 'draft';
        const canRun = EXECUTABLE_RUNS.includes(run.status) && todo.length > 0;
        const runLabel = isDraft ? `Create ${todo.length} document(s)` : `Retry ${todo.length} remaining`;

        return `
            <div class="batch-action-bar">
                <div class="batch-action-summary">${run.status === 'running' ? 'Running…' : parts.join(' · ')}
                    ${blockedCopies ? `<div class="small text-warning">${blockedCopies} copy step(s) will not run because their invoice is skipped</div>` : ''}
                </div>
                <div class="d-flex flex-wrap gap-2">
                    ${!isDraft ? `<button class="btn btn-outline-secondary" id="batchLogBtn"><i class="fas fa-file-lines me-2"></i>Download log</button>` : ''}
                    ${isDraft ? `<button class="btn btn-outline-secondary" id="batchDiscardBtn">Discard</button>` : ''}
                    ${!isDraft && run.status !== 'running' ? `<button class="btn btn-outline-secondary" id="batchNewBtn"><i class="fas fa-plus me-2"></i>New run</button>` : ''}
                    ${canRun ? `<button class="btn btn-success" id="batchExecuteBtn" ${this.uploading ? 'disabled' : ''}><i class="fas fa-bolt me-2"></i>${runLabel}</button>` : ''}
                </div>
            </div>`;
    }

    bind() {
        const drop = document.getElementById('batchDrop');
        const input = document.getElementById('batchFileInput');
        if (drop && input) {
            drop.addEventListener('click', () => input.click());
            drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('dragover'); });
            drop.addEventListener('dragleave', () => drop.classList.remove('dragover'));
            drop.addEventListener('drop', e => {
                e.preventDefault();
                drop.classList.remove('dragover');
                this.addFiles([...e.dataTransfer.files]);
            });
            input.addEventListener('change', () => this.addFiles([...input.files]));
        }

        document.querySelectorAll('.batch-rule-select').forEach(sel => sel.addEventListener('change', () =>
            this.update(() => api.setBatchFileRule(this.run.id, Number(sel.dataset.fileId), sel.value ? Number(sel.value) : null))));
        document.querySelectorAll('.batch-remove-file').forEach(btn => btn.addEventListener('click', () =>
            this.update(() => api.removeBatchRunFile(this.run.id, Number(btn.dataset.fileId)))));
        document.querySelectorAll('.batch-step-toggle').forEach(box => box.addEventListener('change', () =>
            this.update(() => api.setBatchStepIncluded(this.run.id, Number(box.dataset.stepId), box.checked))));

        document.getElementById('batchExecuteBtn')?.addEventListener('click', () => this.execute());
        document.getElementById('batchDiscardBtn')?.addEventListener('click', () => this.discard());
        document.getElementById('batchNewBtn')?.addEventListener('click', () => { this.run = null; this.render(); });
        document.getElementById('batchLogBtn')?.addEventListener('click', () => downloadRunLog(this.run.id));
    }

    async update(call) {
        try {
            authManager.showLoading(true);
            this.run = (await call()).run;
        } catch (error) {
            authManager.showAlert(error.message, 'danger');
        } finally {
            authManager.showLoading(false);
            this.render();
        }
    }

    async addFiles(files) {
        const excel = files.filter(f => /\.(xlsx|xls)$/i.test(f.name));
        if (excel.length < files.length) {
            authManager.showAlert(`${files.length - excel.length} file(s) ignored: only .xlsx and .xls are accepted`, 'warning');
        }
        if (!excel.length) return;

        try {
            if (!this.run) this.run = (await api.createBatchRun()).run;
            for (let i = 0; i < excel.length; i++) {
                this.uploading = `Checking ${excel[i].name} (${i + 1} of ${excel.length})…`;
                this.render();
                try {
                    this.run = (await api.addBatchRunFile(this.run.id, excel[i])).run;
                } catch (error) {
                    authManager.showAlert(`${excel[i].name}: ${error.message}`, 'danger');
                }
            }
        } catch (error) {
            authManager.showAlert('Failed to start a run: ' + error.message, 'danger');
        } finally {
            this.uploading = null;
            this.render();
        }
    }

    async execute() {
        const steps = runSteps(this.run).filter(s => RETRYABLE.includes(s.status));
        const unassigned = this.run.files.filter(f => !f.error && !f.rule_id).length;
        const byType = { invoice: 0, copy: 0, po: 0 };
        steps.forEach(s => { byType[s.type] += 1; });
        const lines = [
            `This will create in SQL Server:`,
            `  • ${byType.invoice} invoice(s) from Excel`,
            `  • ${byType.copy} invoice copy(ies)`,
            `  • ${byType.po} purchase order(s)`
        ];
        if (unassigned) lines.push('', `${unassigned} file(s) have no rule and will be ignored.`);
        if (!confirm(lines.join('\n') + '\n\nContinue?')) return;

        try {
            this.run = (await api.executeBatchRun(this.run.id)).run;
            this.render();
            this.startPolling();
        } catch (error) {
            authManager.showAlert('Failed to start: ' + error.message, 'danger');
        }
    }

    startPolling() {
        clearTimeout(this.pollTimer);
        const tick = async () => {
            try {
                this.run = (await api.getBatchRun(this.run.id)).run;
                if (document.getElementById('batch-run').classList.contains('active')) this.render();
            } catch (error) {
                console.error('Polling run failed:', error);
            }
            if (this.run.status === 'running') {
                this.pollTimer = setTimeout(tick, 1500);
            } else {
                const ok = this.run.status === 'completed';
                authManager.showAlert(ok ? 'Monthly run completed' : 'Run finished with problems. See the details.', ok ? 'success' : 'warning');
            }
        };
        this.pollTimer = setTimeout(tick, 1000);
    }

    async discard() {
        if (!confirm('Discard this run? Nothing has been created yet.')) return;
        try {
            await api.discardBatchRun(this.run.id);
            this.run = null;
            this.render();
        } catch (error) {
            authManager.showAlert('Failed to discard: ' + error.message, 'danger');
        }
    }
}


class BatchHistoryManager {
    constructor() {
        this.logFilter = 'all';
        this.init();
    }

    init() {
        document.getElementById('batch-history-tab')?.addEventListener('shown.bs.tab', () => this.showList());
    }

    async showList() {
        const container = document.getElementById('batch-history-content');
        try {
            const { runs } = await api.getBatchRuns();
            if (!runs.length) {
                container.innerHTML = `<div class="empty-state"><div class="empty-state-icon"><i class="fas fa-clock-rotate-left"></i></div><h5>No runs yet</h5><p>Runs from the Monthly Run page appear here.</p></div>`;
                return;
            }
            container.innerHTML = `
                <div class="table-responsive">
                    <table class="table invoice-browse-table">
                        <thead><tr><th>Run</th><th>Date</th><th>Status</th><th>Files</th><th>Created</th><th>Problems</th><th></th></tr></thead>
                        <tbody>${runs.map(r => {
                            const c = r.counts;
                            const problems = (c.failed || 0) + (c.blocked || 0) + (c.interrupted || 0) + r.file_errors;
                            return `<tr data-run="${r.id}">
                                <td><strong>#${r.id}</strong></td>
                                <td>${utils.formatDateTime(r.started_at || r.created_at)}</td>
                                <td>${statusPill(RUN_STATUS, r.status)}</td>
                                <td>${r.file_count}</td>
                                <td>${c.success || 0}</td>
                                <td>${problems ? `<span class="text-danger">${problems}</span>` : '0'}</td>
                                <td class="text-end"><button class="btn btn-sm btn-outline-secondary">Open</button></td>
                            </tr>`;
                        }).join('')}</tbody>
                    </table>
                </div>`;
            container.querySelectorAll('[data-run]').forEach(row =>
                row.addEventListener('click', () => this.showRun(Number(row.dataset.run))));
        } catch (error) {
            container.innerHTML = `<div class="alert alert-danger">Failed to load runs: ${esc(error.message)}</div>`;
        }
    }

    async showRun(runId) {
        const container = document.getElementById('batch-history-content');
        try {
            const { run } = await api.getBatchRun(runId, true);
            this.current = run;
            const canContinue = EXECUTABLE_RUNS.includes(run.status) || run.status === 'running';
            const filters = ['all', 'error', 'warning', 'info'].map(f =>
                `<button type="button" class="btn btn-sm ${this.logFilter === f ? 'btn-primary' : 'btn-outline-secondary'}" data-log-filter="${f}">${f === 'all' ? 'All' : f[0].toUpperCase() + f.slice(1) + 's'}</button>`).join('');

            container.innerHTML = `
                <div class="d-flex flex-wrap align-items-center gap-2 mb-3">
                    <button class="btn btn-outline-secondary" id="historyBack"><i class="fas fa-arrow-left me-2"></i>All runs</button>
                    <h5 class="mb-0 ms-2">Run #${run.id}</h5>
                    ${statusPill(RUN_STATUS, run.status)}
                    <div class="ms-auto d-flex gap-2">
                        <button class="btn btn-outline-secondary" id="historyLog"><i class="fas fa-file-lines me-2"></i>Download log</button>
                        ${canContinue ? `<button class="btn btn-primary" id="historyOpen"><i class="fas fa-bolt me-2"></i>Open in Monthly Run</button>` : ''}
                    </div>
                </div>
                ${renderBatchFiles(run, { editable: false, rules: [] })}
                <div class="card mt-3">
                    <div class="card-body">
                        <div class="d-flex flex-wrap align-items-center gap-2 mb-3">
                            <h6 class="mb-0 me-auto">Log</h6>
                            <div class="btn-group">${filters}</div>
                        </div>
                        ${renderBatchLog(run.logs, this.logFilter)}
                    </div>
                </div>`;

            document.getElementById('historyBack').addEventListener('click', () => this.showList());
            document.getElementById('historyLog').addEventListener('click', () => downloadRunLog(run.id));
            document.getElementById('historyOpen')?.addEventListener('click', () => monthlyRunManager.openRun(run.id));
            container.querySelectorAll('[data-log-filter]').forEach(b => b.addEventListener('click', () => {
                this.logFilter = b.dataset.logFilter;
                this.showRun(run.id);
            }));
        } catch (error) {
            container.innerHTML = `<div class="alert alert-danger">Failed to load run: ${esc(error.message)}</div>`;
        }
    }
}

const batchRulesManager = new BatchRulesManager();
const monthlyRunManager = new MonthlyRunManager();
const batchHistoryManager = new BatchHistoryManager();
