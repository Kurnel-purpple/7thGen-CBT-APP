/**
 * Master Admin dashboard.
 * Platform-level page where the super_admin manages every tenant on the platform.
 *
 * Loaded by /pages/master-admin.html. Requires window.dataService and tenantService
 * to already be loaded.
 */

(function (global) {
    'use strict';

    // The full set of modules the platform knows about. Keep this in sync
    // with src/core/modules/builtinManifests.js — both lists live by hand
    // because builtinManifests imports the module manifest .js files (ESM)
    // and this file is a classic script.
    const KNOWN_MODULES = [
        { id: 'cbt', name: 'CBT / Exams', description: 'Computer-based testing, exam creation, results' },
        { id: 'attendance', name: 'Attendance', description: 'Daily attendance, sheets, student registration' },
        { id: 'question_bank', name: 'Question Bank', description: 'Reusable question library' },
        { id: 'report_cards', name: 'Report Cards', description: 'Term report cards, analytics' },
        { id: 'homework', name: 'Homework', description: 'Assignments, submissions, grading' },
        { id: 'broadsheet', name: 'Broadsheet', description: 'Class-wide term & session performance sheets' }
    ];

    const masterAdmin = {
        tenants: [],
        searchQuery: '',
        editingId: null,

        async init() {
            const ds = global.dataService;
            if (!ds || typeof ds.getCurrentUser !== 'function') {
                global.location.href = '../index.html';
                return;
            }
            const user = ds.getCurrentUser();
            if (!user) {
                global.location.href = '../index.html';
                return;
            }
            if (user.role !== 'super_admin') {
                this.renderForbidden(user);
                return;
            }

            this.cache();
            this.bind();
            await this.refresh();
        },

        cache() {
            this.nodes = {
                userName: document.getElementById('user-name'),
                userAvatar: document.getElementById('sidebar-avatar'),
                statTotal: document.getElementById('ma-stat-total'),
                statActive: document.getElementById('ma-stat-active'),
                statTrial: document.getElementById('ma-stat-trial'),
                statSuspended: document.getElementById('ma-stat-suspended'),
                listMeta: document.getElementById('ma-list-meta'),
                list: document.getElementById('ma-tenants-list'),
                searchInput: document.getElementById('ma-search-input'),
                createCta: document.getElementById('ma-create-cta'),
                tenantModal: document.getElementById('ma-tenant-modal'),
                tenantForm: document.getElementById('ma-tenant-form'),
                tenantEyebrow: document.getElementById('ma-tenant-eyebrow'),
                tenantTitle: document.getElementById('ma-tenant-title'),
                idInput: document.getElementById('ma-tenant-id'),
                nameInput: document.getElementById('ma-tenant-name'),
                schoolVersionInput: document.getElementById('ma-tenant-school-version'),
                clientIdInput: document.getElementById('ma-tenant-client-id'),
                contactInput: document.getElementById('ma-tenant-contact'),
                planSelect: document.getElementById('ma-tenant-plan'),
                statusSelect: document.getElementById('ma-tenant-status'),
                expiresInput: document.getElementById('ma-tenant-expires'),
                modulesGrid: document.getElementById('ma-modules-grid'),
                notesInput: document.getElementById('ma-tenant-notes'),
                saveBtn: document.getElementById('ma-save-btn'),
                deleteBtn: document.getElementById('ma-delete-btn'),
                statusMsg: document.getElementById('ma-tenant-status-msg')
            };
        },

        bind() {
            const user = global.dataService.getCurrentUser();
            if (this.nodes.userName) this.nodes.userName.textContent = user.name || user.username || 'Super Admin';
            if (this.nodes.userAvatar) {
                this.nodes.userAvatar.textContent = (user.name || user.username || 'S').trim().charAt(0).toUpperCase();
            }

            if (this.nodes.searchInput) {
                this.nodes.searchInput.addEventListener('input', (event) => {
                    this.searchQuery = String(event.target.value || '').toLowerCase();
                    this.renderList();
                });
            }

            if (this.nodes.createCta) {
                this.nodes.createCta.addEventListener('click', () => this.openTenantModal());
            }

            if (this.nodes.tenantForm) {
                this.nodes.tenantForm.addEventListener('submit', (event) => this.handleSave(event));
            }

            if (this.nodes.deleteBtn) {
                this.nodes.deleteBtn.addEventListener('click', () => this.handleDelete());
            }

            if (this.nodes.tenantModal) {
                Array.from(this.nodes.tenantModal.querySelectorAll('[data-ma-close-tenant]')).forEach((el) => {
                    el.addEventListener('click', () => this.closeTenantModal());
                });
            }

            document.addEventListener('keydown', (event) => {
                if (event.key === 'Escape' && this.nodes.tenantModal && !this.nodes.tenantModal.hidden) {
                    this.closeTenantModal();
                }
            });

            const logoutBtn = document.getElementById('ma-logout-btn');
            if (logoutBtn) {
                logoutBtn.addEventListener('click', () => {
                    if (global.auth?.logout) {
                        global.auth.logout();
                    } else if (global.dataService?.logout) {
                        global.dataService.logout().finally(() => { global.location.href = '../index.html'; });
                    } else {
                        global.location.href = '../index.html';
                    }
                });
            }
        },

        async refresh() {
            try {
                this.tenants = await global.dataService.listTenants();
            } catch (error) {
                console.error('[Master Admin] listTenants failed:', error);
                this.tenants = [];
                this.setStatus(this.friendlyError(error, 'Could not load tenants.'), 'error');
            }
            this.renderStats();
            this.renderList();
        },

        renderStats() {
            const total = this.tenants.length;
            const active = this.tenants.filter((t) => t.status === 'active').length;
            const trial = this.tenants.filter((t) => t.status === 'trial').length;
            const suspended = this.tenants.filter((t) => t.status === 'suspended').length;
            if (this.nodes.statTotal) this.nodes.statTotal.textContent = String(total);
            if (this.nodes.statActive) this.nodes.statActive.textContent = String(active);
            if (this.nodes.statTrial) this.nodes.statTrial.textContent = String(trial);
            if (this.nodes.statSuspended) this.nodes.statSuspended.textContent = String(suspended);
        },

        filterTenants(list) {
            if (!this.searchQuery) return list;
            return list.filter((t) => {
                const haystack = `${t.name} ${t.schoolVersion} ${t.clientId} ${t.contactEmail} ${t.plan} ${t.status}`.toLowerCase();
                return haystack.includes(this.searchQuery);
            });
        },

        renderList() {
            if (!this.nodes.list) return;
            const list = this.filterTenants(this.tenants);
            if (this.nodes.listMeta) {
                this.nodes.listMeta.textContent = `${list.length} ${list.length === 1 ? 'tenant' : 'tenants'}`;
            }

            if (!list.length) {
                this.nodes.list.innerHTML = `
                    <div class="hw-empty">
                        <div class="hw-empty-title">${this.searchQuery ? 'No matches' : 'No tenants yet'}</div>
                        <div>${this.searchQuery
                            ? 'No tenants match your search.'
                            : 'Click <strong>+ New Tenant</strong> to onboard a school.'}</div>
                    </div>`;
                return;
            }

            this.nodes.list.innerHTML = list.map((tenant) => {
                const modules = (tenant.modulesEnabled || []).map((id) => {
                    const meta = KNOWN_MODULES.find((m) => m.id === id);
                    return `<span class="hw-chip muted">${this.escape(meta?.name || id)}</span>`;
                }).join('');
                const statusChip = this.statusChip(tenant);
                const planChip = `<span class="hw-chip primary">${this.escape(tenant.plan)}</span>`;
                const expiresLine = tenant.planExpiresAt
                    ? `Expires ${this.formatDate(tenant.planExpiresAt)}${this.isExpired(tenant.planExpiresAt) ? ' (overdue)' : ''}`
                    : 'No expiry set';

                return `
                    <article class="hw-row" data-ma-tenant-id="${this.escape(tenant.id)}">
                        <div class="hw-row-main">
                            <h3 class="hw-row-title">${this.escape(tenant.name || tenant.schoolVersion)}</h3>
                            <div class="hw-row-meta">${this.escape(tenant.schoolVersion)} &middot; ${this.escape(tenant.contactEmail || 'no contact')} &middot; ${expiresLine}</div>
                            <div class="hw-row-chips">
                                ${statusChip}
                                ${planChip}
                                ${modules || '<span class="hw-chip danger">No modules enabled</span>'}
                            </div>
                        </div>
                        <div class="hw-row-aside">
                            <button type="button" class="hw-icon-btn" data-ma-action="edit" title="Edit" aria-label="Edit tenant">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 113 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>
                            </button>
                        </div>
                    </article>
                `;
            }).join('');

            Array.from(this.nodes.list.querySelectorAll('[data-ma-tenant-id]')).forEach((row) => {
                const id = row.getAttribute('data-ma-tenant-id');
                row.addEventListener('click', () => this.openTenantModal(id));
            });
        },

        statusChip(tenant) {
            const map = {
                active: 'success',
                trial: 'primary',
                suspended: 'danger',
                expired: 'warn'
            };
            const className = map[tenant.status] || 'muted';
            return `<span class="hw-chip ${className}">${this.escape(this.titleCase(tenant.status))}</span>`;
        },

        renderModulesGrid(selectedIds = []) {
            if (!this.nodes.modulesGrid) return;
            const set = new Set(selectedIds);
            this.nodes.modulesGrid.innerHTML = KNOWN_MODULES.map((mod) => `
                <label class="ma-module-row">
                    <input type="checkbox" data-ma-module="${this.escape(mod.id)}" ${set.has(mod.id) ? 'checked' : ''}>
                    <span class="ma-module-meta">
                        <span class="ma-module-name">${this.escape(mod.name)}</span>
                        <span class="ma-module-desc">${this.escape(mod.description)}</span>
                    </span>
                </label>
            `).join('');
        },

        readSelectedModules() {
            if (!this.nodes.modulesGrid) return [];
            return Array.from(this.nodes.modulesGrid.querySelectorAll('[data-ma-module]'))
                .filter((cb) => cb.checked)
                .map((cb) => cb.getAttribute('data-ma-module'));
        },

        openTenantModal(tenantId) {
            this.editingId = tenantId || null;
            const tenant = tenantId ? this.tenants.find((t) => t.id === tenantId) : null;
            if (this.nodes.idInput) this.nodes.idInput.value = tenant?.id || '';
            if (this.nodes.nameInput) this.nodes.nameInput.value = tenant?.name || '';
            if (this.nodes.schoolVersionInput) {
                this.nodes.schoolVersionInput.value = tenant?.schoolVersion || '';
                this.nodes.schoolVersionInput.readOnly = !!tenantId; // can't change once created
            }
            if (this.nodes.clientIdInput) this.nodes.clientIdInput.value = tenant?.clientId || '';
            if (this.nodes.contactInput) this.nodes.contactInput.value = tenant?.contactEmail || '';
            if (this.nodes.planSelect) this.nodes.planSelect.value = tenant?.plan || 'trial';
            if (this.nodes.statusSelect) this.nodes.statusSelect.value = tenant?.status || 'trial';
            if (this.nodes.expiresInput) this.nodes.expiresInput.value = this.toDateInputValue(tenant?.planExpiresAt);
            if (this.nodes.notesInput) this.nodes.notesInput.value = tenant?.notes || '';

            this.renderModulesGrid(tenant?.modulesEnabled || (tenantId ? [] : ['cbt']));

            if (this.nodes.tenantEyebrow) this.nodes.tenantEyebrow.textContent = tenantId ? 'Edit Tenant' : 'New Tenant';
            if (this.nodes.tenantTitle) this.nodes.tenantTitle.textContent = tenantId ? 'Update Tenant' : 'Add Tenant';
            if (this.nodes.saveBtn) this.nodes.saveBtn.textContent = tenantId ? 'Save changes' : 'Create tenant';
            if (this.nodes.deleteBtn) this.nodes.deleteBtn.style.display = tenantId ? '' : 'none';
            this.setStatus('', '');

            if (this.nodes.tenantModal) {
                this.nodes.tenantModal.hidden = false;
                setTimeout(() => this.nodes.nameInput?.focus(), 80);
            }
        },

        closeTenantModal() {
            if (this.nodes.tenantModal) this.nodes.tenantModal.hidden = true;
            this.editingId = null;
        },

        async handleSave(event) {
            event.preventDefault();
            const payload = {
                name: this.nodes.nameInput.value,
                schoolVersion: this.nodes.schoolVersionInput.value,
                clientId: this.nodes.clientIdInput.value,
                contactEmail: this.nodes.contactInput.value,
                plan: this.nodes.planSelect.value,
                status: this.nodes.statusSelect.value,
                planExpiresAt: this.nodes.expiresInput.value,
                modulesEnabled: this.readSelectedModules(),
                notes: this.nodes.notesInput.value
            };

            try {
                if (this.editingId) {
                    await global.dataService.updateTenant(this.editingId, payload);
                } else {
                    await global.dataService.createTenant(payload);
                }
                this.closeTenantModal();
                await this.refresh();
            } catch (error) {
                this.setStatus(this.friendlyError(error, 'Could not save tenant.'), 'error');
            }
        },

        async handleDelete() {
            if (!this.editingId) return;
            const tenant = this.tenants.find((t) => t.id === this.editingId);
            if (!tenant) return;
            const ok = global.confirm(`Delete tenant "${tenant.name}"? This will revoke their access immediately. This cannot be undone.`);
            if (!ok) return;
            try {
                await global.dataService.deleteTenant(this.editingId);
                this.closeTenantModal();
                await this.refresh();
            } catch (error) {
                this.setStatus(this.friendlyError(error, 'Could not delete tenant.'), 'error');
            }
        },

        renderForbidden(user) {
            document.body.innerHTML = `
                <div style="min-height:100vh; display:flex; align-items:center; justify-content:center; background:var(--bg); padding:24px;">
                    <div style="max-width:480px; background:var(--card-bg); border:1px solid var(--border); border-radius:18px; padding:32px; text-align:center; box-shadow:var(--shadow-card);">
                        <h2 style="font-family:var(--font-heading); margin:0 0 10px; color:var(--text-primary);">Master Admin only</h2>
                        <p style="color:var(--text-secondary); line-height:1.55;">You're signed in as <strong>${this.escape(user.role || 'unknown')}</strong>. This page is reserved for the platform's super-admin.</p>
                        <a href="../index.html" style="display:inline-block; margin-top:18px; background:var(--primary); color:#fff; text-decoration:none; font-weight:700; padding:10px 22px; border-radius:999px;">Back to login</a>
                    </div>
                </div>
            `;
        },

        setStatus(message, type) {
            if (!this.nodes.statusMsg) return;
            this.nodes.statusMsg.textContent = message;
            this.nodes.statusMsg.className = `hw-status ${type || ''}`;
        },

        // ---- helpers ----
        formatDate(value) {
            if (!value) return 'No date';
            const d = new Date(value);
            if (Number.isNaN(d.getTime())) return 'No date';
            return d.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });
        },

        isExpired(value) {
            if (!value) return false;
            const d = new Date(value).getTime();
            return !Number.isNaN(d) && d < Date.now();
        },

        toDateInputValue(value) {
            if (!value) return '';
            const d = new Date(value);
            if (Number.isNaN(d.getTime())) return '';
            const yyyy = d.getFullYear();
            const mm = String(d.getMonth() + 1).padStart(2, '0');
            const dd = String(d.getDate()).padStart(2, '0');
            return `${yyyy}-${mm}-${dd}`;
        },

        titleCase(value) {
            if (!value) return '';
            return String(value).charAt(0).toUpperCase() + String(value).slice(1);
        },

        escape(value) {
            const div = document.createElement('div');
            div.textContent = String(value || '');
            return div.innerHTML;
        },

        friendlyError(error, fallback) {
            const message = error?.message || error?.data?.message || '';
            if (!message) return fallback;
            if (/auth|login|unauthor|forbid/i.test(message)) return 'You need to be signed in as super_admin to do this.';
            if (/network|fetch|connect/i.test(message)) return 'Network error. Check your internet connection.';
            if (/collection.*tenants/i.test(message) || /not\s*found.*collection/i.test(message)) {
                return 'Tenants collection is missing on the server. Run the tenants migration on PocketBase.';
            }
            if (/unique|duplicate.*school_version/i.test(message)) return 'A tenant with this school version already exists.';
            return message || fallback;
        }
    };

    global.masterAdmin = masterAdmin;
})(typeof globalThis !== 'undefined' ? globalThis : window);
