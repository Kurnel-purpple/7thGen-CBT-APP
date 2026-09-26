/**
 * Sidebar Module Navigation Builder
 *
 * Injects cross-module navigation links into the sidebar from the module registry.
 * Page-internal nav items (e.g. Messages, Flags, Results) remain hardcoded in each page.
 * This only adds links to OTHER modules' pages.
 *
 * It has also become the app's shared CHROME entry point: every page with a
 * sidebar calls renderModuleNavItems, which makes it the one place that can
 * reach all of them without editing fifteen HTML files. The Dashboard link, the
 * Feed link on the theme-toggle row, the pending-fees badge and the topbar
 * notification bell are all mounted from here for that reason.
 */

import { mountNotificationBell } from './notificationBell.js';

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
    // Sidebar chrome — the Dashboard link, the Feed link beside the theme
    // toggle, and the pending-fees badge. This runs BEFORE the early return
    // below on purpose: the chrome is not conditional on there being any
    // cross-module nav to show, and every page with a sidebar calls this
    // function, which makes it the one place that reaches all of them without
    // editing fifteen HTML files.
    const resolvedRole = role || cachedRole();
    renderSidebarChrome({ role: resolvedRole, currentModuleId });
    // Topbar half of the same chrome. Mounts only where the page has a
    // `.topbar-actions` container, and is a no-op everywhere else.
    mountNotificationBell({ role: resolvedRole });

    // Exposed for classic (non-module) scripts — feesDashboard.js repaints the
    // badge after confirming or rejecting a payment, which is the only thing
    // that changes the number it shows. Assigned up here so it exists on every
    // path out of this function, including the early returns below.
    window.__sidebarChrome = {
        refreshFeesBadge: () => paintPendingFeesBadge(resolvedRole)
    };

    if (!containerEl || !window.__moduleLoader) return false;

    const allItems = window.__moduleLoader.getNavItems({ role });

    const crossModuleItems = allItems.filter((item) => {
        // Filter out nav items belonging to the current page's module
        if (currentModuleId && item.moduleId === currentModuleId) return false;
        // Feed now has a permanent home on the theme-toggle row, so listing it
        // again under "School Life" would just be the same link twice.
        if (item.moduleId === 'feed') return false;
        return true;
    });

    if (crossModuleItems.length === 0) {
        // Still badge: on the fees page itself the link lives in the page's own
        // nav, so there is nothing to render here but a badge is still wanted.
        paintPendingFeesBadge(resolvedRole);
        return false;
    }

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

    // Badged last, once the links it attaches to are actually in the DOM.
    // Ordering here is explicit rather than relying on the network round trip
    // inside it to outlast the synchronous render above.
    paintPendingFeesBadge(resolvedRole);

    return true;
}

/**
 * Every page in /pages/ that a signed-in user can reach has one of these as its
 * "home". Used by the Dashboard link, and by the login redirect's fallback.
 */
const DASHBOARD_BY_ROLE = {
    admin: 'admin-dashboard.html',
    teacher: 'teacher-dashboard.html',
    student: 'student-dashboard.html',
    super_admin: 'master-admin.html'
};

function cachedRole() {
    try {
        return JSON.parse(localStorage.getItem('cbt_user_meta') || '{}').role || null;
    } catch (error) {
        return null;
    }
}

function currentPageName() {
    const path = window.location.pathname || '';
    return path.substring(path.lastIndexOf('/') + 1).toLowerCase();
}

function moduleEnabled(moduleId) {
    try {
        return !!window.__moduleLoader?.isModuleEnabled(moduleId);
    } catch (error) {
        return false;
    }
}

/**
 * Sidebar chrome shared by every page: a Dashboard link at the top of the nav,
 * and the Feed link sharing a row with the dark-mode toggle.
 *
 * Idempotent — guarded by data attributes, because pages that re-render their
 * nav would otherwise stack duplicates.
 */
export function renderSidebarChrome({ role = null } = {}) {
    const sidebar = document.getElementById('app-sidebar');
    if (!sidebar) return;

    const scrollable = sidebar.querySelector('.sidebar-scrollable') || sidebar;
    const page = currentPageName();
    const resolvedRole = role || cachedRole();

    // ---- 1. Feed link, sharing the theme toggle's row -------------------
    const toggle = document.getElementById('sidebar-theme-toggle');
    if (toggle && !toggle.closest('.sidebar-utility-row')) {
        const row = document.createElement('div');
        row.className = 'sidebar-utility-row';

        toggle.parentNode.insertBefore(row, toggle);
        // The toggle carries its own inline margin for the standalone layout it
        // used to have; inside a flex row that margin fights the gap.
        toggle.style.margin = '0';
        toggle.style.padding = '8px';
        row.appendChild(toggle);

        if (moduleEnabled('feed')) {
            const feedLink = document.createElement('a');
            feedLink.className = 'sidebar-feed-link' + (page === 'feed.html' ? ' active' : '');
            feedLink.href = 'feed.html';
            feedLink.innerHTML =
                '<span class="nav-icon">' + getModuleIcon('feed') + '</span>' +
                '<span>Feed</span>';
            row.appendChild(feedLink);
        }
    }

    // ---- 2. Dashboard link at the top of the nav ------------------------
    const dashboard = DASHBOARD_BY_ROLE[resolvedRole];
    // No link when they are already looking at it.
    if (dashboard && page !== dashboard && !scrollable.querySelector('[data-sidebar-dashboard]')) {
        const nav = document.createElement('nav');
        nav.className = 'sidebar-nav sidebar-top-nav';
        nav.setAttribute('data-sidebar-dashboard', '1');
        nav.innerHTML =
            '<a href="' + dashboard + '" class="sidebar-nav-item sidebar-dashboard-link">' +
                '<span class="nav-icon">' +
                    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20">' +
                    '<rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/>' +
                    '<rect x="14" y="12" width="7" height="9"/><rect x="3" y="16" width="7" height="5"/></svg>' +
                '</span>' +
                '<span class="sidebar-nav-label">Dashboard</span>' +
            '</a>';

        const firstNav = scrollable.querySelector('.sidebar-nav');
        if (firstNav) {
            scrollable.insertBefore(nav, firstNav);
        } else {
            scrollable.appendChild(nav);
        }
    }
}

/**
 * Admin notification for fee payments waiting to be confirmed.
 *
 * A count badge on the Fee Payments link rather than a popup: it is visible from
 * every page, it does not interrupt anything, and it disappears by itself when
 * the queue is cleared. One getList(1,1) read per page load — the server returns
 * totalItems without shipping any rows.
 *
 * Deliberately silent on failure. A missing collection, a logged-out session or
 * a flaky connection must not put an error in front of an admin who was doing
 * something else entirely.
 */
export async function paintPendingFeesBadge(role) {
    const resolvedRole = role || cachedRole();
    if (resolvedRole !== 'admin' && resolvedRole !== 'super_admin') return;
    if (!moduleEnabled('fees')) return;

    const ds = window.dataService;
    if (!ds || !ds.pb || typeof ds.getSchoolContext !== 'function') return;

    let pending = 0;
    try {
        const school = ds.getSchoolContext();
        const clauses = ['status = "pending"'];
        const params = {};
        if (school.schoolVersion) {
            clauses.push('school_version = {:sv}');
            params.sv = school.schoolVersion;
        }
        const result = await ds.pb.collection('fee_payments').getList(1, 1, {
            filter: ds.pb.filter(clauses.join(' && '), params)
        });
        pending = result.totalItems || 0;
    } catch (error) {
        return;
    }

    const sidebar = document.getElementById('app-sidebar');
    if (!sidebar) return;

    // Matches the link whether it came from the module nav or from the fees
    // page's own hardcoded nav.
    const links = Array.from(sidebar.querySelectorAll('a.sidebar-nav-item'))
        .filter((link) => (link.getAttribute('href') || '').replace(/^.*\//, '') === 'fees.html');

    links.forEach((link) => {
        let badge = link.querySelector('.sidebar-nav-badge');
        if (pending <= 0) {
            if (badge) badge.remove();
            return;
        }
        if (!badge) {
            badge = document.createElement('span');
            badge.className = 'sidebar-nav-badge';
            link.appendChild(badge);
        }
        badge.textContent = pending > 99 ? '99+' : String(pending);
        badge.setAttribute('title', pending + ' payment' + (pending === 1 ? '' : 's') + ' waiting for confirmation');
    });
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
        admissions: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/></svg>',
        feed: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><path d="M4 11a9 9 0 019 9"/><path d="M4 4a16 16 0 0116 16"/><circle cx="5" cy="19" r="1"/></svg>'
    };
    return icons[moduleId] || '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><circle cx="12" cy="12" r="10"/></svg>';
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}
