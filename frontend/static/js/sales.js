// Sales presets: which sales of a store database (previous month) feed a rule

class SalesPresetManager {
    constructor() {
        this.presets = [];
        this.period = null;
        this.periodLabel = '';
        this.editing = null;
        this.tree = null;
        this.treeFor = null;
        this.search = '';
        this.init();
    }

    init() {
        document.getElementById('sales-presets-tab')?.addEventListener('shown.bs.tab', () => this.load());
        document.getElementById('newSalesPresetBtn')?.addEventListener('click', () => this.openEditor(null));
        document.getElementById('saveSalesPresetBtn')?.addEventListener('click', () => this.save());
        document.getElementById('testSalesPresetBtn')?.addEventListener('click', () => this.test());
    }

    async fetchPresets() {
        const response = await api.getSalesPresets();
        this.presets = response.presets;
        this.period = response.period;
        this.periodLabel = response.period_label;
        return this.presets;
    }

    async load() {
        const container = document.getElementById('sales-presets-content');
        try {
            await Promise.all([this.fetchPresets(), batchRulesManager.fetchRules()]);
            this.renderList();
        } catch (error) {
            container.innerHTML = `<div class="alert alert-danger">Failed to load presets: ${esc(error.message)}</div>`;
        }
    }

    ruleName(id) {
        return batchRulesManager.rules.find(r => r.id === id)?.name;
    }

    renderList() {
        const container = document.getElementById('sales-presets-content');
        if (!this.presets.length) {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon"><i class="fas fa-store"></i></div>
                    <h5>No sales presets yet</h5>
                    <p>A preset pulls one store's sales of the previous month: the subcategories you choose, minus excluded
                       products, words and accounts, minus credit memos, at cost. In the Monthly Run it works like an Excel file.</p>
                    <button class="btn btn-primary" onclick="salesPresetManager.openEditor(null)"><i class="fas fa-plus me-2"></i>Create the first preset</button>
                </div>`;
            return;
        }
        container.innerHTML = `<div class="batch-rule-list">${this.presets.map(p => {
            const rule = this.ruleName(p.rule_id);
            const exclusions = [
                p.exclude_upcs.length ? `${p.exclude_upcs.length} product(s)` : '',
                p.exclude_words.length ? `words: ${p.exclude_words.map(w => `<code>${esc(w)}</code>`).join(', ')}` : '',
                p.exclude_accounts.length ? `accounts: ${p.exclude_accounts.map(esc).join(', ')}` : ''
            ].filter(Boolean);
            return `
            <div class="card batch-rule-card">
                <div class="card-body">
                    <div class="batch-rule-head">
                        <div>
                            <h5 class="card-title mb-1">${esc(p.name)}</h5>
                            <div class="text-muted small">From <strong>${esc(batchRulesManager.databaseName(p.source_config_id))}</strong> ·
                                ${p.subcategory_ids.length} subcategory(ies) ·
                                ${rule ? `rule <strong>${esc(rule)}</strong>` : 'no default rule'}</div>
                            ${exclusions.length ? `<div class="text-muted small mt-1">Excludes ${exclusions.join(' · ')}</div>` : ''}
                        </div>
                        <div class="d-flex gap-2">
                            <button class="btn btn-sm btn-outline-secondary" data-edit-preset="${p.id}"><i class="fas fa-pen me-1"></i>Edit</button>
                            <button class="btn btn-sm btn-outline-secondary" data-copy-preset="${p.id}" title="Duplicate"><i class="fas fa-clone"></i></button>
                            <button class="btn btn-sm btn-outline-secondary text-danger" data-delete-preset="${p.id}" title="Delete"><i class="fas fa-trash"></i></button>
                        </div>
                    </div>
                </div>
            </div>`;
        }).join('')}</div>`;

        container.querySelectorAll('[data-edit-preset]').forEach(b => b.addEventListener('click', () =>
            this.openEditor(this.presets.find(p => p.id === Number(b.dataset.editPreset)))));
        container.querySelectorAll('[data-copy-preset]').forEach(b => b.addEventListener('click', () => {
            const preset = this.presets.find(p => p.id === Number(b.dataset.copyPreset));
            this.openEditor({ ...preset, id: null, name: `${preset.name} (copy)` });
        }));
        container.querySelectorAll('[data-delete-preset]').forEach(b => b.addEventListener('click', () =>
            this.remove(Number(b.dataset.deletePreset))));
    }

    async openEditor(preset) {
        if (!databaseManager.getDatabaseOptions().length) {
            authManager.showAlert('Add a database first (Databases tab)', 'warning');
            return;
        }
        await batchRulesManager.fetchRules().catch(() => {});
        this.editing = preset
            ? JSON.parse(JSON.stringify(preset))
            : { id: null, name: '', source_config_id: null, rule_id: null, subcategory_ids: [], known_subcategory_ids: [],
                exclude_upcs: [], exclude_words: [], exclude_accounts: [] };
        this.selected = new Set(this.editing.subcategory_ids);
        this.search = '';
        this.testResult = null;
        document.getElementById('salesPresetModalTitle').textContent = this.editing.id ? 'Edit Preset' : 'New Preset';
        this.renderEditor();
        bootstrap.Modal.getOrCreateInstance(document.getElementById('salesPresetModal')).show();
        if (this.editing.source_config_id) this.loadTree();
    }

    async loadTree() {
        const configId = this.editing.source_config_id;
        this.tree = null;
        this.treeError = null;
        this.treeFor = configId;
        this.renderTree();
        try {
            const tree = await api.getSourceCategories(configId);
            if (this.treeFor !== configId) return;
            this.tree = tree;
        } catch (error) {
            this.treeError = error.message;
        }
        this.renderTree();
    }

    renderEditor() {
        const p = this.editing;
        const body = document.getElementById('salesPresetModalBody');
        const dbOptions = databaseManager.getDatabaseOptions();
        body.innerHTML = `
            <div id="salesPresetErrors"></div>
            <div class="row g-3 mb-4">
                <div class="col-md-4">
                    <label class="form-label" for="presetName">Preset name</label>
                    <input class="form-control" id="presetName" value="${esc(p.name)}" placeholder="e.g. Store 2 snacks">
                </div>
                <div class="col-md-4">
                    <label class="form-label" for="presetSource">Pull sales from</label>
                    <select class="form-select" id="presetSource">
                        <option value="">Choose a database…</option>
                        ${dbOptions.map(d => `<option value="${d.id}" ${d.id === p.source_config_id ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}
                    </select>
                </div>
                <div class="col-md-4">
                    <label class="form-label" for="presetRule">Then create with rule</label>
                    <select class="form-select" id="presetRule">
                        <option value="">Choose in the Monthly Run</option>
                        ${batchRulesManager.rules.map(r => `<option value="${r.id}" ${r.id === p.rule_id ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}
                    </select>
                </div>
            </div>

            <div class="form-section-title">Subcategories to include</div>
            <div id="presetTree" class="preset-tree mb-4"></div>

            <div class="form-section-title">Leave out</div>
            <div class="row g-3 mb-3">
                <div class="col-md-4">
                    <label class="form-label">Products whose name contains</label>
                    <div class="chip-input" data-chips="exclude_words"></div>
                    <input class="form-control form-control-sm mt-2" id="presetWordInput" placeholder="Type a word and press Enter">
                </div>
                <div class="col-md-4">
                    <label class="form-label">Products</label>
                    <div class="chip-input" data-chips="exclude_upcs"></div>
                    <input class="form-control form-control-sm mt-2" id="presetItemInput" placeholder="Search name or UPC, or type a UPC + Enter" ${p.source_config_id ? '' : 'disabled'}>
                    <div class="rule-party-results" id="presetItemResults"></div>
                </div>
                <div class="col-md-4">
                    <label class="form-label">Customer accounts</label>
                    <div class="chip-input" data-chips="exclude_accounts"></div>
                    <input class="form-control form-control-sm mt-2" id="presetAccountInput" placeholder="Search account, or type it + Enter" ${p.source_config_id ? '' : 'disabled'}>
                    <div class="rule-party-results" id="presetAccountResults"></div>
                </div>
            </div>
            <div class="form-text mb-3">Every pull is for the previous calendar month${this.periodLabel ? ` (now: <strong>${esc(this.periodLabel)}</strong>)` : ''}.
                Quantities are units sold minus credit memos; each different cost is its own line.</div>

            <div id="presetTestResult"></div>`;

        body.querySelector('#presetName').addEventListener('input', e => { p.name = e.target.value; });
        body.querySelector('#presetRule').addEventListener('change', e => { p.rule_id = e.target.value ? Number(e.target.value) : null; });
        body.querySelector('#presetSource').addEventListener('change', e => {
            const id = e.target.value ? Number(e.target.value) : null;
            if (id !== p.source_config_id && this.selected.size &&
                !confirm('Subcategory IDs differ between databases. Clear the selected subcategories?')) {
                e.target.value = p.source_config_id || '';
                return;
            }
            p.source_config_id = id;
            this.selected = new Set();
            this.renderEditor();
            if (id) this.loadTree();
        });

        this.renderChips();
        this.bindChipInput('presetWordInput', 'exclude_words');
        this.bindSearchInput('presetItemInput', 'presetItemResults', 'exclude_upcs',
            term => api.searchSourceItems(p.source_config_id, term).then(r => r.items.map(i => ({
                value: String(i.ProductUPC || '').trim(), label: `${String(i.ProductUPC || '').trim()} — ${i.ProductDescription || ''}`
            }))));
        this.bindSearchInput('presetAccountInput', 'presetAccountResults', 'exclude_accounts',
            term => api.searchCustomers({ database_config_id: p.source_config_id, search_term: term }).then(r => r.customers.map(c => ({
                value: c.AccountNo, label: `${c.AccountNo} — ${c.BusinessName || ''}`
            }))));
        this.renderTree();
        this.renderTestResult();
    }

    renderChips() {
        document.querySelectorAll('#salesPresetModalBody [data-chips]').forEach(box => {
            const field = box.dataset.chips;
            const values = this.editing[field];
            box.innerHTML = values.length
                ? values.map((v, i) => `<span class="chip">${esc(v)}<button type="button" data-remove-chip="${i}" aria-label="Remove">&times;</button></span>`).join('')
                : '<span class="text-muted small">None</span>';
            box.querySelectorAll('[data-remove-chip]').forEach(b => b.addEventListener('click', () => {
                values.splice(Number(b.dataset.removeChip), 1);
                this.renderChips();
            }));
        });
    }

    addChip(field, value) {
        const v = String(value || '').trim();
        if (v && !this.editing[field].includes(v)) this.editing[field].push(v);
        this.renderChips();
    }

    bindChipInput(inputId, field) {
        const input = document.getElementById(inputId);
        input.addEventListener('keydown', e => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            this.addChip(field, input.value);
            input.value = '';
        });
    }

    bindSearchInput(inputId, resultsId, field, search) {
        const input = document.getElementById(inputId);
        const results = document.getElementById(resultsId);
        const run = utils.debounce(async () => {
            const term = input.value.trim();
            if (term.length < 2) { results.innerHTML = ''; return; }
            try {
                const found = await search(term);
                results.innerHTML = found.length
                    ? `<div class="list-group">${found.slice(0, 15).map((f, i) =>
                        `<button type="button" class="list-group-item list-group-item-action small" data-pick="${i}">${esc(f.label)}</button>`).join('')}</div>`
                    : '<div class="text-muted small p-2">Nothing found. Press Enter to add it as typed.</div>';
                results.querySelectorAll('[data-pick]').forEach(b => b.addEventListener('click', () => {
                    this.addChip(field, found[Number(b.dataset.pick)].value);
                    input.value = '';
                    results.innerHTML = '';
                }));
            } catch (error) {
                results.innerHTML = `<div class="text-danger small p-2">Search failed: ${esc(error.message)}</div>`;
            }
        }, 300);
        input.addEventListener('input', run);
        input.addEventListener('keydown', e => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            this.addChip(field, input.value);
            input.value = '';
            results.innerHTML = '';
        });
    }

    renderTree() {
        const el = document.getElementById('presetTree');
        if (!el) return;
        if (!this.editing.source_config_id) {
            el.innerHTML = '<p class="text-muted mb-0">Choose the store database first.</p>';
            return;
        }
        if (this.treeError) {
            el.innerHTML = `<div class="alert alert-danger mb-0">Could not load categories: ${esc(this.treeError)}</div>`;
            return;
        }
        if (!this.tree) {
            el.innerHTML = '<p class="text-muted mb-0"><span class="spinner-border spinner-border-sm me-2"></span>Loading categories…</p>';
            return;
        }

        const term = this.search.toLowerCase();
        const subsByCategory = {};
        this.tree.subcategories.forEach(s => { (subsByCategory[s.category_id] = subsByCategory[s.category_id] || []).push(s); });
        const known = new Set(this.editing.known_subcategory_ids);
        const groups = this.tree.categories
            .map(c => ({ ...c, subs: (subsByCategory[c.id] || []).sort((a, b) => a.name.localeCompare(b.name)) }))
            .filter(c => c.subs.length)
            .sort((a, b) => a.name.localeCompare(b.name))
            .map(c => {
                const matchesCategory = !term || c.name.toLowerCase().includes(term);
                const shown = matchesCategory ? c.subs : c.subs.filter(s => s.name.toLowerCase().includes(term));
                return { ...c, shown };
            })
            .filter(c => c.shown.length);

        const total = this.tree.subcategories.length;
        el.innerHTML = `
            <div class="preset-tree-toolbar">
                <input class="form-control form-control-sm" id="presetTreeSearch" placeholder="Filter categories and subcategories" value="${esc(this.search)}">
                <span class="text-muted small text-nowrap"><strong>${this.selected.size}</strong> of ${total} selected</span>
                <button type="button" class="btn btn-sm btn-outline-secondary" data-tree-all="1">Select ${term ? 'shown' : 'all'}</button>
                <button type="button" class="btn btn-sm btn-outline-secondary" data-tree-all="0">Clear ${term ? 'shown' : 'all'}</button>
            </div>
            <div class="preset-tree-list">${groups.map(c => {
                const picked = c.subs.filter(s => this.selected.has(s.id)).length;
                const open = term || (picked > 0 && picked < c.subs.length);
                return `
                <details class="preset-cat" ${open ? 'open' : ''}>
                    <summary>
                        <input type="checkbox" class="form-check-input" data-cat="${c.id}" ${picked === c.subs.length ? 'checked' : ''}
                            ${picked > 0 && picked < c.subs.length ? 'data-partial="1"' : ''} aria-label="Select all of ${esc(c.name)}">
                        <span class="preset-cat-name">${esc(c.name)}</span>
                        <span class="text-muted small">${picked} / ${c.subs.length}</span>
                    </summary>
                    <div class="preset-subs">${c.shown.map(s => `
                        <label class="preset-sub">
                            <input type="checkbox" class="form-check-input" data-sub="${s.id}" ${this.selected.has(s.id) ? 'checked' : ''}>
                            <span>${esc(s.name)}</span>
                            ${known.size && !known.has(s.id) ? '<span class="badge-new">new</span>' : ''}
                        </label>`).join('')}
                    </div>
                </details>`;
            }).join('') || '<p class="text-muted mb-0">Nothing matches.</p>'}</div>`;

        el.querySelectorAll('[data-partial]').forEach(box => { box.indeterminate = true; });
        const search = el.querySelector('#presetTreeSearch');
        search.addEventListener('input', utils.debounce(() => {
            this.search = search.value;
            this.renderTree();
            const again = document.getElementById('presetTreeSearch');
            again.focus();
            again.setSelectionRange(again.value.length, again.value.length);
        }, 200));
        el.querySelectorAll('[data-cat]').forEach(box => {
            box.addEventListener('click', e => e.stopPropagation());
            box.addEventListener('change', () => {
                const subs = subsByCategory[Number(box.dataset.cat)] || [];
                subs.forEach(s => box.checked ? this.selected.add(s.id) : this.selected.delete(s.id));
                this.renderTree();
            });
        });
        el.querySelectorAll('[data-sub]').forEach(box => box.addEventListener('change', () => {
            const id = Number(box.dataset.sub);
            box.checked ? this.selected.add(id) : this.selected.delete(id);
            this.renderTree();
        }));
        el.querySelectorAll('[data-tree-all]').forEach(b => b.addEventListener('click', () => {
            const on = b.dataset.treeAll === '1';
            groups.flatMap(g => g.shown).forEach(s => on ? this.selected.add(s.id) : this.selected.delete(s.id));
            this.renderTree();
        }));
    }

    payload() {
        const p = this.editing;
        return {
            ...p,
            subcategory_ids: [...this.selected],
            known_subcategory_ids: this.tree ? this.tree.subcategories.map(s => s.id) : p.known_subcategory_ids
        };
    }

    async test() {
        const result = document.getElementById('presetTestResult');
        result.innerHTML = '<p class="text-muted"><span class="spinner-border spinner-border-sm me-2"></span>Pulling last month\'s sales…</p>';
        result.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        try {
            this.testResult = await api.testSalesPreset(this.payload());
            this.testError = null;
        } catch (error) {
            this.testResult = null;
            this.testError = error.message;
        }
        this.renderTestResult();
    }

    renderTestResult() {
        const el = document.getElementById('presetTestResult');
        if (!el) return;
        if (this.testError) {
            el.innerHTML = `<div class="alert alert-danger">${esc(this.testError).replace(/; /g, '<br>')}</div>`;
            return;
        }
        if (!this.testResult) { el.innerHTML = ''; return; }
        el.innerHTML = renderSalesSummary(this.testResult.summary) + `
            <div class="table-responsive preset-test-table">
                <table class="table table-sm">
                    <thead><tr><th>UPC</th><th>Product</th><th class="text-end">Cost</th><th class="text-end">Sold</th><th class="text-end">Credited</th><th class="text-end">Qty</th></tr></thead>
                    <tbody>${this.testResult.rows.map(r => `
                        <tr><td><code>${esc(r.UPC)}</code></td><td>${esc(r.description)}</td><td class="text-end">${money(r.Cost)}</td>
                            <td class="text-end">${r.sold}</td><td class="text-end">${r.credited || ''}</td><td class="text-end"><strong>${r.QTY}</strong></td></tr>`).join('')}
                    </tbody>
                </table>
            </div>
            ${this.testResult.summary.rows > this.testResult.rows.length ? `<p class="text-muted small">Showing the first ${this.testResult.rows.length} of ${this.testResult.summary.rows} lines.</p>` : ''}`;
    }

    async save() {
        const errorsEl = document.getElementById('salesPresetErrors');
        try {
            await api.saveSalesPreset(this.payload());
            bootstrap.Modal.getInstance(document.getElementById('salesPresetModal'))?.hide();
            authManager.showAlert('Preset saved', 'success');
            await this.load();
        } catch (error) {
            errorsEl.innerHTML = `<div class="alert alert-danger">${esc(error.message).replace(/; /g, '<br>')}</div>`;
            document.getElementById('salesPresetModalBody').scrollTop = 0;
        }
    }

    async remove(presetId) {
        const preset = this.presets.find(p => p.id === presetId);
        if (!confirm(`Delete preset "${preset?.name}"? Past runs keep their history.`)) return;
        try {
            await api.deleteSalesPreset(presetId);
            await this.load();
        } catch (error) {
            authManager.showAlert('Failed to delete preset: ' + error.message, 'danger');
        }
    }
}

// Summary of a sales pull (preset test and Monthly Run card)
function renderSalesSummary(summary) {
    const parts = [
        `<strong>${summary.rows}</strong> line(s)`,
        `${summary.products} product(s)`,
        `qty ${summary.total_qty}`,
        `cost ${money(summary.total_cost)}`
    ];
    const left = [];
    if (summary.excluded_by_upc?.length) left.push(`${summary.excluded_by_upc.length} by product`);
    if (summary.excluded_by_word?.length) left.push(`${summary.excluded_by_word.length} by word`);
    if (summary.excluded_accounts?.length) left.push(`accounts ${summary.excluded_accounts.map(esc).join(', ')}`);
    const credits = summary.credits_applied?.length ? `${summary.credits_applied.length} product(s) reduced by credit memos` : 'no credit memos';
    return `
        <div class="sales-summary">
            <div><i class="fas fa-store me-2"></i>${esc(summary.period_label)}${summary.source_db ? ` · ${esc(summary.source_db)}` : ''} · ${parts.join(' · ')}</div>
            <div class="text-muted small">${summary.sale_lines} sale line group(s) read · ${credits}${left.length ? ` · left out: ${left.join(', ')}` : ''}</div>
            ${(summary.notes || []).map(n => `<div class="batch-note batch-note-warning"><i class="fas fa-triangle-exclamation"></i>${esc(n)}</div>`).join('')}
        </div>`;
}

const salesPresetManager = new SalesPresetManager();
