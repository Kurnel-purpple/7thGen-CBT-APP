/**
 * Landing Page Controller
 * Dynamically loads landing-view.html + landing.css, then initializes the landing page.
 * On client branches, this file is deleted — so none of this code ever runs.
 * Even if it somehow survives, config.features.landingPage === false skips everything.
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
            // Dynamically load the landing page HTML and CSS
            loadLanding();
        } else {
            landingView.style.display = 'none';
            loginView.style.display = '';
        }
    }

    // ── Dynamic loading ───────────────────────────────────────────────
    function loadLanding() {
        // Load CSS
        var link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = 'css/landing.css';
        document.head.appendChild(link);

        // Load HTML
        fetch('landing-view.html')
            .then(function (res) {
                if (!res.ok) throw new Error('Landing HTML not found');
                return res.text();
            })
            .then(function (html) {
                landingView.innerHTML = html;
                landingView.style.display = '';
                loginView.style.display = 'none';
                initLanding();
            })
            .catch(function (err) {
                // Landing files missing (e.g. client build) — just show login
                console.warn('[Landing] Could not load landing page:', err.message);
                landingView.style.display = 'none';
                loginView.style.display = '';
            });
    }

    // ── Landing page setup ───────────────────────────────────────────
    function initLanding() {
        // Initialize Lucide icons
        if (window.lucide) {
            lucide.createIcons({ attrs: { 'stroke-width': 2 } });
        }

        // Wire up CTA buttons
        wireButton('landing-login-btn', showLoginView);

        // Register / Get Started buttons → intercept modal
        wireButton('landing-register-btn', openRegisterIntercept);
        wireButton('landing-mobile-register', openRegisterIntercept);
        wireButton('landing-hero-register-btn', openRegisterIntercept);
        wireButton('landing-cta-register', openRegisterIntercept);


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

        // Mobile nav buttons
        wireButton('landing-mobile-login', showLoginView);

        // Hidden operator entry: triple-click the brand to reach the
        // master-admin sign-in page. Silent (no visual hint) on purpose.
        var brand = document.querySelector('.landing-brand');
        if (brand) {
            var clickCount = 0;
            var clickTimer = null;
            brand.addEventListener('click', function (event) {
                event.preventDefault();
                clickCount++;
                if (clickTimer) clearTimeout(clickTimer);
                if (clickCount >= 3) {
                    clickCount = 0;
                    window.location.href = 'pages/master-login.html';
                    return;
                }
                clickTimer = setTimeout(function () { clickCount = 0; }, 600);
            });
        }

        // Scroll reveal animations
        initScrollReveal();

        // Count-up stats
        initCountUp();

        // Scroll-driven showcase
        initShowcase();

        // Register intercept modal
        initRegisterIntercept();

        // Quick Demo modal
        initDemo();
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
        function onScroll() {
            if (!ticking) {
                requestAnimationFrame(function () {
                    checkReveals(reveals);
                    ticking = false;
                });
                ticking = true;
            }
        }

        // Listen on both window and the app container (Electron scroll context)
        window.addEventListener('scroll', onScroll, { passive: true });
        var appContainer = document.querySelector('.app-container.no-sidebar');
        if (appContainer) {
            appContainer.addEventListener('scroll', onScroll, { passive: true });
        }
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

    // ── Scroll-driven showcase ──────────────────────────────────────
    // CSS sticky does the pinning. This JS just tracks scroll progress
    // and drives the card-expand + slide-cycling animations.
    function initShowcase() {
        var section = landingView.querySelector('.landing-hero-showcase');
        if (!section) return;

        var heroContent = section.querySelector('.landing-hero-content');
        var expandOverlay = section.querySelector('.showcase-expand-overlay');
        var expandCard = section.querySelector('.showcase-expand-card');
        var slides = section.querySelectorAll('.showcase-slide');
        var progressEl = section.querySelector('.showcase-progress');
        var skipBtn = section.querySelector('.showcase-skip');
        var totalSlides = slides.length;
        if (totalSlides === 0) return;

        // ── Find the real scroll container ──
        var scroller = document.querySelector('.app-container.no-sidebar');
        if (!scroller || scroller.scrollHeight <= scroller.clientHeight) {
            scroller = null; // fallback: window/document scroll
        }

        // 1 phase for card expand + 1 phase per slide
        var totalPhases = 1 + totalSlides;
        section.style.height = (totalPhases * 100) + 'vh';

        // Random slide entry directions
        var dirs = ['left', 'right', 'top', 'bottom'];
        for (var i = 0; i < totalSlides; i++) {
            slides[i].setAttribute('data-enter', dirs[Math.floor(Math.random() * 4)]);
        }

        // Generate progress dots
        if (progressEl) {
            for (var d = 0; d < totalSlides; d++) {
                var dot = document.createElement('span');
                dot.className = 'showcase-dot';
                dot.setAttribute('data-index', d);
                progressEl.appendChild(dot);
            }
        }
        var dots = progressEl ? progressEl.querySelectorAll('.showcase-dot') : [];

        var currentSlide = -1;
        var expandEnd = 1 / totalPhases; // fraction of total scroll for the expand phase
        var lastProgress = 0;
        var peakSlide = -1; // highest slide index reached while scrolling down

        // ── Scroll listener ──
        var ticking = false;
        function onScroll() {
            if (!ticking) {
                requestAnimationFrame(update);
                ticking = true;
            }
        }
        // Listen on both — one of them will fire
        if (scroller) scroller.addEventListener('scroll', onScroll, { passive: true });
        window.addEventListener('scroll', onScroll, { passive: true });

        // Fire once on load
        requestAnimationFrame(update);

        function update() {
            ticking = false;

            // getBoundingClientRect works regardless of which element scrolls
            var rect = section.getBoundingClientRect();
            var scrolled = -rect.top;                          // how far into the section
            var totalScroll = section.offsetHeight - window.innerHeight; // total scrollable distance
            if (totalScroll <= 0) return;

            var progress = Math.max(0, Math.min(1, scrolled / totalScroll));
            var scrollingUp = progress < lastProgress;

            // ── Scrolling UP while in slides phase? Snap scroll back to collapse zone ──
            if (scrollingUp && progress > expandEnd) {
                // Jump scroll position to just inside the expand zone so user
                // immediately sees the card collapsing instead of scrolling through dead space
                peakSlide = -1;
                setSlide(-1);
                if (progressEl) progressEl.classList.remove('visible');
                if (skipBtn) skipBtn.classList.remove('visible');

                var targetProgress = expandEnd * 0.8; // land at 80% of expand phase
                var snapTo = section.offsetTop + targetProgress * totalScroll;
                var el = scroller || document.documentElement;
                el.scrollTop = snapTo;
                lastProgress = targetProgress;
                return;
            }

            lastProgress = progress;

            // ── Phase 0: Idle — no scrolling yet ──
            if (progress <= 0.001) {
                // Hero fully visible, everything else hidden
                heroContent.style.opacity = 1;
                heroContent.style.pointerEvents = '';
                expandOverlay.style.opacity = 0;
                expandOverlay.style.pointerEvents = 'none';
                expandCard.style.cssText = '';
                setSlide(-1);
                peakSlide = -1;
                if (progressEl) progressEl.classList.remove('visible');
                if (skipBtn) skipBtn.classList.remove('visible');
                return;
            }

            // ── Phase 1: Card expand (progress 0 → expandEnd) ──
            if (progress <= expandEnd) {
                var ep = progress / expandEnd; // 0→1 within expand phase
                var ease = easeInOutCubic(ep);

                // Fade hero text out (fast — gone by 40% of expand)
                heroContent.style.opacity = Math.max(0, 1 - ep * 2.5);
                heroContent.style.pointerEvents = ep > 0.3 ? 'none' : '';

                // Fade in expand overlay as we scroll
                expandOverlay.style.opacity = Math.min(1, ep * 3);
                expandOverlay.style.pointerEvents = ep > 0.1 ? 'auto' : 'none';

                // Card: small/rotated upper-right → fullscreen
                var vw = window.innerWidth, vh = window.innerHeight;
                var w = lerp(320, vw, ease);
                var h = lerp(220, vh, ease);
                var x = lerp(vw * 0.55, 0, ease);
                var y = lerp(vh * 0.2, 0, ease);
                var rot = lerp(-5, 0, ease);
                var rad = lerp(16, 0, ease);

                expandCard.style.cssText =
                    'width:' + w + 'px;height:' + h + 'px;' +
                    'top:' + y + 'px;left:' + x + 'px;' +
                    'transform:rotate(' + rot + 'deg);' +
                    'border-radius:' + rad + 'px;position:absolute;overflow:hidden;';

                // Hide slides + UI
                setSlide(-1);
                peakSlide = -1;
                if (progressEl) progressEl.classList.remove('visible');
                if (skipBtn) skipBtn.classList.remove('visible');

            // ── Phase 2: Slides — only advances forward ──
            } else {
                // Hero gone, expand overlay gone
                heroContent.style.opacity = 0;
                heroContent.style.pointerEvents = 'none';
                expandOverlay.style.opacity = 0;
                expandOverlay.style.pointerEvents = 'none';

                // Show dots + skip
                if (progressEl) progressEl.classList.add('visible');
                if (skipBtn) skipBtn.classList.add('visible');

                // Which slide? Only advance, never go backwards
                var sp = (progress - expandEnd) / (1 - expandEnd); // 0→1 over slide phases
                var idx = Math.min(totalSlides - 1, Math.floor(sp * totalSlides));
                if (idx > peakSlide) peakSlide = idx;
                setSlide(peakSlide);
            }
        }

        function setSlide(index) {
            if (index === currentSlide) return;
            // Deactivate old
            if (currentSlide >= 0) {
                slides[currentSlide].classList.remove('showcase-slide--active');
                if (dots[currentSlide]) dots[currentSlide].classList.remove('showcase-dot--active');
            }
            // Activate new
            if (index >= 0) {
                slides[index].classList.add('showcase-slide--active');
                if (dots[index]) dots[index].classList.add('showcase-dot--active');
            }
            currentSlide = index;
        }

        // ── Skip button ──
        if (skipBtn) {
            skipBtn.addEventListener('click', function () {
                var target = document.getElementById('features') || section.nextElementSibling;
                if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
            });
        }

        // ── Dot click ──
        for (var di = 0; di < dots.length; di++) {
            dots[di].addEventListener('click', function () {
                var idx = parseInt(this.getAttribute('data-index'), 10);
                var frac = expandEnd + (idx / totalSlides) * (1 - expandEnd);
                var totalScroll = section.offsetHeight - window.innerHeight;
                var scrollTo = section.offsetTop + frac * totalScroll;
                var el = scroller || document.documentElement;
                el.scrollTo({ top: scrollTo, behavior: 'smooth' });
            });
        }

        // ── Utils ──
        function lerp(a, b, t) { return a + (b - a) * t; }
        function easeInOutCubic(t) {
            return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
        }
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

    // ── Register Intercept Modal ────────────────────────────────────
    var registerInterceptOverlay;

    function initRegisterIntercept() {
        registerInterceptOverlay = document.getElementById('register-intercept-overlay');
        if (!registerInterceptOverlay) return;

        wireButton('register-intercept-close', closeRegisterIntercept);
        wireButton('register-intercept-demo-btn', function () {
            closeRegisterIntercept();
            openDemoModal();
        });

        registerInterceptOverlay.addEventListener('click', function (e) {
            if (e.target === registerInterceptOverlay) closeRegisterIntercept();
        });
    }

    function openRegisterIntercept() {
        if (!registerInterceptOverlay) return;
        registerInterceptOverlay.style.display = 'flex';
        if (window.lucide) lucide.createIcons({ attrs: { 'stroke-width': 2 } });
    }

    function closeRegisterIntercept() {
        if (registerInterceptOverlay) registerInterceptOverlay.style.display = 'none';
    }

    // ── Quick Demo ──────────────────────────────────────────────────

    // Demo exam templates (persistent demo teacher creates these on first setup)
    var DEMO_EXAMS = [
        {
            title: 'Basic Mathematics (Demo)',
            subject: 'Mathematics',
            targetClass: 'JSS 3',
            schoolLevel: 'Junior Secondary',
            duration: 30,
            passScore: 50,
            status: 'active',
            instructions: '<p>Answer all questions. Each question carries equal marks. <strong>This is a demo exam.</strong></p>',
            scrambleQuestions: false,
            questions: [
                { id: 'dq1', type: 'mcq', text: 'What is 15 + 27?', options: [{ id: 'a', text: '42', isCorrect: true }, { id: 'b', text: '32', isCorrect: false }, { id: 'c', text: '52', isCorrect: false }, { id: 'd', text: '41', isCorrect: false }] },
                { id: 'dq2', type: 'mcq', text: 'What is 8 × 7?', options: [{ id: 'a', text: '54', isCorrect: false }, { id: 'b', text: '56', isCorrect: true }, { id: 'c', text: '48', isCorrect: false }, { id: 'd', text: '64', isCorrect: false }] },
                { id: 'dq3', type: 'mcq', text: 'What is 144 ÷ 12?', options: [{ id: 'a', text: '11', isCorrect: false }, { id: 'b', text: '13', isCorrect: false }, { id: 'c', text: '12', isCorrect: true }, { id: 'd', text: '14', isCorrect: false }] },
                { id: 'dq4', type: 'mcq', text: 'Simplify: 3/4 + 1/2', options: [{ id: 'a', text: '5/4', isCorrect: true }, { id: 'b', text: '4/6', isCorrect: false }, { id: 'c', text: '1/2', isCorrect: false }, { id: 'd', text: '3/8', isCorrect: false }] },
                { id: 'dq5', type: 'mcq', text: 'A rectangle has length 8cm and width 5cm. What is its area?', options: [{ id: 'a', text: '13 cm²', isCorrect: false }, { id: 'b', text: '40 cm²', isCorrect: true }, { id: 'c', text: '26 cm²', isCorrect: false }, { id: 'd', text: '35 cm²', isCorrect: false }] }
            ]
        },
        {
            title: 'English Language (Demo)',
            subject: 'English',
            targetClass: 'JSS 3',
            schoolLevel: 'Junior Secondary',
            duration: 25,
            passScore: 50,
            status: 'active',
            instructions: '<p>Choose the best answer for each question. <strong>This is a demo exam.</strong></p>',
            scrambleQuestions: false,
            questions: [
                { id: 'dq6', type: 'mcq', text: 'Choose the correct spelling:', options: [{ id: 'a', text: 'Accomodation', isCorrect: false }, { id: 'b', text: 'Accommodation', isCorrect: true }, { id: 'c', text: 'Acommodation', isCorrect: false }, { id: 'd', text: 'Acomodation', isCorrect: false }] },
                { id: 'dq7', type: 'mcq', text: '"She ___ to school every day." Choose the correct word:', options: [{ id: 'a', text: 'go', isCorrect: false }, { id: 'b', text: 'going', isCorrect: false }, { id: 'c', text: 'goes', isCorrect: true }, { id: 'd', text: 'gone', isCorrect: false }] },
                { id: 'dq8', type: 'mcq', text: 'What is a synonym for "happy"?', options: [{ id: 'a', text: 'Sad', isCorrect: false }, { id: 'b', text: 'Angry', isCorrect: false }, { id: 'c', text: 'Joyful', isCorrect: true }, { id: 'd', text: 'Tired', isCorrect: false }] },
                { id: 'dq9', type: 'mcq', text: 'Which sentence is grammatically correct?', options: [{ id: 'a', text: 'He don\'t like rice.', isCorrect: false }, { id: 'b', text: 'He doesn\'t likes rice.', isCorrect: false }, { id: 'c', text: 'He doesn\'t like rice.', isCorrect: true }, { id: 'd', text: 'He not like rice.', isCorrect: false }] }
            ]
        },
        {
            title: 'General Science (Demo)',
            subject: 'Science',
            targetClass: 'JSS 3',
            schoolLevel: 'Junior Secondary',
            duration: 20,
            passScore: 50,
            status: 'active',
            instructions: '<p>Answer all questions. <strong>This is a demo exam.</strong></p>',
            scrambleQuestions: false,
            questions: [
                { id: 'dq10', type: 'mcq', text: 'What is the chemical symbol for water?', options: [{ id: 'a', text: 'O2', isCorrect: false }, { id: 'b', text: 'H2O', isCorrect: true }, { id: 'c', text: 'CO2', isCorrect: false }, { id: 'd', text: 'NaCl', isCorrect: false }] },
                { id: 'dq11', type: 'mcq', text: 'Which organ pumps blood around the body?', options: [{ id: 'a', text: 'Brain', isCorrect: false }, { id: 'b', text: 'Liver', isCorrect: false }, { id: 'c', text: 'Heart', isCorrect: true }, { id: 'd', text: 'Kidney', isCorrect: false }] },
                { id: 'dq12', type: 'mcq', text: 'What force pulls objects towards the Earth?', options: [{ id: 'a', text: 'Friction', isCorrect: false }, { id: 'b', text: 'Magnetism', isCorrect: false }, { id: 'c', text: 'Gravity', isCorrect: true }, { id: 'd', text: 'Tension', isCorrect: false }] },
                { id: 'dq13', type: 'mcq', text: 'Plants make their food through a process called:', options: [{ id: 'a', text: 'Respiration', isCorrect: false }, { id: 'b', text: 'Photosynthesis', isCorrect: true }, { id: 'c', text: 'Digestion', isCorrect: false }, { id: 'd', text: 'Fermentation', isCorrect: false }] }
            ]
        },
        {
            title: 'Social Studies (Demo)',
            subject: 'Social Studies',
            targetClass: 'JSS 3',
            schoolLevel: 'Junior Secondary',
            duration: 35,
            passScore: 40,
            status: 'active',
            instructions: '<p>Answer all questions. The theory question requires a written response. <strong>This is a demo exam.</strong></p>',
            scrambleQuestions: false,
            questions: [
                { id: 'dq14', type: 'mcq', text: 'What is the capital city of Nigeria?', options: [{ id: 'a', text: 'Lagos', isCorrect: false }, { id: 'b', text: 'Abuja', isCorrect: true }, { id: 'c', text: 'Kano', isCorrect: false }, { id: 'd', text: 'Port Harcourt', isCorrect: false }] },
                { id: 'dq15', type: 'mcq', text: 'Democracy means government of the people, by the people, and for the:', options: [{ id: 'a', text: 'President', isCorrect: false }, { id: 'b', text: 'Military', isCorrect: false }, { id: 'c', text: 'People', isCorrect: true }, { id: 'd', text: 'Wealthy', isCorrect: false }] },
                { id: 'dq16', type: 'mcq', text: 'Which of these is a civic responsibility?', options: [{ id: 'a', text: 'Watching TV', isCorrect: false }, { id: 'b', text: 'Voting in elections', isCorrect: true }, { id: 'c', text: 'Playing football', isCorrect: false }, { id: 'd', text: 'Sleeping early', isCorrect: false }] },
                { id: 'dq17', type: 'theory', text: 'Explain two benefits of living in a democratic society.', options: [] }
            ]
        }
    ];

    var demoModalOverlay, demoCountdownTimer;

    function initDemo() {
        demoModalOverlay = document.getElementById('demo-modal-overlay');
        if (!demoModalOverlay) return;

        wireButton('landing-demo-btn', openDemoModal);
        wireButton('landing-cta-demo', openDemoModal);
        wireButton('demo-modal-close', closeDemoModal);
        wireButton('demo-pick-teacher', function () { handleDemoChoice('teacher'); });
        wireButton('demo-pick-student', function () { handleDemoChoice('student'); });
        wireButton('demo-retry-btn', function () { showDemoStep('select'); });

        // Close on overlay click (not modal itself)
        demoModalOverlay.addEventListener('click', function (e) {
            if (e.target === demoModalOverlay) closeDemoModal();
        });

        // Copy buttons
        var copyBtns = demoModalOverlay.querySelectorAll('.demo-copy-btn');
        for (var i = 0; i < copyBtns.length; i++) {
            copyBtns[i].addEventListener('click', function () {
                var targetId = this.getAttribute('data-copy');
                var el = document.getElementById(targetId);
                if (el && navigator.clipboard) {
                    navigator.clipboard.writeText(el.textContent);
                }
            });
        }
    }

    function openDemoModal() {
        // Rate limit: 5 minutes between demo creations
        var lastCreated = localStorage.getItem('demo_last_created');
        if (lastCreated && (Date.now() - parseInt(lastCreated, 10)) < 300000) {
            var remaining = Math.ceil((300000 - (Date.now() - parseInt(lastCreated, 10))) / 60000);
            alert('Please wait ' + remaining + ' minute(s) before creating another demo account.');
            return;
        }

        showDemoStep('select');
        demoModalOverlay.style.display = 'flex';

        // Re-render lucide icons inside the modal
        if (window.lucide) lucide.createIcons({ attrs: { 'stroke-width': 2 } });
    }

    function closeDemoModal() {
        demoModalOverlay.style.display = 'none';
        if (demoCountdownTimer) {
            clearInterval(demoCountdownTimer);
            demoCountdownTimer = null;
        }
    }

    function showDemoStep(stepName) {
        var steps = demoModalOverlay.querySelectorAll('.demo-step');
        for (var i = 0; i < steps.length; i++) {
            steps[i].style.display = 'none';
        }
        var target = document.getElementById('demo-step-' + stepName);
        if (target) target.style.display = '';
    }

    function showDemoError(msg) {
        document.getElementById('demo-error-msg').textContent = msg;
        showDemoStep('error');
    }

    async function handleDemoChoice(role) {
        showDemoStep('loading');

        var sessionId = Math.random().toString(36).substr(2, 8);
        var expiry = Date.now() + 3600000; // 1 hour
        var schoolVersion = 'DEMO_' + expiry + '_' + sessionId;
        var username = 'demo_' + role.charAt(0) + '_' + sessionId;
        var password = 'Demo' + Math.random().toString(36).substr(2, 8) + '!';

        try {
            // Register the demo user
            await dataService.registerUser({
                username: username,
                password: password,
                role: role,
                name: role === 'teacher' ? 'Demo Teacher' : 'Demo Student',
                classLevel: role === 'student' ? 'JSS3' : null,
                schoolVersion: schoolVersion
            });

            // Login
            await dataService.login(username, password);

            // For teacher demos, seed demo exams under this teacher
            if (role === 'teacher') {
                var user = dataService.getCurrentUser();
                if (user) {
                    await seedDemoExams(user.id);
                }
            }

            // Store demo expiry for the banner
            localStorage.setItem('demo_expiry', expiry.toString());
            localStorage.setItem('demo_last_created', Date.now().toString());

            // Show credentials
            document.getElementById('demo-cred-username').textContent = username;
            document.getElementById('demo-cred-password').textContent = password;
            showDemoStep('credentials');

            if (window.lucide) lucide.createIcons({ attrs: { 'stroke-width': 2 } });

            // Auto-login countdown (3 seconds)
            var count = 3;
            var countdownEl = document.getElementById('demo-countdown');
            countdownEl.textContent = count;

            demoCountdownTimer = setInterval(function () {
                count--;
                countdownEl.textContent = count;
                if (count <= 0) {
                    clearInterval(demoCountdownTimer);
                    demoCountdownTimer = null;
                    // replace(), so Back from the dashboard does not return to
                    // the landing page's demo countdown and re-trigger it.
                    if (role === 'teacher') {
                        window.location.replace('pages/teacher-dashboard.html');
                    } else {
                        window.location.replace('pages/student-dashboard.html');
                    }
                }
            }, 1000);

        } catch (err) {
            console.error('[Demo] Error:', err);
            showDemoError(err.message || 'Failed to create demo account. Please try again.');
        }
    }

    async function seedDemoExams(teacherId) {
        for (var i = 0; i < DEMO_EXAMS.length; i++) {
            var exam = DEMO_EXAMS[i];
            try {
                await dataService.createExam({
                    title: exam.title,
                    subject: exam.subject,
                    targetClass: exam.targetClass,
                    schoolLevel: exam.schoolLevel,
                    duration: exam.duration,
                    passScore: exam.passScore,
                    status: exam.status,
                    instructions: exam.instructions,
                    scrambleQuestions: exam.scrambleQuestions,
                    questions: exam.questions,
                    createdBy: teacherId,
                    _clientId: 'demo_' + teacherId + '_' + i
                });
            } catch (e) {
                console.warn('[Demo] Failed to create exam:', exam.title, e.message);
            }
        }
    }

    // ── Start ────────────────────────────────────────────────────────
    init();
})();
