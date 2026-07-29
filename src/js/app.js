/**
 * Main App Controller
 */

document.addEventListener('DOMContentLoaded', () => {
    console.log('CBT App Initialized');

    // Landing on the login page while already signed in — usually by pressing
    // Back far enough — should send you straight on to your dashboard.
    //
    // This used to name teacher and student only, so an admin who came back
    // here was left staring at the login form with a perfectly good session,
    // and had to sign in again. Utils.getDashboardUrl covers every role.
    //
    // replace(), not href: pushing would leave the login page sitting in
    // history for Back to find all over again.
    const user = dataService.getCurrentUser();
    const isLoginPage = document.getElementById('login-form');

    if (user && isLoginPage) {
        const dashboard = (window.Utils && typeof Utils.getKnownDashboardUrl === 'function')
            ? Utils.getKnownDashboardUrl(user)
            : null;
        // Null for an unrecognised role — leave those on the login form rather
        // than bouncing them to a dashboard whose guard will throw them back.
        if (dashboard) window.location.replace('pages/' + dashboard);
    }
});

/**
 * Demo Mode Banner
 * Shows a countdown banner when the user is in demo mode.
 * Only activates when 'demo_expiry' exists in localStorage (set by landing.js demo flow).
 * On client builds, this value is never set, so the function exits immediately.
 */
(function initDemoBanner() {
    const expiry = localStorage.getItem('demo_expiry');
    if (!expiry) return;

    const expiryMs = parseInt(expiry, 10);
    if (isNaN(expiryMs)) {
        localStorage.removeItem('demo_expiry');
        return;
    }

    // If already expired, clean up and force logout
    if (Date.now() > expiryMs) {
        localStorage.removeItem('demo_expiry');
        if (typeof dataService !== 'undefined' && dataService.getCurrentUser()) {
            const user = dataService.getCurrentUser();
            if (user && user.schoolVersion && user.schoolVersion.startsWith('DEMO_')) {
                dataService.logout();
                window.location.href = window.location.pathname.includes('/pages/') ? '../index.html' : 'index.html';
            }
        }
        return;
    }

    // Create banner element
    const banner = document.createElement('div');
    banner.id = 'demo-banner';
    banner.style.cssText = [
        'position: fixed',
        'top: 0',
        'left: 0',
        'right: 0',
        'z-index: 10000',
        'background: linear-gradient(135deg, #1A73E8 0%, #1557B0 100%)',
        'color: #fff',
        'text-align: center',
        'padding: 10px 16px',
        'font-family: "Nunito", "Figtree", sans-serif',
        'font-size: 0.85rem',
        'font-weight: 600',
        'box-shadow: 0 2px 8px rgba(0,0,0,0.15)',
        'display: flex',
        'align-items: center',
        'justify-content: center',
        'gap: 8px'
    ].join(';');

    document.body.prepend(banner);

    // Push body content down to make room for the banner
    document.body.style.paddingTop = '40px';

    function updateCountdown() {
        const remaining = expiryMs - Date.now();
        if (remaining <= 0) {
            localStorage.removeItem('demo_expiry');
            clearInterval(timer);
            banner.innerHTML = 'Demo session expired. Logging out...';
            setTimeout(function () {
                if (typeof dataService !== 'undefined') dataService.logout();
                window.location.href = window.location.pathname.includes('/pages/') ? '../index.html' : 'index.html';
            }, 1500);
            return;
        }
        const mins = Math.floor(remaining / 60000);
        const secs = Math.floor((remaining % 60000) / 1000);
        banner.innerHTML = '<span style="opacity:0.85">Demo Mode</span> — expires in <strong>' + mins + 'm ' + secs + 's</strong>. '
            + '<a href="mailto:corneliusajayi123@gmail.com" style="color:#fff;text-decoration:underline;margin-left:4px">Contact us</a> for the full experience.';
    }

    updateCountdown();
    const timer = setInterval(updateCountdown, 1000);
})();
