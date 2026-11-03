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
        el.innerHTML = renderSalesSummary(this.testResult.summary, { kind: 'test' }) + `
            <div class="table-responsive preset-test-table">
                <table class="table table-sm">
                    <thead><tr><th>UPC</th><th>Product</th><th class="text-end">Cost</th><th class="text-end">Sold</th><th class="text-end">Credited</th><th class="text-end">Qty</th></tr></thead>
                    <tbody>${this.testResult.rows.map(r => `
                        <tr><td><code>${esc(r.UPC)}</code></td><td>${esc(r.description)}</td><td class="text-end">${money(r.Cost)}</td>
                            <td class="text-end">${r.sold}</td><td class="text-end">${r.credited
                                ? `<button type="button" class="btn btn-link btn-sm p-0" data-credit-memos="test" data-upc="${esc(r.UPC)}" title="See the credit memos">${r.credited}</button>` : ''}</td><td class="text-end"><strong>${r.QTY}</strong></td></tr>`).join('')}
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

// Summary of a sales pull (preset test and Monthly Run card).
// context says where its credit memos can be loaded from: {kind: 'test'} or {kind: 'file', runId, fileId}
function renderSalesSummary(summary, context = null) {
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
    const creditCount = (summary.credits_applied?.length || 0) + (summary.credits_without_sales?.length || 0)
        + (summary.credits_excluded?.length || 0);
    const credits = summary.credits_applied?.length ? `${summary.credits_applied.length} product(s) reduced by credit memos` : 'no credit memos subtracted';
    const memoButton = context && creditCount ? `<button type="button" class="btn btn-sm btn-outline-secondary sales-memo-btn" data-credit-memos="${context.kind}"
        ${context.runId ? `data-run="${context.runId}" data-file="${context.fileId}"` : ''}><i class="fas fa-file-invoice me-1"></i>View credit memos</button>` : '';
    return `
        <div class="sales-summary">
            <div><i class="fas fa-store me-2"></i>${esc(summary.period_label)}${summary.source_db ? ` · ${esc(summary.source_db)}` : ''} · ${parts.join(' · ')}</div>
            <div class="text-muted small">${summary.sale_lines} sale line group(s) read · ${credits}${left.length ? ` · left out: ${left.join(', ')}` : ''}${memoButton}</div>
            ${(summary.notes || []).map(n => `<div class="batch-note batch-note-warning"><i class="fas fa-triangle-exclamation"></i>${esc(n)}</div>`).join('')}
        </div>`;
}

// Credit memo viewer: what each credit memo holds and what the pull did with it
const creditMemoViewer = {
    async open(context, summary, upc = '') {
        this.summary = summary || {};
        this.filter = 'all';
        this.search = upc;
        const body = document.getElementById('creditMemoModalBody');
        document.getElementById('creditMemoModalTitle').textContent = `Credit memos · ${this.summary.period_label || ''}`;
        body.innerHTML = '<p class="text-muted"><span class="spinner-border spinner-border-sm me-2"></span>Loading credit memos…</p>';
        bootstrap.Modal.getOrCreateInstance(document.getElementById('creditMemoModal')).show();
        try {
            const response = context.kind === 'test'
                ? await api.getTestCreditMemos(salesPresetManager.payload())
                : await api.getBatchFileCreditMemos(context.runId, context.fileId);
            this.memos = response.memos;
            this.render();
        } catch (error) {
            body.innerHTML = `<div class="alert alert-danger">Could not load credit memos: ${esc(error.message)}</div>`;
        }
    },

    outcomes() {
        const s = this.summary;
        const map = {};
        (s.credits_applied || []).forEach(c => { map[c.upc] = { kind: 'applied', ...c }; });
        (s.credits_without_sales || []).forEach(c => { map[c.upc] = { kind: 'nosales', ...c }; });
        (s.credits_excluded || []).forEach(c => { map[c.upc] = { kind: 'excluded', ...c }; });
        const dropped = {};
        (s.dropped || []).forEach(d => { (dropped[d.upc] = dropped[d.upc] || []).push(d); });
        return { map, dropped };
    },

    describe(upc, lineQty, { map, dropped }) {
        const o = map[upc];
        if (!o) return { kind: 'unused', text: 'Not used: zero quantity or not in this pull' };
        const all = o.qty !== lineQty ? ` (${o.qty} credited for this product in all memos)` : '';
        if (o.kind === 'excluded') return { kind: 'excluded', text: `Left out: the product is excluded by the preset${all}` };
        if (o.kind === 'nosales') return { kind: 'nosales', text: `Ignored: the product had no sales this month${all}` };
        const parts = (o.allocations || []).map(a => `${a.qty} off the ${money(a.cost)} line`);
        let text = `Subtracted${all}: ${parts.join(', ') || o.qty}`;
        if (o.over) text += `. Credits exceed sales by ${o.over}`;
        if (dropped[upc]) text += `. Dropped: ${dropped[upc].map(d => `${money(d.cost)} line`).join(', ')} (nothing left after credits)`;
        return { kind: dropped[upc] ? 'dropped' : 'applied', text };
    },

    render() {
        const body = document.getElementById('creditMemoModalBody');
        const outcomes = this.outcomes();
        const term = this.search.trim().toLowerCase();
        const filters = [['all', 'All'], ['applied', 'Subtracted'], ['dropped', 'Dropped a line'], ['nosales', 'No sales'], ['excluded', 'Left out']];

        const memos = this.memos.map(m => ({
            ...m,
            lines: m.lines.map(l => ({ ...l, outcome: this.describe(l.upc, l.qty, outcomes) }))
        })).map(m => {
            const memoMatches = !term || [m.number, m.account_no, m.business_name].some(v => String(v).toLowerCase().includes(term));
            const lines = m.lines.filter(l =>
                (this.filter === 'all' || l.outcome.kind === this.filter) &&
                (memoMatches || l.upc.toLowerCase().includes(term) || l.description.toLowerCase().includes(term)));
            return { ...m, shown: lines };
        }).filter(m => m.shown.length);

        const totalLines = this.memos.reduce((n, m) => n + m.lines.length, 0);
        const totalQty = this.memos.reduce((n, m) => n + m.lines.reduce((q, l) => q + l.qty, 0), 0);
        const cls = { applied: 'success', dropped: 'warning', nosales: 'warning', excluded: 'muted', unused: 'muted' };

        body.innerHTML = `
            <div class="memo-toolbar">
                <div class="text-muted small"><strong>${this.memos.length}</strong> credit memo(s) · ${totalLines} line(s) · qty ${Math.round(totalQty * 100) / 100}
                    <span class="d-block">Only memos in the preset's subcategories and not from excluded accounts are counted.</span></div>
                <input class="form-control form-control-sm" id="memoSearch" placeholder="Search memo #, account, UPC or product" value="${esc(this.search)}">
                <div class="btn-group btn-group-sm">${filters.map(([key, label]) =>
                    `<button type="button" class="btn ${this.filter === key ? 'btn-primary' : 'btn-outline-secondary'}" data-memo-filter="${key}">${label}</button>`).join('')}</div>
            </div>
            ${memos.length ? memos.map(m => `
                <div class="memo-card">
                    <div class="memo-head">
                        <strong>Credit memo #${esc(m.number)}</strong>
                        <span class="text-muted">${esc(m.date)}</span>
                        <span>${esc(m.account_no)} ${m.business_name ? `— ${esc(m.business_name)}` : ''}</span>
                        <span class="ms-auto text-muted small">Memo total ${money(m.total)}</span>
                    </div>
                    <div class="table-responsive">
                        <table class="table table-sm mb-0 memo-table">
                            <thead><tr><th>UPC</th><th>Product</th><th class="text-end">Qty</th><th class="text-end">Price</th><th>In this pull</th></tr></thead>
                            <tbody>${m.shown.map(l => `
                                <tr>
                                    <td><code>${esc(l.upc)}</code></td>
                                    <td>${esc(l.description)}</td>
                                    <td class="text-end">${l.qty}</td>
                                    <td class="text-end">${money(l.unit_price)}</td>
                                    <td><span class="status-pill status-${cls[l.outcome.kind]}">${esc(l.outcome.text)}</span></td>
                                </tr>`).join('')}
                            </tbody>
                        </table>
                    </div>
                </div>`).join('') : '<p class="text-muted">No credit memos match.</p>'}`;

        const search = body.querySelector('#memoSearch');
        search.addEventListener('input', utils.debounce(() => {
            this.search = search.value;
            this.render();
            const again = document.getElementById('memoSearch');
            again.focus();
            again.setSelectionRange(again.value.length, again.value.length);
        }, 200));
        body.querySelectorAll('[data-memo-filter]').forEach(b => b.addEventListener('click', () => {
            this.filter = b.dataset.memoFilter;
            this.render();
        }));
    }
};

// The credit memo modal can open on top of the preset editor; closing it must leave the editor's page lock in place
document.getElementById('creditMemoModal')?.addEventListener('hidden.bs.modal', () => {
    if (document.querySelector('.modal.show')) document.body.classList.add('modal-open');
});

document.addEventListener('click', (e) => {
    const trigger = e.target.closest('[data-credit-memos]');
    if (!trigger) return;
    e.preventDefault();
    if (trigger.dataset.creditMemos === 'test') {
        creditMemoViewer.open({ kind: 'test' }, salesPresetManager.testResult?.summary, trigger.dataset.upc || '');
        return;
    }
    const runId = Number(trigger.dataset.run);
    const fileId = Number(trigger.dataset.file);
    const run = [monthlyRunManager.run, batchHistoryManager.current].find(r => r?.id === runId);
    const file = run?.files.find(f => f.id === fileId);
    creditMemoViewer.open({ kind: 'file', runId, fileId }, file?.source, trigger.dataset.upc || '');
});

const salesPresetManager = new SalesPresetManager();
