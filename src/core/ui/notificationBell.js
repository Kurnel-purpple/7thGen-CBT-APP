/**
 * Shared topbar notification bell.
 *
 * Replaces the messages-only bell that lived on the teacher dashboard with one
 * notification centre used everywhere: a single count on the icon, and a
 * dropdown that breaks that count into groups — Payments and Messages — each
 * opening the page it belongs to.
 *
 * WHY IT LIVES HERE AND NOT IN EACH PAGE
 * The old bell was hardcoded into teacher-dashboard.html and existed nowhere
 * else, so an admin — the one person who needs to know about pending fee
 * payments — had no bell at all. This mounts itself into whatever
 * `.topbar-actions` container the page already has, which covers every page
 * with a topbar without editing each one.
 *
 * COUNTS ARE FETCHED ONCE PER PAGE LOAD, not subscribed to. Two getList(1,1)
 * reads that return totalItems without shipping any rows. A realtime
 * subscription for a badge is exactly the kind of thing that accumulated into
 * the v1.9.7 slowdown, and a number that is a few minutes stale costs nobody
 * anything. Call window.__notificationBell.refresh() after an action that
 * changes either count if you want it updated sooner.
 *
 * FAILS SILENTLY. A missing collection, an expired session or a dropped
 * connection leaves the bell showing nothing rather than putting an error in
 * front of someone who was doing something else.
 */

const BELL_ID = 'app-notification-bell';

// Local copy rather than an import from sidebarBuilder: that module imports
// this one, and a cycle between two UI modules is not worth the shared constant.
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

function moduleEnabled(moduleId) {
    try {
        return !!window.__moduleLoader?.isModuleEnabled(moduleId);
    } catch (error) {
        return false;
    }
}

function iconBell() {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/></svg>';
}

function iconPayments() {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>';
}

function iconMessages() {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>';
}

/**
 * Unread messages for the signed-in user, and (for admins) fee payments waiting
 * to be confirmed. Both are counted server-side.
 */
async function loadCounts(role) {
    const counts = { messages: 0, payments: 0 };

    const ds = window.dataService;
    if (!ds || !ds.pb || typeof ds.getCurrentUser !== 'function') return counts;

    const user = ds.getCurrentUser();
    if (!user) return counts;
    const me = user.id || user.user;
    if (!me) return counts;

    const isAdmin = role === 'admin' || role === 'super_admin';
    const wantsPayments = isAdmin && moduleEnabled('fees');

    const jobs = [];

    // Messages addressed to me and not yet read. `read != true` rather than
    // `read = false` so rows written before the field existed (stored null)
    // still count as unread instead of vanishing from the badge.
    jobs.push(
        ds.pb.collection('messages').getList(1, 1, {
            filter: ds.pb.filter('to_id = {:me} && read != true', { me })
        }).then((result) => {
            counts.messages = result.totalItems || 0;
        }).catch(() => { /* silent — see file header */ })
    );

    if (wantsPayments) {
        const clauses = ['status = "pending"'];
        const params = {};
        try {
            const school = ds.getSchoolContext();
            if (school.schoolVersion) {
                clauses.push('school_version = {:sv}');
                params.sv = school.schoolVersion;
            }
        } catch (error) { /* no school context — count the whole queue */ }

        jobs.push(
            ds.pb.collection('fee_payments').getList(1, 1, {
                filter: ds.pb.filter(clauses.join(' && '), params)
            }).then((result) => {
                counts.payments = result.totalItems || 0;
            }).catch(() => { /* silent */ })
        );
    }

    await Promise.all(jobs);
    return counts;
}

function openMessages(role) {
    // Each dashboard already owns its own messages UI under a different name.
    // Prefer opening it in place; fall back to navigating home for pages that
    // have no messages panel of their own.
    if (typeof window.openMessagesSection === 'function') {
        window.openMessagesSection();
        return;
    }
    if (typeof window.openChatModal === 'function') {
        window.openChatModal();
        return;
    }
    window.location.href = DASHBOARD_BY_ROLE[role] || 'student-dashboard.html';
}

function renderGroups(wrap, counts, role) {
    const groupsHost = wrap.querySelector('.topbar-bell-groups');
    const emptyNote = wrap.querySelector('.topbar-bell-empty');
    if (!groupsHost) return;

    const isAdmin = role === 'admin' || role === 'super_admin';
    const groups = [];

    // Payments is an admin concern — a student seeing "Payments 0" is noise, so
    // the group is absent rather than empty for everyone else.
    if (isAdmin && moduleEnabled('fees')) {
        groups.push({
            key: 'payments',
            icon: iconPayments(),
            title: 'Payments',
            sub: counts.payments > 0
                ? counts.payments + ' receipt' + (counts.payments === 1 ? '' : 's') + ' awaiting confirmation'
                : 'Nothing waiting for review',
            count: counts.payments
        });
    }

    groups.push({
        key: 'messages',
        icon: iconMessages(),
        title: 'Messages',
        sub: counts.messages > 0
            ? counts.messages + ' unread message' + (counts.messages === 1 ? '' : 's')
            : 'No unread messages',
        count: counts.messages
    });

    groupsHost.innerHTML = groups.map((group) => {
        const badge = group.count > 0
            ? '<span class="bell-group-count">' + (group.count > 99 ? '99+' : group.count) + '</span>'
            : '';
        return '' +
            '<button type="button" class="topbar-bell-group' + (group.count > 0 ? ' has-items' : '') + '" data-bell-group="' + group.key + '">' +
                '<span class="bell-group-icon">' + group.icon + '</span>' +
                '<span class="bell-group-text">' +
                    '<span class="bell-group-title">' + group.title + '</span>' +
                    '<span class="bell-group-sub">' + group.sub + '</span>' +
                '</span>' +
                badge +
            '</button>';
    }).join('');

    const total = groups.reduce((sum, group) => sum + group.count, 0);
    if (emptyNote) emptyNote.hidden = total > 0;

    groupsHost.querySelectorAll('[data-bell-group]').forEach((btn) => {
        btn.addEventListener('click', () => {
            const key = btn.getAttribute('data-bell-group');
            closeMenu(wrap);
            if (key === 'payments') {
                window.location.href = 'fees.html';
                return;
            }
            openMessages(role);
        });
    });
}

function paintBadge(wrap, counts) {
    const badge = wrap.querySelector('.topbar-bell-badge');
    if (!badge) return;
    const total = (counts.messages || 0) + (counts.payments || 0);
    if (total > 0) {
        badge.textContent = total > 99 ? '99+' : String(total);
        badge.hidden = false;
        wrap.querySelector('.topbar-bell-btn')?.setAttribute(
            'title',
            total + ' notification' + (total === 1 ? '' : 's')
        );
    } else {
        badge.hidden = true;
        wrap.querySelector('.topbar-bell-btn')?.setAttribute('title', 'Notifications');
    }
}

function closeMenu(wrap) {
    const menu = wrap.querySelector('.topbar-bell-menu');
    const btn = wrap.querySelector('.topbar-bell-btn');
    if (menu) menu.hidden = true;
    if (btn) btn.setAttribute('aria-expanded', 'false');
}

function toggleMenu(wrap) {
    const menu = wrap.querySelector('.topbar-bell-menu');
    const btn = wrap.querySelector('.topbar-bell-btn');
    if (!menu) return;
    const open = menu.hidden;
    menu.hidden = !open;
    if (btn) btn.setAttribute('aria-expanded', open ? 'true' : 'false');
}

/**
 * Mount the bell into the page's `.topbar-actions`, if it has one.
 * Idempotent — safe to call more than once.
 */
export async function mountNotificationBell({ role = null } = {}) {
    const actions = document.querySelector('.topbar-actions');
    if (!actions) return;
    if (document.getElementById(BELL_ID)) return;

    const resolvedRole = role || cachedRole();
    if (!resolvedRole) return; // signed out — nothing to notify about

    // Absorb the teacher dashboard's messages-only bell so the page does not end
    // up with two. Its updater guards every element lookup with `if (el)`, so
    // removing this leaves those calls as harmless no-ops.
    const legacy = document.getElementById('messages-bell');
    if (legacy) legacy.remove();

    const wrap = document.createElement('div');
    wrap.className = 'topbar-bell-wrap';
    wrap.id = BELL_ID;
    wrap.innerHTML = '' +
        '<button type="button" class="topbar-icon-btn topbar-bell-btn" aria-haspopup="true" aria-expanded="false" title="Notifications" aria-label="Notifications">' +
            iconBell() +
            '<span class="topbar-bell-badge" hidden></span>' +
        '</button>' +
        '<div class="topbar-bell-menu" role="menu" hidden>' +
            '<div class="topbar-bell-head">Notifications</div>' +
            '<div class="topbar-bell-groups"></div>' +
            '<div class="topbar-bell-empty" hidden>You are all caught up.</div>' +
        '</div>';

    // First in the actions row, ahead of any page-specific buttons.
    actions.insertBefore(wrap, actions.firstChild);

    wrap.querySelector('.topbar-bell-btn')?.addEventListener('click', (event) => {
        event.stopPropagation();
        toggleMenu(wrap);
    });

    document.addEventListener('click', (event) => {
        if (!wrap.contains(event.target)) closeMenu(wrap);
    });
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') closeMenu(wrap);
    });

    const refresh = async () => {
        const counts = await loadCounts(resolvedRole);
        paintBadge(wrap, counts);
        renderGroups(wrap, counts, resolvedRole);
    };

    // Exposed so a page can update the badge after an action that changes a
    // count (reading a thread, confirming a payment) instead of waiting for the
    // next navigation.
    window.__notificationBell = { refresh };

    await refresh();
}

export default { mountNotificationBell };
