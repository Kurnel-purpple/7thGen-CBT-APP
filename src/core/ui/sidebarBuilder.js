/**
 * Sidebar Module Navigation Builder
 *
 * Injects cross-module navigation links into the sidebar from the module registry.
 * Page-internal nav items (e.g. Messages, Flags, Results) remain hardcoded in each page.
 * This only adds links to OTHER modules' pages.
 */

/**
 * Render cross-module nav items into a container element.
 *
 * @param {HTMLElement} containerEl - The DOM element to render nav items into
 * @param {Object} options
 * @param {string|null} options.currentModuleId - Module ID of the current page (filtered out)
 * @param {string|null} options.role - Current user role for filtering (null = show all)
 * @returns {boolean} true if any items were rendered, false otherwise
 */
export function renderModuleNavItems(containerEl, { currentModuleId = null, role = null } = {}) {
    if (!containerEl || !window.__moduleLoader) return false;

    const allItems = window.__moduleLoader.getNavItems({ role });

    // Filter out nav items belonging to the current page's module
    const crossModuleItems = currentModuleId
        ? allItems.filter(item => item.moduleId !== currentModuleId)
        : allItems;

    if (crossModuleItems.length === 0) return false;

    // Group items by section
    const groups = new Map();
    crossModuleItems.forEach(item => {
        const section = item.section || 'Other';
        if (!groups.has(section)) groups.set(section, []);
        groups.get(section).push(item);
    });

    // Render each group
    groups.forEach((items, sectionName) => {
        // Section label
        const label = document.createElement('div');
        label.className = 'sidebar-nav-section-label';
        label.textContent = sectionName;
        label.style.cssText = 'font-size:0.7rem; letter-spacing:0.08em; text-transform:uppercase; color:rgba(255,255,255,0.45); padding:8px 16px 4px; font-weight:700;';
        containerEl.appendChild(label);

        // Nav links
        items.forEach(item => {
            const link = document.createElement('a');
            link.className = 'sidebar-nav-item';
            link.href = resolveNavPath(item.path);
            link.innerHTML = `
                <span class="nav-icon">${getModuleIcon(item.moduleId)}</span>
                <span class="sidebar-nav-label">${escapeHtml(item.label)}</span>
            `;
            containerEl.appendChild(link);
        });
    });

    return true;
}

/**
 * Resolve a module nav path to a relative path from /pages/.
 * Nav items use paths like '/pages/attendance.html'.
 * Since all dashboard pages live in /pages/, we just need the filename.
 */
function resolveNavPath(path) {
    if (!path) return '#';
    // Strip leading /pages/ to get just the filename
    const match = path.match(/\/pages\/(.+)$/);
    return match ? match[1] : path;
}

/**
 * Simple SVG icons per module ID for sidebar nav items.
 */
function getModuleIcon(moduleId) {
    const icons = {
        cbt: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><path d="M4 19.5A2.5 2.5 0 016.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/></svg>',
        attendance: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><path d="M16 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="8.5" cy="7" r="4"/><polyline points="17 11 19 13 23 9"/></svg>',
        report_cards: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>',
        question_bank: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
        calendar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
        fees: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>',
        homework: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',
        broadsheet: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/></svg>',
        admissions: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/></svg>'
    };
    return icons[moduleId] || '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><circle cx="12" cy="12" r="10"/></svg>';
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}
