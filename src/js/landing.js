/**
 * Landing Page Controller
 * Shows the landing page for the default client, or skips to login for branded clients.
 * Handles CTA wiring, smooth scroll, mobile menu, scroll reveals, and count-up stats.
 */

(function () {
    var landingView = document.getElementById('landing-view');
    var loginView = document.getElementById('login-view');

    if (!landingView || !loginView) return;

    // ── Wait for config, then decide which view to show ──────────────
    function init() {
        var config = window.__appConfig;
        if (!config) {
            setTimeout(init, 50);
            return;
        }

        // If user is already logged in, let app.js handle redirect — show nothing
        if (window.dataService && dataService.getCurrentUser()) {
            return;
        }

        var showLanding = config.features && config.features.landingPage !== false;

        // Support direct link to #login
        if (window.location.hash === '#login' || window.location.hash === '#register') {
            showLanding = false;
        }

        if (showLanding) {
            landingView.style.display = '';
            loginView.style.display = 'none';
            initLanding();
        } else {
            landingView.style.display = 'none';
            loginView.style.display = '';
        }
    }

    // ── Landing page setup ───────────────────────────────────────────
    function initLanding() {
        // Initialize Lucide icons
        if (window.lucide) {
            lucide.createIcons({ attrs: { 'stroke-width': 2 } });
        }

        // Wire up CTA buttons
        wireButton('landing-login-btn', showLoginView);
        wireButton('landing-try-online-btn', showLoginView);
        wireButton('landing-cta-try-online', showLoginView);

        wireButton('landing-register-btn', function () {
            window.location.href = 'pages/register.html';
        });

        // Download buttons — use existing platform detection from index.html
        setupLandingDownload('landing-download-btn');
        setupLandingDownload('landing-cta-download');

        // Smooth scroll for anchor links
        var anchors = document.querySelectorAll('.landing-nav a[href^="#"], .landing-mobile-nav a[href^="#"]');
        for (var i = 0; i < anchors.length; i++) {
            anchors[i].addEventListener('click', handleAnchorClick);
        }

        // Mobile hamburger menu
        var hamburger = document.getElementById('landing-hamburger');
        var mobileNav = document.getElementById('landing-mobile-nav');
        if (hamburger && mobileNav) {
            hamburger.addEventListener('click', function () {
                mobileNav.classList.toggle('open');
            });

            // Close menu on link click
            var mobileLinks = mobileNav.querySelectorAll('a, .landing-btn');
            for (var j = 0; j < mobileLinks.length; j++) {
                mobileLinks[j].addEventListener('click', function () {
                    mobileNav.classList.remove('open');
                });
            }
        }

        // Mobile nav login/register buttons
        wireButton('landing-mobile-login', showLoginView);
        wireButton('landing-mobile-register', function () {
            window.location.href = 'pages/register.html';
        });

        // Scroll reveal animations
        initScrollReveal();

        // Count-up stats
        initCountUp();
    }

    // ── Scroll reveal ──────────────────────────────────────────────
    function initScrollReveal() {
        var reveals = landingView.querySelectorAll('.reveal');
        if (!reveals.length) return;

        // Trigger reveals already in viewport on load
        requestAnimationFrame(function () {
            checkReveals(reveals);
        });

        var ticking = false;
        window.addEventListener('scroll', function () {
            if (!ticking) {
                requestAnimationFrame(function () {
                    checkReveals(reveals);
                    ticking = false;
                });
                ticking = true;
            }
        }, { passive: true });
    }

    function checkReveals(reveals) {
        var windowHeight = window.innerHeight;
        for (var i = 0; i < reveals.length; i++) {
            var el = reveals[i];
            if (el.classList.contains('visible')) continue;
            var rect = el.getBoundingClientRect();
            if (rect.top < windowHeight - 60) {
                el.classList.add('visible');
            }
        }
    }

    // ── Count-up stats ─────────────────────────────────────────────
    function initCountUp() {
        var statNums = landingView.querySelectorAll('.landing-stat-num[data-count]');
        if (!statNums.length) return;

        var observer = new IntersectionObserver(function (entries) {
            entries.forEach(function (entry) {
                if (entry.isIntersecting) {
                    animateCount(entry.target);
                    observer.unobserve(entry.target);
                }
            });
        }, { threshold: 0.3 });

        for (var i = 0; i < statNums.length; i++) {
            observer.observe(statNums[i]);
        }
    }

    function animateCount(el) {
        var target = parseInt(el.getAttribute('data-count'), 10);
        var duration = 1600;
        var start = 0;
        var startTime = null;

        function formatNum(n) {
            if (n >= 1000000) return (n / 1000000).toFixed(n % 1000000 === 0 ? 0 : 1) + 'M+';
            if (n >= 1000) return n.toLocaleString() + '+';
            return n.toString() + '+';
        }

        function step(timestamp) {
            if (!startTime) startTime = timestamp;
            var progress = Math.min((timestamp - startTime) / duration, 1);
            // Ease out cubic
            var ease = 1 - Math.pow(1 - progress, 3);
            var current = Math.floor(ease * target);
            el.textContent = formatNum(current);
            if (progress < 1) {
                requestAnimationFrame(step);
            } else {
                el.textContent = formatNum(target);
            }
        }

        requestAnimationFrame(step);
    }

    // ── View transitions ─────────────────────────────────────────────
    function showLoginView() {
        landingView.style.display = 'none';
        loginView.style.display = '';
        window.scrollTo({ top: 0, behavior: 'instant' });
        history.pushState({ view: 'login' }, '', '#login');
    }

    function showLandingView() {
        loginView.style.display = 'none';
        landingView.style.display = '';
        window.scrollTo({ top: 0, behavior: 'instant' });
        history.pushState({ view: 'landing' }, '', ' ');
    }

    // Browser back button support
    window.addEventListener('popstate', function (e) {
        // Only handle if landing page feature is active
        var config = window.__appConfig;
        if (!config || !config.features || config.features.landingPage === false) return;

        if (e.state && e.state.view === 'login') {
            landingView.style.display = 'none';
            loginView.style.display = '';
        } else {
            loginView.style.display = 'none';
            landingView.style.display = '';
        }
    });

    // ── Helpers ──────────────────────────────────────────────────────
    function wireButton(id, handler) {
        var el = document.getElementById(id);
        if (el) el.addEventListener('click', handler);
    }

    function handleAnchorClick(e) {
        e.preventDefault();
        var href = this.getAttribute('href');
        var target = document.querySelector(href);
        if (target) {
            target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    }

    function setupLandingDownload(btnId) {
        var btn = document.getElementById(btnId);
        if (!btn) return;

        // Use existing platform detection functions from index.html inline script
        if (typeof detectPlatform !== 'function' || typeof fetchLatestReleaseAssets !== 'function') return;

        var platform = detectPlatform();
        var config = (typeof PLATFORM_CONFIG !== 'undefined') ? PLATFORM_CONFIG[platform] || PLATFORM_CONFIG.unknown : null;
        if (!config) return;

        if (config.assetMatch) {
            fetchLatestReleaseAssets().then(function (assets) {
                if (assets) {
                    var match = assets.find(function (a) { return config.assetMatch(a.name); });
                    if (match) {
                        btn.href = match.url;
                        btn.removeAttribute('target');
                        return;
                    }
                }
                btn.href = (typeof RELEASES_FALLBACK !== 'undefined') ? RELEASES_FALLBACK : '#';
                btn.target = '_blank';
            });
        } else {
            btn.href = (typeof RELEASES_FALLBACK !== 'undefined') ? RELEASES_FALLBACK : '#';
            btn.target = '_blank';
        }
    }

    // ── Start ────────────────────────────────────────────────────────
    init();
})();
