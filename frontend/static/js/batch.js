// Monthly Run: saved rules + batch creation of invoices, copies and purchase orders

const BATCH_STEP_TYPES = {
    invoice: { label: 'Invoice from Excel', short: 'Invoice', icon: 'fa-file-invoice-dollar', party: 'customer' },
    po: { label: 'Purchase order from Excel', short: 'Purchase order', icon: 'fa-truck-ramp-box', party: 'supplier' },
    copy: { label: 'Copy the invoice to another database', short: 'Copy invoice', icon: 'fa-copy', party: 'customer' }
};

const stepName = step => `${(BATCH_STEP_TYPES[step.type] || { short: step.type }).short} → ${step.database_name}`;

const BATCH_STATUS = {
    pending: { label: 'Will create', cls: 'neutral', icon: 'fa-circle' },
    excluded: { label: 'Skipped', cls: 'muted', icon: 'fa-ban' },
    running: { label: 'Creating…', cls: 'info', icon: 'fa-spinner fa-spin' },
    success: { label: 'Created', cls: 'success', icon: 'fa-check' },
    failed: { label: 'Failed', cls: 'danger', icon: 'fa-xmark' },
    blocked: { label: 'Not run', cls: 'warning', icon: 'fa-link-slash' },
    interrupted: { label: 'Interrupted', cls: 'warning', icon: 'fa-triangle-exclamation' },
    held: { label: 'On hold', cls: 'info', icon: 'fa-pause' }
};

const RUN_STATUS = {
    draft: { label: 'Not started', cls: 'neutral' },
    running: { label: 'Running', cls: 'info' },
    completed: { label: 'Completed', cls: 'success' },
    completed_with_errors: { label: 'Completed with errors', cls: 'warning' },
    cancelled: { label: 'Cancelled', cls: 'warning' },
    on_hold: { label: 'Waiting for later', cls: 'info' },
    interrupted: { label: 'Interrupted', cls: 'danger' }
};

const RETRYABLE = ['pending', 'failed', 'blocked', 'interrupted'];
const TOGGLEABLE = ['pending', 'failed', 'blocked', 'excluded'];
const HOLDABLE = ['pending', 'failed', 'blocked', 'excluded'];
const EXECUTABLE_RUNS = ['draft', 'completed_with_errors', 'on_hold', 'cancelled', 'interrupted'];
const FINISHED_RUNS = ['completed', 'completed_with_errors', 'on_hold', 'cancelled', 'interrupted'];

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
// editable: files and rules can be changed (draft only). interactive: steps can be ticked, held and re-checked.
function renderBatchFiles(run, { editable, interactive = false, rules }) {
    const rowsAllowed = interactive;
    const canToggle = interactive && EXECUTABLE_RUNS.includes(run.status);
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
            ? `<div class="batch-note batch-note-danger"><i class="fas fa-circle-xmark"></i>${file.source_type === 'sales' ? '' : 'Could not read this file: '}${esc(file.error)}</div>` : '';
        const isSales = file.source_type === 'sales';
        const noRule = !file.error && !file.rule_id
            ? `<div class="batch-note"><i class="fas fa-circle-info"></i>${isSales
                ? 'The preset has no default rule. Choose one to see what will be created.'
                : 'No rule matched this file name. Choose one to see what will be created.'}</div>` : '';
        const created = file.steps.some(s => ['success', 'running', 'interrupted'].includes(s.status));
        const salesActions = isSales && canToggle && !created
            ? `<button class="btn btn-sm btn-outline-secondary batch-repull" data-file-id="${file.id}" title="Read the store's sales again"><i class="fas fa-cloud-arrow-down me-1"></i>Pull again</button>` : '';
        const rowsDownload = file.row_count && rowsAllowed
            ? `<button class="icon-btn batch-file-rows" data-file-id="${file.id}" title="Download these lines as Excel" aria-label="Download lines"><i class="fas fa-file-arrow-down"></i></button>` : '';
        const subtitle = file.error ? (isSales ? 'Not pulled' : 'Not readable')
            : isSales && file.source ? `${esc(file.source.source_db || '')} · ${file.row_count} line(s)` : `${file.row_count} row(s)`;

        return `
            <div class="card batch-file">
                <div class="batch-file-head">
                    <div class="batch-file-icon ${isSales ? 'is-sales' : ''}"><i class="fas ${isSales ? 'fa-store' : 'fa-file-excel'}"></i></div>
                    <div class="batch-file-title">
                        <div class="batch-file-name">${esc(file.filename)}</div>
                        <div class="text-muted small">${subtitle}</div>
                    </div>
                    <div class="batch-file-rule">${ruleControl}</div>
                    ${salesActions}
                    ${rowsDownload}
                    ${canToggle && file.steps.length ? `<button class="btn btn-sm btn-outline-secondary batch-recheck-file" data-file-id="${file.id}" title="Check this file against the databases again"><i class="fas fa-rotate-right me-1"></i>Re-check</button>` : ''}
                    ${editable ? `<button class="icon-btn batch-remove-file" data-file-id="${file.id}" title="Remove file" aria-label="Remove file"><i class="fas fa-trash"></i></button>` : ''}
                </div>
                ${error}${warnings}${file.source_type === 'sales' && file.source && !file.error ? `<div class="batch-sales-summary">${renderSalesSummary(file.source, { kind: 'file', runId: run.id, fileId: file.id })}</div>` : ''}${noRule}
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
        const toggleable = canToggle && TOGGLEABLE.includes(step.status);
        const included = step.status !== 'excluded';

        const issues = [];
        if (p.error) issues.push(`<div class="batch-issue text-danger">${esc(p.error)}</div>`);
        if (step.message && !['success', 'pending', 'excluded'].includes(step.status) && step.message !== p.error) {
            issues.push(`<div class="batch-issue text-danger">${esc(step.message)}</div>`);
        }
        if (step.type === 'copy' && included && byKey[step.source_step_key]?.status === 'excluded' && step.status !== 'success') {
            issues.push(`<div class="batch-issue text-warning">The invoice it copies is skipped, so this will not run</div>`);
        }
        const upcList = list => `<ul class="batch-upc-list">${list.map(m =>
            `<li><code>${esc(m.upc)}</code>${m.row && !m.description ? ` row ${m.row}` : ''}${m.qty != null ? ` · qty ${esc(m.qty)}` : ''}${m.description ? ` · ${esc(m.description)}` : ''}</li>`).join('')}</ul>`;
        const notFound = (p.missing_upcs || []).filter(m => !m.added_later_by);
        const addedLater = (p.missing_upcs || []).filter(m => m.added_later_by);
        if (notFound.length) {
            issues.push(`
                <details class="batch-issue">
                    <summary class="text-warning">${notFound.length} UPC(s) not found in ${esc(step.database_name)}, lines skipped</summary>
                    ${upcList(notFound)}
                </details>`);
        }
        if (addedLater.length && step.status !== 'success') {
            const copy = byKey[addedLater[0].added_later_by];
            issues.push(`
                <details class="batch-issue">
                    <summary class="text-warning">${addedLater.length} UPC(s) are added by ${copy ? esc(stepName(copy)) : 'a copy step'}, which runs after this step: lines skipped</summary>
                    ${upcList(addedLater)}
                    <div class="text-muted small">To include them, move this step below the copy in the rule, then choose the rule here again.</div>
                </details>`);
        }
        if (step.status !== 'success' && !p.error && step.type !== 'copy' && p.missing_upcs?.length && !('from_copy' in p)
                && file.steps.some(s => s.type === 'copy' && s.database_config_id === step.database_config_id)) {
            issues.push(`<div class="batch-issue text-muted">Checked before products added by copy steps were counted. Press Re-check to update.</div>`);
        }
        if (p.from_copy?.length && step.status !== 'success') {
            const willRun = s => s && (s.status === 'success' || RETRYABLE.includes(s.status));
            const copy = byKey[p.from_copy[0].step_key];
            const copyRuns = willRun(copy) && (copy.status === 'success' || willRun(byKey[copy.source_step_key]));
            const list = `<ul class="batch-upc-list">${p.from_copy.map(m =>
                `<li><code>${esc(m.upc)}</code>${m.description ? ` · ${esc(m.description)}` : ''}</li>`).join('')}</ul>`;
            issues.push(copyRuns
                ? `<details class="batch-issue"><summary class="text-info">${p.from_copy.length} product(s) not in ${esc(step.database_name)} yet: ${copy ? esc(stepName(copy)) : 'the copy step'} adds them first</summary>${list}</details>`
                : `<details class="batch-issue"><summary class="text-warning">${p.from_copy.length} UPC(s) would come from the copy step, which ${copy?.status === 'held' ? 'is on hold' : 'will not run'}: lines skipped</summary>${list}
                       <div class="text-muted small">Press Re-check to update the line count and total.</div></details>`);
        }
        if (step.status === 'held' && (p.error || p.missing_upcs?.length)) {
            issues.push(`<div class="batch-issue text-muted">Fix it in BackOffice, press Re-check, then Resume and create</div>`);
        }
        if (p.recovered) {
            issues.push(`<div class="batch-issue text-info">Saved by an earlier attempt. Checked in the database, not created twice</div>`);
        } else if (step.status === 'success' && step.attempts > 1) {
            issues.push(`<div class="batch-issue text-info">Created on attempt ${step.attempts} after a temporary error</div>`);
        }
        if (p.duplicate_number) {
            issues.push(`<div class="batch-issue text-danger">Number #${esc(step.doc_number)} now exists ${p.duplicate_number} times in ${esc(step.database_name)}. Check the numbering</div>`);
        }
        if (p.products_added) {
            const text = `${p.products_added} product(s) ${step.status === 'success' ? 'were' : 'will be'} added to ${esc(step.database_name)}`;
            const usedBy = file.steps.filter(s => s.status !== 'success' && s.preview?.from_copy?.some(m => m.step_key === step.key));
            const usedNote = usedBy.length ? `<div class="text-muted small">${usedBy.map(s => esc(stepName(s))).join(', ')} ${usedBy.length > 1 ? 'use' : 'uses'} them too.</div>` : '';
            issues.push(p.added_products?.length
                ? `<details class="batch-issue"><summary class="text-info">${text}</summary>${upcList(p.added_products)}${usedNote}</details>`
                : `<div class="batch-issue text-info">${text}</div>${usedNote ? `<div class="batch-issue">${usedNote}</div>` : ''}`);
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
                <td class="text-end">
                    ${statusPill(BATCH_STATUS, step.status)}
                    ${canToggle && HOLDABLE.includes(step.status)
                        ? `<button type="button" class="btn btn-link btn-sm batch-step-hold" data-step-id="${step.id}" data-hold="1"><i class="fas fa-pause me-1"></i>Hold for later</button>` : ''}
                    ${canToggle && step.status === 'held'
                        ? `<button type="button" class="btn btn-link btn-sm batch-step-hold" data-step-id="${step.id}" data-hold="0"><i class="fas fa-play me-1"></i>Resume</button>` : ''}
                </td>
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
            const { runs } = await api.getBatchRuns();
            this.waiting = runs.filter(r => r.counts.held && r.status !== 'running');
            if (!this.run || this.run.status === 'draft') {
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

    async show(runId) {
        try {
            this.run = (await api.getBatchRun(runId)).run;
            this.render();
            document.querySelector('.main')?.scrollTo?.(0, 0);
            window.scrollTo(0, 0);
        } catch (error) {
            authManager.showAlert('Failed to open run: ' + error.message, 'danger');
        }
    }

    renderWaiting() {
        const others = (this.waiting || []).filter(r => r.id !== this.run?.id);
        if (!others.length) return '';
        return `
            <div class="batch-waiting mb-3">
                <div class="fw-semibold mb-2"><i class="fas fa-pause me-2"></i>Waiting for later</div>
                ${others.map(r => `
                    <div class="batch-waiting-row">
                        <span>Run #${r.id} · ${utils.formatDateTime(r.started_at || r.created_at)} ·
                            <strong>${r.counts.held}</strong> document(s) on hold</span>
                        <button class="btn btn-sm btn-outline-primary" data-open-waiting="${r.id}">Open</button>
                    </div>`).join('')}
            </div>`;
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
            <div class="batch-sales-add mb-3">
                <button type="button" class="btn btn-outline-primary" id="batchAddSalesBtn"><i class="fas fa-store me-2"></i>Add from sales</button>
                <span class="text-muted small">Pull a store's sales of last month with a sales preset</span>
            </div>
            ${this.uploading ? `<div class="batch-progress mb-3"><span class="spinner-border spinner-border-sm me-2"></span>${esc(this.uploading)}</div>` : ''}` : '';

        const notice = run?.notice ? `
            <div class="batch-banner batch-banner-danger mb-3">
                <div><div class="fw-semibold"><i class="fas fa-plug-circle-xmark me-2"></i>The run did not start</div>
                <div class="small mt-1">${esc(run.notice)}</div></div>
            </div>` : '';

        container.innerHTML = `
            ${this.renderWaiting()}
            ${notice}
            ${run && !isDraft ? this.renderResultBanner(run) : ''}
            ${dropZone}
            ${run?.files.length ? renderBatchFiles(run, { editable: isDraft, interactive: true, rules }) : ''}
            ${run?.files.length ? this.renderActionBar(run) : ''}`;

        this.bind();
    }

    renderResultBanner(run) {
        const steps = runSteps(run).filter(s => s.status !== 'excluded');
        const created = steps.filter(s => s.status === 'success').length;
        const problems = steps.filter(s => ['failed', 'blocked', 'interrupted'].includes(s.status)).length;
        const held = steps.filter(s => s.status === 'held').length;
        const heldText = held ? ` ${held} on hold for later: fix the issue, press Re-check, then Resume.` : '';
        const when = run.started_at ? utils.formatDateTime(run.started_at) : '';
        let text;
        if (run.status === 'running') {
            text = `<span class="spinner-border spinner-border-sm me-2"></span>${run.cancel_requested
                ? 'Cancelling after the current document…'
                : `Creating documents: ${created} of ${steps.length} done…`}`;
        } else if (run.status === 'cancelled') {
            text = `Cancelled. ${created} of ${steps.length} documents were created; the rest can be started again.`;
        } else if (problems) {
            text = `${created} of ${steps.length} documents created. ${problems} need attention. Read the messages below.${heldText}`;
        } else if (held) {
            text = `${created} of ${steps.length} documents created.${heldText}`;
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
                ${run.status === 'running' && !run.cancel_requested
                    ? `<button class="btn btn-outline-danger btn-sm ms-auto" id="batchCancelBtn"><i class="fas fa-stop me-2"></i>Cancel</button>` : ''}
                ${FINISHED_RUNS.includes(run.status)
                    ? `<button class="btn btn-primary ms-auto" id="batchReportBtn"><i class="fas fa-file-lines me-2"></i>View report</button>` : ''}
            </div>`;
    }

    renderActionBar(run) {
        const steps = runSteps(run);
        const todo = steps.filter(s => RETRYABLE.includes(s.status));
        const blockedCopies = todo.filter(s => s.type === 'copy' && steps.find(x => x.key === s.source_step_key && x.status === 'excluded')).length;
        const skipped = steps.filter(s => s.status === 'excluded').length;
        const held = steps.filter(s => s.status === 'held').length;
        const issues = steps.filter(s => s.status !== 'success' && (s.preview?.error || s.preview?.missing_upcs?.length)).length;
        const unassigned = run.files.filter(f => !f.error && !f.rule_id).length;

        const parts = [`${run.files.length} file(s)`, `<strong>${todo.length}</strong> document(s) to create`];
        if (skipped) parts.push(`${skipped} skipped`);
        if (held) parts.push(`<span class="text-info">${held} on hold</span>`);
        if (issues) parts.push(`<span class="text-warning">${issues} with warnings</span>`);
        if (unassigned) parts.push(`<span class="text-danger">${unassigned} file(s) without a rule</span>`);

        const isDraft = run.status === 'draft';
        const canRun = EXECUTABLE_RUNS.includes(run.status) && todo.length > 0;
        const runLabel = isDraft ? `Create ${todo.length} document(s)` : `Create ${todo.length} remaining`;
        const canRecheck = EXECUTABLE_RUNS.includes(run.status) && steps.some(s => s.status !== 'success');

        return `
            <div class="batch-action-bar">
                <div class="batch-action-summary">${run.status === 'running' ? 'Running…' : parts.join(' · ')}
                    ${blockedCopies ? `<div class="small text-warning">${blockedCopies} copy step(s) will not run because their invoice is skipped</div>` : ''}
                </div>
                <div class="d-flex flex-wrap gap-2">
                    ${canRecheck ? `<button class="btn btn-outline-secondary" id="batchRecheckBtn" title="Check everything not yet created against the databases again"><i class="fas fa-rotate-right me-2"></i>Re-check all</button>` : ''}
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
        document.querySelectorAll('.batch-step-hold').forEach(btn => btn.addEventListener('click', () =>
            this.update(() => api.setBatchStepHold(this.run.id, Number(btn.dataset.stepId), btn.dataset.hold === '1'))));
        document.querySelectorAll('.batch-recheck-file').forEach(btn => btn.addEventListener('click', () =>
            this.recheck(Number(btn.dataset.fileId))));
        document.getElementById('batchRecheckBtn')?.addEventListener('click', () => this.recheck(null));
        document.getElementById('batchAddSalesBtn')?.addEventListener('click', () => this.openSalesPicker());
        document.querySelectorAll('.batch-repull').forEach(btn => btn.addEventListener('click', () =>
            this.update(() => api.repullBatchSales(this.run.id, Number(btn.dataset.fileId)))));
        document.querySelectorAll('.batch-file-rows').forEach(btn => btn.addEventListener('click', async () => {
            const file = this.run.files.find(f => f.id === Number(btn.dataset.fileId));
            try {
                utils.downloadBlob(await api.downloadBatchFileRows(this.run.id, file.id), `${file.filename.replace(/\.xlsx?$/i, '')}.xlsx`);
            } catch (error) {
                authManager.showAlert('Download failed: ' + error.message, 'danger');
            }
        }));
        document.querySelectorAll('[data-open-waiting]').forEach(btn => btn.addEventListener('click', () =>
            this.show(Number(btn.dataset.openWaiting))));

        document.getElementById('batchExecuteBtn')?.addEventListener('click', () => this.execute());
        document.getElementById('batchDiscardBtn')?.addEventListener('click', () => this.discard());
        document.getElementById('batchNewBtn')?.addEventListener('click', async () => {
            this.run = null;
            await this.open();
        });
        document.getElementById('batchLogBtn')?.addEventListener('click', () => downloadRunLog(this.run.id));
        document.getElementById('batchReportBtn')?.addEventListener('click', () => batchHistoryManager.openReport(this.run.id));
        document.getElementById('batchCancelBtn')?.addEventListener('click', () => this.cancel());
    }

    async openSalesPicker() {
        const body = document.getElementById('batchSalesModalBody');
        body.innerHTML = '<p class="text-muted">Loading presets…</p>';
        bootstrap.Modal.getOrCreateInstance(document.getElementById('batchSalesModal')).show();
        try {
            await salesPresetManager.fetchPresets();
        } catch (error) {
            body.innerHTML = `<div class="alert alert-danger">${esc(error.message)}</div>`;
            return;
        }
        const presets = salesPresetManager.presets;
        const added = new Set((this.run?.files || []).filter(f => f.source_type === 'sales').map(f => f.preset_id));
        body.innerHTML = presets.length ? `
            <p class="mb-3">Period: <strong>${esc(salesPresetManager.periodLabel)}</strong> <span class="text-muted">(always the previous month)</span></p>
            <div class="list-group">${presets.map(p => `
                <label class="list-group-item d-flex gap-2 align-items-start">
                    <input class="form-check-input mt-1" type="checkbox" value="${p.id}" ${added.has(p.id) ? 'disabled' : 'checked'}>
                    <span>
                        <strong>${esc(p.name)}</strong>${added.has(p.id) ? ' <span class="text-muted small">(already in this run)</span>' : ''}<br>
                        <span class="text-muted small">From ${esc(batchRulesManager.databaseName(p.source_config_id))} ·
                            ${p.rule_id ? `rule ${esc(salesPresetManager.ruleName(p.rule_id) || '?')}` : 'no default rule'}</span>
                    </span>
                </label>`).join('')}
            </div>` : `
            <p>No sales presets yet.</p>
            <button class="btn btn-primary" data-bs-dismiss="modal" onclick="document.getElementById('sales-presets-tab').click()">Create a preset</button>`;

        const addBtn = document.getElementById('batchSalesAddBtn');
        addBtn.disabled = !presets.length;
        addBtn.onclick = async () => {
            const ids = [...body.querySelectorAll('input[type=checkbox]:checked:not(:disabled)')].map(b => Number(b.value));
            bootstrap.Modal.getInstance(document.getElementById('batchSalesModal'))?.hide();
            if (ids.length) await this.addSales(ids);
        };
    }

    async addSales(presetIds) {
        try {
            if (!this.run) this.run = (await api.createBatchRun()).run;
            for (let i = 0; i < presetIds.length; i++) {
                const preset = salesPresetManager.presets.find(p => p.id === presetIds[i]);
                this.uploading = `Pulling ${preset?.name || 'sales'} (${i + 1} of ${presetIds.length})…`;
                this.render();
                try {
                    this.run = (await api.addBatchSales(this.run.id, presetIds[i])).run;
                } catch (error) {
                    authManager.showAlert(`${preset?.name}: ${error.message}`, 'danger');
                }
            }
        } catch (error) {
            authManager.showAlert('Failed to start a run: ' + error.message, 'danger');
        } finally {
            this.uploading = null;
            this.render();
        }
    }

    async recheck(fileId) {
        const issues = () => runSteps(this.run).filter(s => s.status !== 'success' && (s.preview?.error || s.preview?.missing_upcs?.length)).length;
        const before = issues();
        try {
            authManager.showLoading(true);
            const response = await api.recheckBatchRun(this.run.id, fileId);
            this.run = response.run;
            const after = issues();
            const fixed = before - after;
            authManager.showAlert(
                `Re-checked ${response.checked} document(s). ${fixed > 0 ? `${fixed} problem(s) fixed. ` : ''}${after ? `${after} still need attention.` : 'No problems left.'}`,
                after ? 'warning' : 'success');
        } catch (error) {
            authManager.showAlert('Re-check failed: ' + error.message, 'danger');
        } finally {
            authManager.showLoading(false);
            this.render();
        }
    }

    async cancel() {
        if (!confirm('Stop the run after the document being created now? Everything created so far stays; the rest can be started again later.')) return;
        try {
            this.run = (await api.cancelBatchRun(this.run.id)).run;
            this.render();
        } catch (error) {
            authManager.showAlert('Failed to cancel: ' + error.message, 'danger');
        }
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
            `This will create in SQL Server (every database is checked first):`,
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
            } else if (this.run.notice) {
                authManager.showAlert('The run did not start: a database could not be reached', 'danger');
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
        document.getElementById('batch-history-tab')?.addEventListener('shown.bs.tab', () => {
            if (this.pendingReport) {
                const runId = this.pendingReport;
                this.pendingReport = null;
                this.showReport(runId);
            } else {
                this.showList();
            }
        });
    }

    openReport(runId) {
        this.pendingReport = runId;
        document.getElementById('batch-history-tab').click();
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
                                <td>${statusPill(RUN_STATUS, r.status)}${c.held ? ` <span class="text-muted small">${c.held} on hold</span>` : ''}</td>
                                <td>${r.file_count}</td>
                                <td>${c.success || 0}</td>
                                <td>${problems ? `<span class="text-danger">${problems}</span>` : '0'}</td>
                                <td class="text-end text-nowrap">
                                    ${FINISHED_RUNS.includes(r.status) ? `<button class="btn btn-sm btn-primary me-1" data-report="${r.id}">Report</button>` : ''}
                                    <button class="btn btn-sm btn-outline-secondary">Open</button>
                                </td>
                            </tr>`;
                        }).join('')}</tbody>
                    </table>
                </div>`;
            container.querySelectorAll('[data-run]').forEach(row =>
                row.addEventListener('click', () => this.showRun(Number(row.dataset.run))));
            container.querySelectorAll('[data-report]').forEach(btn => btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.showReport(Number(btn.dataset.report));
            }));
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
                        ${FINISHED_RUNS.includes(run.status) ? `<button class="btn btn-primary" id="historyReport"><i class="fas fa-table-list me-2"></i>Report</button>` : ''}
                        ${canContinue ? `<button class="btn btn-primary" id="historyOpen"><i class="fas fa-bolt me-2"></i>Open in Monthly Run</button>` : ''}
                    </div>
                </div>
                ${renderBatchFiles(run, { editable: false, interactive: false, rules: [] })}
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
            document.getElementById('historyReport')?.addEventListener('click', () => this.showReport(run.id));
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

Object.assign(BatchHistoryManager.prototype, {
    async showReport(runId) {
        const container = document.getElementById('batch-history-content');
        container.innerHTML = '<p class="text-muted">Loading report…</p>';
        try {
            const { report } = await api.getBatchRunReport(runId);
            container.innerHTML = this.renderReport(report);
            document.getElementById('reportBack').addEventListener('click', () => this.showRun(runId));
            document.getElementById('reportPrint').addEventListener('click', () => window.print());
            document.getElementById('reportExcel').addEventListener('click', async () => {
                try {
                    utils.downloadBlob(await api.downloadBatchRunReport(runId), `monthly-run-${runId}-report.xlsx`);
                } catch (error) {
                    authManager.showAlert('Failed to download report: ' + error.message, 'danger');
                }
            });
        } catch (error) {
            container.innerHTML = `<div class="alert alert-danger">Failed to load report: ${esc(error.message)}</div>`;
        }
    },

    renderReport(report) {
        const run = report.run;
        const t = report.totals;
        const kpi = (label, count, total, cls = '') => `
            <div class="report-kpi ${cls}">
                <div class="report-kpi-label">${label}</div>
                <div class="report-kpi-value">${count}</div>
                ${total != null ? `<div class="report-kpi-sub">${money(total)}</div>` : ''}
                ${label === 'Not created' && report.on_hold ? `<div class="report-kpi-sub">${report.on_hold} on hold for later</div>` : ''}
            </div>`;
        const notes = (d) => d.notes.length ? d.notes.map(n => `<div class="small text-muted">${esc(n)}</div>`).join('') : '';

        const byDatabase = report.by_database.map(group => `
            <section class="report-section">
                <h5 class="report-db"><i class="fas fa-database me-2"></i>${esc(group.database)}</h5>
                ${group.sections.map(sec => `
                    <div class="report-subhead">
                        <strong>${sec.label}</strong>
                        <span class="text-muted">${sec.count} · ${sec.first === sec.last ? `#${esc(sec.first)}` : `#${esc(sec.first)} – #${esc(sec.last)}`}</span>
                    </div>
                    <div class="table-responsive">
                        <table class="table report-table">
                            <thead><tr><th class="report-col-number">Number</th><th>${sec.type === 'po' ? 'Supplier' : 'Customer'}</th>
                                ${sec.type === 'copy' ? '<th>Copied from</th>' : ''}<th>File</th><th class="text-end report-col-lines">Lines</th><th class="text-end report-col-total">Total</th></tr></thead>
                            <tbody>${sec.documents.map(d => `
                                <tr>
                                    <td><strong>#${esc(d.number)}</strong></td>
                                    <td>${esc(d.party)}${d.account_no ? ` <span class="text-muted small">${esc(d.account_no)}</span>` : ''}${notes(d)}</td>
                                    ${sec.type === 'copy' ? `<td>${esc(d.copied_from)}</td>` : ''}
                                    <td class="small">${esc(d.file)}</td>
                                    <td class="text-end">${d.lines}</td>
                                    <td class="text-end">${money(d.total)}</td>
                                </tr>`).join('')}
                            </tbody>
                            <tfoot><tr><td colspan="${sec.type === 'copy' ? 5 : 4}" class="text-end">Total ${sec.label.toLowerCase()}</td><td class="text-end">${money(sec.total)}</td></tr></tfoot>
                        </table>
                    </div>`).join('')}
            </section>`).join('');

        const byFile = `
            <div class="table-responsive">
                <table class="table report-table">
                    <thead><tr><th>File</th><th>Rule</th><th>Created</th><th class="text-end">Problems</th></tr></thead>
                    <tbody>${report.by_file.map(f => `
                        <tr>
                            <td>${esc(f.file)}</td>
                            <td>${esc(f.rule)}</td>
                            <td>${f.documents.map(d => `<span class="report-chip">${esc(d.type_label)} · ${esc(d.database)} <strong>#${esc(d.number)}</strong></span>`).join(' ') || '<span class="text-muted">Nothing</span>'}</td>
                            <td class="text-end">${f.problems ? `<span class="text-danger">${f.problems}</span>` : '0'}</td>
                        </tr>`).join('')}
                    </tbody>
                </table>
            </div>`;

        const notCreated = report.not_created.length ? `
            <section class="report-section">
                <h5 class="report-db text-danger"><i class="fas fa-circle-exclamation me-2"></i>Not created (${report.not_created.length})</h5>
                <div class="table-responsive">
                    <table class="table report-table">
                        <thead><tr><th>File</th><th>Document</th><th>Database</th><th>Customer / Supplier</th><th>Status</th><th>Reason</th></tr></thead>
                        <tbody>${report.not_created.map(p => `
                            <tr><td class="small">${esc(p.file)}</td><td>${esc(p.document)}</td><td>${esc(p.database)}</td>
                                <td>${esc(p.party)}</td><td>${esc(p.status)}</td><td class="small">${esc(p.reason)}</td></tr>`).join('')}
                        </tbody>
                    </table>
                </div>
            </section>` : '';

        const skipped = report.skipped_upcs.length ? `
            <section class="report-section">
                <h5 class="report-db"><i class="fas fa-barcode me-2"></i>UPCs not found, lines skipped (${report.skipped_upcs.length})</h5>
                <div class="table-responsive">
                    <table class="table report-table">
                        <thead><tr><th>UPC</th><th class="text-end">Qty</th><th>Excel row</th><th>Document</th><th>Database</th><th>File</th></tr></thead>
                        <tbody>${report.skipped_upcs.map(u => `
                            <tr><td><code>${esc(u.upc)}</code></td><td class="text-end">${esc(u.qty ?? '')}</td><td>${esc(u.row ?? '')}</td>
                                <td>${esc(u.document)}</td><td>${esc(u.database)}</td><td class="small">${esc(u.file)}</td></tr>`).join('')}
                        </tbody>
                    </table>
                </div>
            </section>` : '';

        return `
            <div class="report">
                <div class="d-flex flex-wrap align-items-center gap-2 mb-3 no-print">
                    <button class="btn btn-outline-secondary" id="reportBack"><i class="fas fa-arrow-left me-2"></i>Run details</button>
                    <div class="ms-auto d-flex gap-2">
                        <button class="btn btn-outline-secondary" id="reportPrint"><i class="fas fa-print me-2"></i>Print</button>
                        <button class="btn btn-primary" id="reportExcel"><i class="fas fa-file-excel me-2"></i>Download Excel</button>
                    </div>
                </div>
                <div class="report-title">
                    <h2 class="mb-1">Monthly run #${run.id} report</h2>
                    <div class="text-muted">${utils.formatDateTime(run.started_at || run.created_at)} · ${statusPill(RUN_STATUS, run.status)}</div>
                </div>
                <div class="report-kpis">
                    ${kpi('Invoices', t.invoice.count, t.invoice.total)}
                    ${kpi('Invoice copies', t.copy.count, t.copy.total)}
                    ${kpi('Purchase orders', t.po.count, t.po.total)}
                    ${kpi('Not created', report.not_created.length, null, report.not_created.length > report.on_hold ? 'is-problem' : '')}
                </div>
                ${notCreated}
                ${byDatabase || '<p class="text-muted">No documents were created.</p>'}
                <section class="report-section">
                    <h5 class="report-db"><i class="fas fa-file-excel me-2"></i>By file</h5>
                    ${byFile}
                </section>
                ${skipped}
            </div>`;
    }
});

const batchRulesManager = new BatchRulesManager();
const monthlyRunManager = new MonthlyRunManager();
const batchHistoryManager = new BatchHistoryManager();
