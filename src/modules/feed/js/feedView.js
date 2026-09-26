/**
 * School feed view — an X/Twitter-shaped timeline.
 * Backed by window.dataService (PocketBase) via feedDataService.
 *
 * Structure:
 *   - Tabs: Timeline / Saved / My posts / Reports (admin only)
 *   - Composer at the top of the timeline, shown only if this user may post
 *   - Posts render with like / repost / comment / save, each with its count
 *   - Clicking a post opens the thread view: the post larger, then its comments
 *   - Post menu: delete (own or admin), pin (admin), report (anyone else's)
 *
 * TWO DELIBERATE CHOICES WORTH KEEPING
 *
 * 1. No realtime subscription. The timeline refreshes when the tab regains
 *    focus and on pull-to-refresh. SSE-subscription accumulation is what caused
 *    the v1.9.7 slowdown, and a school feed does not need live updates.
 *
 * 2. Optimistic likes and saves. The count and the icon change the instant you
 *    tap, then the request goes out and the change is rolled back if it fails.
 *    Anything slower feels broken on a phone on a slow connection — which is
 *    most of this app's users.
 */

(function (global) {
    'use strict';

    const PER_PAGE = 20;

    const feedView = {
        tab: 'timeline',
        view: 'timeline',            // 'timeline' | 'thread'
        posts: [],
        interactions: {},
        page: 1,
        totalPages: 0,
        settings: { whoCanPost: 'staff', whoCanComment: 'everyone' },
        abilities: { canPost: false, canComment: true, canModerate: false, canConfigure: false, isAdmin: false },
        pendingFiles: [],
        previewUrls: [],
        threadPost: null,
        comments: [],
        reports: [],
        openReportCount: 0,
        menuPostId: null,
        reportTargetId: null,
        loading: false,
        lastRefreshAt: 0,

        async init() {
            const user = global.dataService?.getCurrentUser?.();
            if (!user) {
                global.location.href = '../index.html';
                return;
            }

            this.cache();
            this.bind();

            this.settings = await global.dataService.getFeedSettings();
            this.abilities = global.dataService.getFeedAbilities(this.settings);

            this.renderTabs();
            this.renderComposer();
            await this.refresh({ reset: true });
        },

        cache() {
            this.nodes = {
                userName: document.getElementById('user-name'),
                userAvatar: document.getElementById('sidebar-avatar'),
                userRole: document.getElementById('feed-user-role'),

                tabs: document.getElementById('feed-tabs'),
                timelineView: document.getElementById('feed-timeline-view'),
                threadView: document.getElementById('feed-thread-view'),
                composerHost: document.getElementById('feed-composer-host'),
                list: document.getElementById('feed-list'),
                loadMore: document.getElementById('feed-load-more'),
                threadHost: document.getElementById('feed-thread-host'),
                backBtn: document.getElementById('feed-back-btn'),
                settingsBtn: document.getElementById('feed-settings-btn'),

                menu: document.getElementById('feed-menu'),

                reportModal: document.getElementById('feed-report-modal'),
                reportForm: document.getElementById('feed-report-form'),
                reportReason: document.getElementById('feed-report-reason'),
                reportNote: document.getElementById('feed-report-note'),
                reportClose: document.getElementById('feed-report-close'),
                reportCancel: document.getElementById('feed-report-cancel'),

                settingsModal: document.getElementById('feed-settings-modal'),
                settingsForm: document.getElementById('feed-settings-form'),
                settingsClose: document.getElementById('feed-settings-close'),
                settingsCancel: document.getElementById('feed-settings-cancel'),

                lightbox: document.getElementById('feed-lightbox'),
                lightboxImg: document.getElementById('feed-lightbox-img'),
                lightboxClose: document.getElementById('feed-lightbox-close')
            };
        },

        bind() {
            const user = global.dataService.getCurrentUser();
            if (this.nodes.userName) this.nodes.userName.textContent = user.name || user.username || 'User';
            if (this.nodes.userAvatar) {
                this.nodes.userAvatar.textContent = (user.name || user.username || 'U').trim().charAt(0).toUpperCase();
            }
            if (this.nodes.userRole) {
                this.nodes.userRole.textContent = this.roleLabel(user.role) || 'Member';
            }

            if (this.nodes.tabs) {
                this.nodes.tabs.addEventListener('click', (event) => {
                    const tab = event.target.closest('[data-tab]');
                    if (!tab) return;
                    this.switchTab(tab.getAttribute('data-tab'));
                });
            }

            if (this.nodes.backBtn) this.nodes.backBtn.addEventListener('click', () => this.showTimeline());

            if (this.nodes.loadMore) {
                this.nodes.loadMore.addEventListener('click', () => this.loadMore());
            }

            if (this.nodes.settingsBtn) {
                this.nodes.settingsBtn.addEventListener('click', () => this.openSettings());
            }

            // Delegated post interactions — one listener for the whole list
            // instead of rebinding every button on every render.
            [this.nodes.list, this.nodes.threadHost].forEach((host) => {
                if (host) host.addEventListener('click', (event) => this.handleListClick(event));
            });

            if (this.nodes.composerHost) {
                this.nodes.composerHost.addEventListener('click', (event) => this.handleComposerClick(event));
                this.nodes.composerHost.addEventListener('input', (event) => this.handleComposerInput(event));
            }

            // Report modal
            [this.nodes.reportClose, this.nodes.reportCancel].forEach((btn) => {
                if (btn) btn.addEventListener('click', () => this.closeReport());
            });
            if (this.nodes.reportModal) {
                this.nodes.reportModal.addEventListener('click', (event) => {
                    if (event.target === this.nodes.reportModal) this.closeReport();
                });
            }
            if (this.nodes.reportForm) {
                this.nodes.reportForm.addEventListener('submit', (event) => this.handleReportSubmit(event));
            }

            // Settings modal
            [this.nodes.settingsClose, this.nodes.settingsCancel].forEach((btn) => {
                if (btn) btn.addEventListener('click', () => this.closeSettings());
            });
            if (this.nodes.settingsModal) {
                this.nodes.settingsModal.addEventListener('click', (event) => {
                    if (event.target === this.nodes.settingsModal) this.closeSettings();
                });
                this.nodes.settingsModal.addEventListener('change', () => this.syncSettingsRadios());
            }
            if (this.nodes.settingsForm) {
                this.nodes.settingsForm.addEventListener('submit', (event) => this.handleSettingsSubmit(event));
            }

            // Lightbox
            if (this.nodes.lightboxClose) this.nodes.lightboxClose.addEventListener('click', () => this.closeLightbox());
            if (this.nodes.lightbox) {
                this.nodes.lightbox.addEventListener('click', (event) => {
                    if (event.target === this.nodes.lightbox) this.closeLightbox();
                });
            }

            // Close the post menu on any outside click or scroll.
            document.addEventListener('click', (event) => {
                if (!this.nodes.menu) return;
                if (event.target.closest('.feed-post-menu') || event.target.closest('#feed-menu')) return;
                this.closeMenu();
            });
            global.addEventListener('scroll', () => this.closeMenu(), true);

            document.addEventListener('keydown', (event) => {
                if (event.key !== 'Escape') return;
                this.closeMenu();
                this.closeLightbox();
                this.closeReport();
                this.closeSettings();
            });

            // Refresh when the tab comes back into focus. This is the whole of
            // the "live updates" story, on purpose — no SSE subscription.
            global.addEventListener('focus', () => {
                if (Date.now() - this.lastRefreshAt < 30 * 1000) return;
                if (this.view === 'timeline') this.refresh({ reset: true });
            });

            const logout = document.getElementById('feed-logout-btn');
            if (logout) {
                logout.addEventListener('click', () => {
                    if (global.auth?.logout) global.auth.logout();
                    else global.location.href = '../index.html';
                });
            }
        },

        // ============================================================
        // Tabs
        // ============================================================

        renderTabs() {
            if (!this.nodes.tabs) return;
            const tabs = [
                { id: 'timeline', label: 'Timeline' },
                { id: 'saved', label: 'Saved' },
                { id: 'mine', label: 'My posts' }
            ];
            if (this.abilities.canModerate) tabs.push({ id: 'reports', label: 'Reports' });

            this.nodes.tabs.innerHTML = tabs.map((tab) => {
                const badge = (tab.id === 'reports' && this.openReportCount > 0)
                    ? '<span class="feed-tab-badge">' + this.openReportCount + '</span>'
                    : '';
                return '<button type="button" class="feed-tab' + (tab.id === this.tab ? ' active' : '') +
                    '" data-tab="' + tab.id + '">' + tab.label + badge + '</button>';
            }).join('');

            if (this.nodes.settingsBtn) {
                this.nodes.settingsBtn.style.display = this.abilities.canConfigure ? '' : 'none';
            }
        },

        async switchTab(tab) {
            if (!tab || tab === this.tab) return;
            this.tab = tab;
            this.page = 1;
            this.renderTabs();
            this.renderComposer();
            await this.refresh({ reset: true });
        },

        // ============================================================
        // Composer
        // ============================================================

        renderComposer() {
            const host = this.nodes.composerHost;
            if (!host) return;

            // The composer belongs to the timeline. Saved / My posts / Reports
            // are reading views.
            if (this.tab !== 'timeline') {
                host.innerHTML = '';
                return;
            }

            if (!this.abilities.canPost) {
                host.innerHTML = '' +
                    '<div class="feed-notice">' +
                        '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>' +
                        '<span>Only staff can post to the school feed right now. You can still like, repost, comment and save.</span>' +
                    '</div>';
                return;
            }

            const user = global.dataService.getCurrentUser() || {};
            const initial = (user.name || user.username || 'U').trim().charAt(0).toUpperCase();
            const maxBody = global.dataService.FEED_MAX_BODY;
            const maxTitle = global.dataService.FEED_MAX_TITLE;
            const maxImages = global.dataService.FEED_MAX_IMAGES;

            host.innerHTML = '' +
                '<div class="feed-composer">' +
                    '<div class="feed-avatar">' + this.escape(initial) + '</div>' +
                    '<div class="feed-composer-body">' +
                        '<input type="text" class="feed-composer-title" id="feed-title" maxlength="' + maxTitle + '" placeholder="Title">' +
                        '<textarea class="feed-composer-text" id="feed-body" maxlength="' + (maxBody + 50) + '" placeholder="Share something with the school…"></textarea>' +
                        '<div class="feed-composer-previews" id="feed-previews"></div>' +
                        '<div class="feed-composer-foot">' +
                            '<div class="feed-composer-tools">' +
                                '<button type="button" class="feed-icon-btn" data-action="pick-image" title="Add image (up to ' + maxImages + ')" aria-label="Add image">' +
                                    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>' +
                                '</button>' +
                                '<input type="file" id="feed-file-input" accept="image/*" multiple hidden>' +
                            '</div>' +
                            '<div class="feed-composer-right">' +
                                '<span class="feed-counter" id="feed-counter">0 / ' + maxBody + '</span>' +
                                '<button type="button" class="feed-btn primary" data-action="submit-post" id="feed-post-btn">Post</button>' +
                            '</div>' +
                        '</div>' +
                        '<div class="feed-status-msg" id="feed-composer-status" style="padding:8px 0 0;"></div>' +
                    '</div>' +
                '</div>';

            const input = document.getElementById('feed-file-input');
            if (input) {
                input.addEventListener('change', () => {
                    this.addFiles(input.files);
                    input.value = '';
                });
            }
        },

        handleComposerClick(event) {
            const action = event.target.closest('[data-action]')?.getAttribute('data-action');
            if (action === 'pick-image') {
                document.getElementById('feed-file-input')?.click();
                return;
            }
            if (action === 'submit-post') {
                this.submitPost();
                return;
            }
            const removeIndex = event.target.closest('[data-remove-index]')?.getAttribute('data-remove-index');
            if (removeIndex !== null && removeIndex !== undefined) {
                this.pendingFiles.splice(Number(removeIndex), 1);
                this.renderPreviews();
            }
        },

        handleComposerInput(event) {
            if (event.target.id !== 'feed-body') return;
            const max = global.dataService.FEED_MAX_BODY;
            const length = event.target.value.length;
            const counter = document.getElementById('feed-counter');
            if (!counter) return;
            counter.textContent = length + ' / ' + max;
            counter.classList.toggle('over', length > max);
            counter.classList.toggle('warn', length <= max && length > max - 100);
        },

        async addFiles(fileList) {
            const incoming = Array.from(fileList || []);
            if (!incoming.length) return;

            const max = global.dataService.FEED_MAX_IMAGES;
            const room = max - this.pendingFiles.length;
            if (room <= 0) {
                this.setComposerStatus('You can attach at most ' + max + ' images.', 'error');
                return;
            }
            if (incoming.length > room) {
                this.setComposerStatus('Only ' + room + ' more image' + (room === 1 ? '' : 's') + ' can be added.', 'error');
                return;
            }

            this.setComposerStatus('Preparing images…', 'info');
            try {
                for (const file of incoming) {
                    this.pendingFiles.push(await global.imageUpload.prepare(file));
                }
                this.setComposerStatus('', '');
            } catch (error) {
                this.setComposerStatus(error.message || 'That image could not be used.', 'error');
            }
            this.renderPreviews();
        },

        renderPreviews() {
            const host = document.getElementById('feed-previews');
            if (!host) return;

            this.previewUrls.forEach((url) => URL.revokeObjectURL(url));
            this.previewUrls = [];

            host.innerHTML = this.pendingFiles.map((file, index) => {
                const url = URL.createObjectURL(file);
                this.previewUrls.push(url);
                return '' +
                    '<div class="feed-composer-preview">' +
                        '<img src="' + url + '" alt="Attachment ' + (index + 1) + '">' +
                        '<button type="button" class="feed-preview-remove" data-remove-index="' + index + '" aria-label="Remove image">&times;</button>' +
                    '</div>';
            }).join('');
        },

        clearComposer() {
            this.previewUrls.forEach((url) => URL.revokeObjectURL(url));
            this.previewUrls = [];
            this.pendingFiles = [];
            const title = document.getElementById('feed-title');
            const body = document.getElementById('feed-body');
            if (title) title.value = '';
            if (body) body.value = '';
            const counter = document.getElementById('feed-counter');
            if (counter) {
                counter.textContent = '0 / ' + global.dataService.FEED_MAX_BODY;
                counter.classList.remove('over', 'warn');
            }
            this.renderPreviews();
        },

        async submitPost() {
            if (this.loading) return;
            const title = document.getElementById('feed-title')?.value || '';
            const body = document.getElementById('feed-body')?.value || '';
            const btn = document.getElementById('feed-post-btn');

            this.loading = true;
            if (btn) btn.disabled = true;
            this.setComposerStatus('Posting…', 'info');

            try {
                await global.dataService.createFeedPost({
                    title,
                    body,
                    files: this.pendingFiles
                });
                this.clearComposer();
                this.setComposerStatus('', '');
                await this.refresh({ reset: true });
            } catch (error) {
                this.setComposerStatus(this.friendlyError(error, 'Your post could not be sent.'), 'error');
            } finally {
                this.loading = false;
                if (btn) btn.disabled = false;
            }
        },

        setComposerStatus(message, kind) {
            const node = document.getElementById('feed-composer-status');
            if (!node) return;
            node.textContent = message || '';
            node.className = 'feed-status-msg' + (kind ? ' ' + kind : '');
            node.style.padding = '8px 0 0';
        },

        // ============================================================
        // Data
        // ============================================================

        async refresh({ reset = false } = {}) {
            if (reset) this.page = 1;
            this.lastRefreshAt = Date.now();

            try {
                if (this.tab === 'reports') {
                    this.reports = await global.dataService.getFeedReports({ status: 'open' });
                    this.openReportCount = this.reports.length;
                    this.renderTabs();
                    this.renderReports();
                    if (this.nodes.loadMore) this.nodes.loadMore.style.display = 'none';
                    return;
                }

                let items = [];
                if (this.tab === 'saved') {
                    items = await global.dataService.getSavedFeedPosts();
                    this.totalPages = 1;
                } else if (this.tab === 'mine') {
                    items = await global.dataService.getMyFeedPosts();
                    this.totalPages = 1;
                } else {
                    const result = await global.dataService.getFeedTimeline({
                        page: this.page,
                        perPage: PER_PAGE
                    });
                    items = result.items;
                    this.totalPages = result.totalPages;
                }

                this.posts = (reset || this.page === 1) ? items : this.posts.concat(items);
                await this.loadInteractions();

                if (this.abilities.canModerate) {
                    this.openReportCount = await global.dataService.getOpenFeedReportCount();
                    this.renderTabs();
                }
            } catch (error) {
                console.error('[feedView] refresh failed:', error);
                this.renderError(this.friendlyError(error, 'Could not load the feed.'));
                return;
            }

            this.renderTimeline();
        },

        /**
         * One batched lookup for the whole visible page — never per post.
         * The ids include the originals behind any reposts, so the action bar on
         * a repost reflects your state on the thing being reposted.
         */
        async loadInteractions() {
            const ids = [];
            this.posts.forEach((post) => {
                ids.push(post.id);
                if (post.repostOfId) ids.push(post.repostOfId);
            });
            const unique = Array.from(new Set(ids.filter(Boolean)));
            if (!unique.length) {
                this.interactions = {};
                return;
            }
            this.interactions = await global.dataService.getMyFeedInteractions(unique);
        },

        async loadMore() {
            if (this.page >= this.totalPages || this.loading) return;
            this.loading = true;
            if (this.nodes.loadMore) this.nodes.loadMore.disabled = true;
            this.page += 1;
            await this.refresh();
            this.loading = false;
            if (this.nodes.loadMore) this.nodes.loadMore.disabled = false;
        },

        // ============================================================
        // Rendering
        // ============================================================

        renderTimeline() {
            const list = this.nodes.list;
            if (!list) return;

            if (!this.posts.length) {
                list.innerHTML = this.emptyState();
                if (this.nodes.loadMore) this.nodes.loadMore.style.display = 'none';
                return;
            }

            list.innerHTML = this.posts.map((post) => this.postHtml(post)).join('');

            if (this.nodes.loadMore) {
                const more = this.tab === 'timeline' && this.page < this.totalPages;
                this.nodes.loadMore.style.display = more ? '' : 'none';
            }
        },

        /**
         * One post row. `focused` renders the larger thread-head variant.
         *
         * A repost renders as the reposter's attribution line plus a quote block
         * of the original, and its action bar acts on the ORIGINAL — liking a
         * repost likes the post itself, which is what users expect.
         */
        postHtml(post, { focused = false } = {}) {
            const subject = post.repostOf || post;
            const actingId = post.repostOfId || post.id;
            const state = this.interactions[actingId] || {};

            const initial = (post.authorName || 'U').trim().charAt(0).toUpperCase();

            const pinnedLabel = post.pinned
                ? '<div class="feed-pinned-label">' +
                    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14l-1.4-4.2a2 2 0 01.3-1.9L20 9V2H4v7l2.1 1.9a2 2 0 01.3 1.9L5 17z"/></svg>' +
                    'Pinned by the school' +
                  '</div>'
                : '';

            const menuBtn =
                '<button type="button" class="feed-post-menu" data-menu-for="' + this.escape(post.id) + '" aria-label="Post options">' +
                    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg>' +
                '</button>';

            // A REPOST shows the reposter once, then the original post — which
            // already carries its own author and role in the quote block. The
            // earlier version also put the original author in this header row,
            // so the same name and badge appeared twice, one line apart.
            if (post.repostOfId) {
                return '' +
                    '<article class="feed-post' + (focused ? ' focused' : '') + '" data-post-id="' + this.escape(post.id) + '">' +
                        '<div class="feed-avatar' + (focused ? '' : ' sm') + '">' + this.escape(initial) + '</div>' +
                        '<div class="feed-post-body">' +
                            pinnedLabel +
                            '<div class="feed-post-head">' +
                                '<div class="feed-repost-label">' +
                                    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 014-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 01-4 4H3"/></svg>' +
                                    this.escape(post.authorName) + ' reposted' +
                                '</div>' +
                                '<span class="feed-dot">&middot;</span>' +
                                '<span class="feed-time">' + this.timeAgo(post.createdAt) + '</span>' +
                                menuBtn +
                            '</div>' +
                            this.quoteHtml(post.repostOf) +
                            this.actionsHtml(subject, state, actingId) +
                        '</div>' +
                    '</article>';
            }

            return '' +
                '<article class="feed-post' + (focused ? ' focused' : '') + '" data-post-id="' + this.escape(post.id) + '">' +
                    '<div class="feed-avatar' + (focused ? '' : ' sm') + '">' + this.escape(initial) + '</div>' +
                    '<div class="feed-post-body">' +
                        pinnedLabel +
                        '<div class="feed-post-head">' +
                            '<span class="feed-author">' + this.escape(post.authorName || 'Someone') + '</span>' +
                            (post.authorRole && post.authorRole !== 'student'
                                ? '<span class="feed-role-badge">' + this.escape(this.roleLabel(post.authorRole)) + '</span>'
                                : '') +
                            '<span class="feed-dot">&middot;</span>' +
                            '<span class="feed-time">' + this.timeAgo(post.createdAt) + '</span>' +
                            menuBtn +
                        '</div>' +
                        (post.title ? '<h3 class="feed-post-title">' + this.escape(post.title) + '</h3>' : '') +
                        (post.body ? '<p class="feed-post-text">' + this.linkify(post.body) + '</p>' : '') +
                        this.imagesHtml(post) +
                        this.actionsHtml(subject, state, actingId) +
                    '</div>' +
                '</article>';
        },

        quoteHtml(original) {
            if (!original) {
                return '<div class="feed-quote"><p class="feed-quote-missing">The original post has been deleted.</p></div>';
            }
            return '' +
                '<div class="feed-quote">' +
                    '<div class="feed-quote-head">' +
                        '<span class="feed-author">' + this.escape(original.authorName) + '</span>' +
                        (original.authorRole && original.authorRole !== 'student'
                            ? '<span class="feed-role-badge">' + this.escape(this.roleLabel(original.authorRole)) + '</span>'
                            : '') +
                        '<span class="feed-dot">&middot;</span>' +
                        '<span class="feed-time">' + this.timeAgo(original.createdAt) + '</span>' +
                    '</div>' +
                    (original.title ? '<h4 class="feed-quote-title">' + this.escape(original.title) + '</h4>' : '') +
                    (original.body ? '<p class="feed-quote-text">' + this.escape(original.body) + '</p>' : '') +
                    this.imagesHtml(original) +
                '</div>';
        },

        imagesHtml(post) {
            if (!post?.images?.length) return '';
            const cells = post.images.map((filename, index) => {
                // Thumbnails in the timeline; the original only in the lightbox.
                const url = global.dataService.getFeedImageUrl(post, filename, { thumb: '600x0' });
                return '<button type="button" class="feed-image" data-image-post="' + this.escape(post.id) + '" data-image-index="' + index + '">' +
                    '<img src="' + this.escape(url) + '" alt="Attachment ' + (index + 1) + '" loading="lazy">' +
                '</button>';
            }).join('');
            return '<div class="feed-images count-' + post.images.length + '">' + cells + '</div>';
        },

        actionsHtml(subject, state, actingId) {
            const counts = subject || {};
            const n = (value) => (value > 0 ? '<span>' + this.formatCount(value) + '</span>' : '');

            return '' +
                '<div class="feed-actions">' +
                    '<button type="button" class="feed-action comment" data-act="comment" data-target="' + this.escape(actingId) + '" aria-label="Comment">' +
                        '<svg viewBox="0 0 24 24" stroke="currentColor"><path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z"/></svg>' +
                        n(counts.commentCount) +
                    '</button>' +
                    '<button type="button" class="feed-action repost' + (state.repostRowId ? ' active' : '') + '" data-act="repost" data-target="' + this.escape(actingId) + '" aria-label="Repost">' +
                        '<svg viewBox="0 0 24 24" stroke="currentColor"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 014-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 01-4 4H3"/></svg>' +
                        n(counts.repostCount) +
                    '</button>' +
                    '<button type="button" class="feed-action like' + (state.liked ? ' active' : '') + '" data-act="like" data-target="' + this.escape(actingId) + '" aria-label="Like">' +
                        '<svg viewBox="0 0 24 24" stroke="currentColor"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg>' +
                        n(counts.likeCount) +
                    '</button>' +
                    '<button type="button" class="feed-action save' + (state.saved ? ' active' : '') + '" data-act="save" data-target="' + this.escape(actingId) + '" aria-label="Save">' +
                        '<svg viewBox="0 0 24 24" stroke="currentColor"><path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z"/></svg>' +
                        n(counts.saveCount) +
                    '</button>' +
                '</div>';
        },

        emptyState() {
            const map = {
                timeline: {
                    title: 'Nothing here yet',
                    text: this.abilities.canPost
                        ? 'Be the first to share something with the school.'
                        : 'When the school posts something, it will show up here.'
                },
                saved: {
                    title: 'No saved posts',
                    text: 'Tap the bookmark on a post to keep it here. Only you can see what you have saved.'
                },
                mine: {
                    title: 'You have not posted yet',
                    text: 'Anything you post to the school feed will be listed here.'
                }
            };
            const item = map[this.tab] || map.timeline;
            return '' +
                '<div class="feed-empty">' +
                    '<span class="feed-empty-icon">' +
                        '<svg viewBox="0 0 24 24" width="44" height="44" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z"/></svg>' +
                    '</span>' +
                    '<p class="feed-empty-title">' + item.title + '</p>' +
                    '<p class="feed-empty-text">' + item.text + '</p>' +
                '</div>';
        },

        renderError(message) {
            if (!this.nodes.list) return;
            this.nodes.list.innerHTML = '' +
                '<div class="feed-empty">' +
                    '<p class="feed-empty-title">Could not load the feed</p>' +
                    '<p class="feed-empty-text">' + this.escape(message) + '</p>' +
                '</div>';
        },

        // ============================================================
        // Interaction handling (delegated)
        // ============================================================

        handleListClick(event) {
            const menuBtn = event.target.closest('[data-menu-for]');
            if (menuBtn) {
                event.stopPropagation();
                this.openMenu(menuBtn.getAttribute('data-menu-for'), menuBtn);
                return;
            }

            const imageBtn = event.target.closest('[data-image-index]');
            if (imageBtn) {
                event.stopPropagation();
                this.openLightbox(
                    imageBtn.getAttribute('data-image-post'),
                    Number(imageBtn.getAttribute('data-image-index'))
                );
                return;
            }

            const action = event.target.closest('[data-act]');
            if (action) {
                event.stopPropagation();
                const act = action.getAttribute('data-act');
                const targetId = action.getAttribute('data-target');
                if (act === 'like' || act === 'save') this.toggleReaction(targetId, act, action);
                if (act === 'repost') this.toggleRepost(targetId, action);
                if (act === 'comment') this.showThread(targetId);
                return;
            }

            const commentSubmit = event.target.closest('[data-comment-submit]');
            if (commentSubmit) {
                event.stopPropagation();
                this.submitComment();
                return;
            }

            // Clicking anywhere else on a post opens its thread. Comments are
            // excluded: replies to replies are refused server-side, so opening a
            // comment as a thread would show a reply box that cannot be used.
            const post = event.target.closest('[data-post-id]');
            if (post && !post.classList.contains('focused') && !post.classList.contains('feed-comment')) {
                const id = post.getAttribute('data-post-id');
                const model = this.posts.find((p) => p.id === id);
                // A repost opens the original's thread — the conversation lives
                // on the post, not on the act of resharing it.
                this.showThread(model?.repostOfId || id);
            }
        },

        /**
         * Like / save with an optimistic flip. The icon and count change on tap
         * and roll back only if the server refuses — anything else feels broken
         * on a slow connection.
         */
        async toggleReaction(postId, type, buttonEl) {
            if (!postId) return;
            const state = this.interactions[postId] || { liked: false, saved: false, likeRowId: '', saveRowId: '' };
            this.interactions[postId] = state;

            const isLike = type === 'like';
            const wasActive = isLike ? state.liked : state.saved;
            const rowId = isLike ? state.likeRowId : state.saveRowId;
            const countField = isLike ? 'likeCount' : 'saveCount';

            // Optimistic
            if (isLike) state.liked = !wasActive; else state.saved = !wasActive;
            this.adjustCount(postId, countField, wasActive ? -1 : 1);
            this.paintAction(buttonEl, !wasActive, this.countFor(postId, countField));

            try {
                const result = await global.dataService.toggleFeedInteraction(postId, type, rowId);
                if (isLike) state.likeRowId = result.rowId; else state.saveRowId = result.rowId;
            } catch (error) {
                // Roll back
                if (isLike) state.liked = wasActive; else state.saved = wasActive;
                this.adjustCount(postId, countField, wasActive ? 1 : -1);
                this.paintAction(buttonEl, wasActive, this.countFor(postId, countField));
                this.notify('Could not do that', this.escape(this.friendlyError(error, 'Your reaction was not saved.')));
            }
        },

        async toggleRepost(postId, buttonEl) {
            if (!postId) return;
            const state = this.interactions[postId] || {};
            this.interactions[postId] = state;
            const existing = state.repostRowId || '';

            try {
                const result = await global.dataService.toggleFeedRepost(postId, existing);
                state.repostRowId = result.rowId;
                this.adjustCount(postId, 'repostCount', result.reposted ? 1 : -1);
                this.paintAction(buttonEl, result.reposted, this.countFor(postId, 'repostCount'));
                // A new repost is a new timeline row, and undoing one removes a
                // row — either way the list itself changed, so reload it.
                await this.refresh({ reset: true });
            } catch (error) {
                this.notify('Could not repost', this.escape(this.friendlyError(error, 'The repost did not go through.')));
            }
        },

        /** Update the in-memory count everywhere that post appears. */
        adjustCount(postId, field, delta) {
            const touch = (post) => {
                if (!post) return;
                post[field] = Math.max(0, Number(post[field] || 0) + delta);
            };
            this.posts.forEach((post) => {
                if (post.id === postId) touch(post);
                if (post.repostOf && post.repostOf.id === postId) touch(post.repostOf);
            });
            if (this.threadPost && this.threadPost.id === postId) touch(this.threadPost);
            this.comments.forEach((comment) => { if (comment.id === postId) touch(comment); });
        },

        countFor(postId, field) {
            const found = this.posts.find((post) => post.id === postId)
                || this.posts.map((post) => post.repostOf).find((post) => post && post.id === postId)
                || (this.threadPost && this.threadPost.id === postId ? this.threadPost : null)
                || this.comments.find((comment) => comment.id === postId);
            return found ? Number(found[field] || 0) : 0;
        },

        /** Repaint one action button without re-rendering the whole timeline. */
        paintAction(buttonEl, active, count) {
            if (!buttonEl) return;
            buttonEl.classList.toggle('active', !!active);
            const label = buttonEl.querySelector('span');
            if (count > 0) {
                if (label) label.textContent = this.formatCount(count);
                else buttonEl.insertAdjacentHTML('beforeend', '<span>' + this.formatCount(count) + '</span>');
            } else if (label) {
                label.remove();
            }
        },

        // ============================================================
        // Thread view
        // ============================================================

        async showThread(postId) {
            if (!postId) return;
            this.view = 'thread';
            if (this.nodes.timelineView) this.nodes.timelineView.classList.add('hidden');
            if (this.nodes.threadView) this.nodes.threadView.classList.add('active');
            if (this.nodes.threadHost) {
                this.nodes.threadHost.innerHTML = '<div class="feed-empty"><p class="feed-empty-text">Loading…</p></div>';
            }
            global.scrollTo({ top: 0, behavior: 'smooth' });

            try {
                const [post, comments] = await Promise.all([
                    global.dataService.getFeedPost(postId),
                    global.dataService.getFeedComments(postId)
                ]);
                if (!post) {
                    this.showTimeline();
                    this.notify('Post unavailable', 'That post has been deleted.');
                    return;
                }
                this.threadPost = post;
                this.comments = comments;

                const ids = [post.id].concat(comments.map((comment) => comment.id));
                const extra = await global.dataService.getMyFeedInteractions(ids);
                this.interactions = Object.assign({}, this.interactions, extra);

                this.renderThread();
            } catch (error) {
                console.error('[feedView] thread load failed:', error);
                if (this.nodes.threadHost) {
                    this.nodes.threadHost.innerHTML = '' +
                        '<div class="feed-empty">' +
                            '<p class="feed-empty-title">Could not open that post</p>' +
                            '<p class="feed-empty-text">' + this.escape(this.friendlyError(error, 'Try again in a moment.')) + '</p>' +
                        '</div>';
                }
            }
        },

        showTimeline() {
            this.view = 'timeline';
            this.threadPost = null;
            this.comments = [];
            if (this.nodes.threadView) this.nodes.threadView.classList.remove('active');
            if (this.nodes.timelineView) this.nodes.timelineView.classList.remove('hidden');
            this.renderTimeline();
        },

        renderThread() {
            const host = this.nodes.threadHost;
            if (!host || !this.threadPost) return;

            const user = global.dataService.getCurrentUser() || {};
            const initial = (user.name || user.username || 'U').trim().charAt(0).toUpperCase();
            const maxBody = global.dataService.FEED_MAX_BODY;

            const commentForm = this.abilities.canComment
                ? '<div class="feed-comment-form">' +
                    '<div class="feed-avatar sm">' + this.escape(initial) + '</div>' +
                    '<div style="flex:1; min-width:0;">' +
                        '<textarea class="feed-comment-input" id="feed-comment-input" maxlength="' + maxBody + '" placeholder="Write a comment…"></textarea>' +
                        '<div class="feed-comment-foot">' +
                            '<button type="button" class="feed-btn primary" data-comment-submit="1" id="feed-comment-btn">Reply</button>' +
                        '</div>' +
                        '<div class="feed-status-msg" id="feed-comment-status" style="padding:8px 0 0;"></div>' +
                    '</div>' +
                  '</div>'
                : '<div class="feed-notice">' +
                    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>' +
                    '<span>Only staff can comment on the school feed right now.</span>' +
                  '</div>';

            const comments = this.comments.length
                ? this.comments.map((comment) => this.commentHtml(comment)).join('')
                : '<div class="feed-empty"><p class="feed-empty-text">No comments yet. Be the first to reply.</p></div>';

            host.innerHTML =
                this.postHtml(this.threadPost, { focused: true }) +
                commentForm +
                comments;
        },

        commentHtml(comment) {
            const initial = (comment.authorName || 'U').trim().charAt(0).toUpperCase();
            const state = this.interactions[comment.id] || {};
            return '' +
                '<article class="feed-comment" data-post-id="' + this.escape(comment.id) + '">' +
                    '<div class="feed-avatar sm">' + this.escape(initial) + '</div>' +
                    '<div class="feed-comment-body">' +
                        '<div class="feed-post-head">' +
                            '<span class="feed-author">' + this.escape(comment.authorName) + '</span>' +
                            (comment.authorRole && comment.authorRole !== 'student'
                                ? '<span class="feed-role-badge">' + this.escape(this.roleLabel(comment.authorRole)) + '</span>'
                                : '') +
                            '<span class="feed-dot">&middot;</span>' +
                            '<span class="feed-time">' + this.timeAgo(comment.createdAt) + '</span>' +
                            '<button type="button" class="feed-post-menu" data-menu-for="' + this.escape(comment.id) + '" aria-label="Comment options">' +
                                '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg>' +
                            '</button>' +
                        '</div>' +
                        '<p class="feed-comment-text">' + this.linkify(comment.body) + '</p>' +
                        '<div class="feed-actions" style="max-width:200px;">' +
                            '<button type="button" class="feed-action like' + (state.liked ? ' active' : '') + '" data-act="like" data-target="' + this.escape(comment.id) + '" aria-label="Like">' +
                                '<svg viewBox="0 0 24 24" stroke="currentColor"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg>' +
                                (comment.likeCount > 0 ? '<span>' + this.formatCount(comment.likeCount) + '</span>' : '') +
                            '</button>' +
                        '</div>' +
                    '</div>' +
                '</article>';
        },

        async submitComment() {
            const input = document.getElementById('feed-comment-input');
            const btn = document.getElementById('feed-comment-btn');
            const status = document.getElementById('feed-comment-status');
            if (!input || !this.threadPost) return;

            const body = input.value.trim();
            if (!body) return;

            if (btn) btn.disabled = true;
            if (status) { status.textContent = 'Posting…'; status.className = 'feed-status-msg info'; }

            try {
                await global.dataService.createFeedComment(this.threadPost.id, body);
                input.value = '';
                if (status) status.textContent = '';
                // Reload the thread so the count and the new comment agree.
                await this.showThread(this.threadPost.id);
            } catch (error) {
                if (status) {
                    status.textContent = this.friendlyError(error, 'Your comment was not sent.');
                    status.className = 'feed-status-msg error';
                }
            } finally {
                if (btn) btn.disabled = false;
            }
        },

        // ============================================================
        // Post menu
        // ============================================================

        openMenu(postId, anchorEl) {
            const menu = this.nodes.menu;
            if (!menu || !postId) return;

            const post = this.posts.find((p) => p.id === postId)
                || (this.threadPost && this.threadPost.id === postId ? this.threadPost : null)
                || this.comments.find((c) => c.id === postId);
            if (!post) return;

            const user = global.dataService.getCurrentUser() || {};
            const isOwn = post.authorId === (user.id || user.user);
            const items = [];

            if (isOwn || this.abilities.canModerate) {
                items.push(
                    '<button type="button" class="feed-menu-item danger" data-menu-act="delete">' +
                        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>' +
                        (isOwn ? 'Delete post' : 'Delete (moderate)') +
                    '</button>'
                );
            }

            // Pinning only makes sense for a top-level post.
            if (this.abilities.canModerate && !post.replyTo && !post.repostOfId) {
                items.push(
                    '<button type="button" class="feed-menu-item" data-menu-act="pin">' +
                        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14l-1.4-4.2a2 2 0 01.3-1.9L20 9V2H4v7l2.1 1.9a2 2 0 01.3 1.9L5 17z"/></svg>' +
                        (post.pinned ? 'Unpin from top' : 'Pin to top') +
                    '</button>'
                );
            }

            if (!isOwn) {
                items.push(
                    '<button type="button" class="feed-menu-item danger" data-menu-act="report">' +
                        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>' +
                        'Report to the school' +
                    '</button>'
                );
            }

            if (!items.length) return;

            menu.innerHTML = items.join('');
            menu.classList.add('open');
            this.menuPostId = postId;

            // Position under the trigger, kept inside the viewport.
            const rect = anchorEl.getBoundingClientRect();
            const width = 210;
            let left = rect.right - width;
            if (left < 8) left = 8;
            if (left + width > global.innerWidth - 8) left = global.innerWidth - width - 8;
            menu.style.left = left + 'px';
            menu.style.top = (rect.bottom + 6) + 'px';

            menu.querySelectorAll('[data-menu-act]').forEach((btn) => {
                btn.addEventListener('click', () => {
                    const act = btn.getAttribute('data-menu-act');
                    this.closeMenu();
                    if (act === 'delete') this.handleDelete(post);
                    if (act === 'pin') this.handlePin(post);
                    if (act === 'report') this.openReport(post.id);
                });
            });
        },

        closeMenu() {
            if (this.nodes.menu) this.nodes.menu.classList.remove('open');
            this.menuPostId = null;
        },

        async handleDelete(post) {
            const ok = await this.askConfirm(
                'Delete this post?',
                'This removes it for everyone, along with its comments and reposts. This cannot be undone.'
            );
            if (!ok) return;

            try {
                await global.dataService.deleteFeedPost(post.id);
                if (this.view === 'thread' && this.threadPost?.id === post.id) {
                    this.showTimeline();
                    await this.refresh({ reset: true });
                } else if (this.view === 'thread') {
                    await this.showThread(this.threadPost.id);
                } else {
                    await this.refresh({ reset: true });
                }
            } catch (error) {
                this.notify('Could not delete', this.escape(this.friendlyError(error, 'The post was not deleted.')));
            }
        },

        async handlePin(post) {
            try {
                await global.dataService.setFeedPostPinned(post.id, !post.pinned);
                await this.refresh({ reset: true });
            } catch (error) {
                this.notify('Could not pin', this.escape(this.friendlyError(error, 'The post was not pinned.')));
            }
        },

        // ============================================================
        // Report
        // ============================================================

        openReport(postId) {
            this.reportTargetId = postId;
            if (this.nodes.reportNote) this.nodes.reportNote.value = '';
            if (this.nodes.reportReason) this.nodes.reportReason.value = 'inappropriate';
            if (this.nodes.reportModal) this.nodes.reportModal.classList.add('open');
        },

        closeReport() {
            if (this.nodes.reportModal) this.nodes.reportModal.classList.remove('open');
            this.reportTargetId = null;
        },

        async handleReportSubmit(event) {
            event.preventDefault();
            if (!this.reportTargetId) return;

            const reason = this.nodes.reportReason?.value || 'other';
            const note = this.nodes.reportNote?.value || '';
            const targetId = this.reportTargetId;

            this.closeReport();
            try {
                await global.dataService.reportFeedPost(targetId, { reason, note });
                this.notify('Reported', 'Thank you. A school admin will look at this post.');
            } catch (error) {
                this.notify('Could not report', this.escape(this.friendlyError(error, 'The report was not sent.')));
            }
        },

        renderReports() {
            const list = this.nodes.list;
            if (!list) return;

            if (!this.reports.length) {
                list.innerHTML = '' +
                    '<div class="feed-empty">' +
                        '<span class="feed-empty-icon">' +
                            '<svg viewBox="0 0 24 24" width="44" height="44" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>' +
                        '</span>' +
                        '<p class="feed-empty-title">Nothing reported</p>' +
                        '<p class="feed-empty-text">Posts flagged by students or staff show up here for you to review.</p>' +
                    '</div>';
                return;
            }

            list.innerHTML = this.reports.map((report) => {
                const post = report.post;
                const quote = post
                    ? '<div class="feed-report-quote">' +
                        '<div class="feed-quote-head">' +
                            '<span class="feed-author">' + this.escape(post.authorName) + '</span>' +
                            '<span class="feed-dot">&middot;</span>' +
                            '<span class="feed-time">' + this.timeAgo(post.createdAt) + '</span>' +
                        '</div>' +
                        (post.title ? '<h4 class="feed-quote-title">' + this.escape(post.title) + '</h4>' : '') +
                        (post.body ? '<p class="feed-quote-text">' + this.escape(post.body) + '</p>' : '') +
                      '</div>'
                    : '<div class="feed-report-quote"><p class="feed-quote-missing">The reported post has already been deleted.</p></div>';

                return '' +
                    '<div class="feed-report" data-report-id="' + this.escape(report.id) + '">' +
                        '<div class="feed-report-head">' +
                            '<span class="feed-report-reason">' + this.escape(report.reasonLabel) + '</span>' +
                            '<span class="feed-time">reported by ' + this.escape(report.reporterName) + ' &middot; ' + this.timeAgo(report.createdAt) + '</span>' +
                        '</div>' +
                        (report.note ? '<p class="feed-report-note">' + this.escape(report.note) + '</p>' : '') +
                        quote +
                        '<div class="feed-report-actions">' +
                            (post ? '<button type="button" class="feed-btn danger" data-report-act="delete" data-post="' + this.escape(report.postId) + '">Delete post</button>' : '') +
                            '<button type="button" class="feed-btn secondary" data-report-act="dismiss">Dismiss report</button>' +
                            (post ? '<button type="button" class="feed-btn secondary" data-report-act="open" data-post="' + this.escape(report.postId) + '">View in feed</button>' : '') +
                        '</div>' +
                    '</div>';
            }).join('');

            list.querySelectorAll('[data-report-act]').forEach((btn) => {
                btn.addEventListener('click', async (event) => {
                    event.stopPropagation();
                    const act = btn.getAttribute('data-report-act');
                    const reportId = btn.closest('[data-report-id]')?.getAttribute('data-report-id');
                    const postId = btn.getAttribute('data-post');

                    if (act === 'open' && postId) {
                        this.showThread(postId);
                        return;
                    }
                    try {
                        if (act === 'delete' && postId) {
                            const ok = await this.askConfirm(
                                'Delete this post?',
                                'This removes it for everyone and marks the report as actioned.'
                            );
                            if (!ok) return;
                            await global.dataService.deleteFeedPost(postId);
                            await global.dataService.resolveFeedReport(reportId, 'actioned');
                        }
                        if (act === 'dismiss') {
                            await global.dataService.resolveFeedReport(reportId, 'dismissed');
                        }
                        await this.refresh({ reset: true });
                    } catch (error) {
                        this.notify('Could not update', this.escape(this.friendlyError(error, 'The report was not updated.')));
                    }
                });
            });
        },

        // ============================================================
        // Settings (admin)
        // ============================================================

        openSettings() {
            const modal = this.nodes.settingsModal;
            if (!modal) return;
            modal.querySelectorAll('input[name="whoCanPost"]').forEach((input) => {
                input.checked = input.value === this.settings.whoCanPost;
            });
            modal.querySelectorAll('input[name="whoCanComment"]').forEach((input) => {
                input.checked = input.value === this.settings.whoCanComment;
            });
            this.syncSettingsRadios();
            modal.classList.add('open');
        },

        closeSettings() {
            if (this.nodes.settingsModal) this.nodes.settingsModal.classList.remove('open');
        },

        syncSettingsRadios() {
            const modal = this.nodes.settingsModal;
            if (!modal) return;
            modal.querySelectorAll('.feed-radio-row').forEach((row) => {
                const input = row.querySelector('input');
                row.classList.toggle('selected', !!input?.checked);
            });
        },

        async handleSettingsSubmit(event) {
            event.preventDefault();
            const modal = this.nodes.settingsModal;
            if (!modal) return;

            const whoCanPost = modal.querySelector('input[name="whoCanPost"]:checked')?.value || 'staff';
            const whoCanComment = modal.querySelector('input[name="whoCanComment"]:checked')?.value || 'everyone';

            try {
                this.settings = await global.dataService.saveFeedSettings({ whoCanPost, whoCanComment });
                this.abilities = global.dataService.getFeedAbilities(this.settings);
                this.closeSettings();
                this.renderComposer();
                await this.refresh({ reset: true });
            } catch (error) {
                this.notify('Could not save', this.escape(this.friendlyError(error, 'The setting was not saved.')));
            }
        },

        // ============================================================
        // Lightbox
        // ============================================================

        openLightbox(postId, index) {
            const post = this.posts.find((p) => p.id === postId)
                || this.posts.map((p) => p.repostOf).find((p) => p && p.id === postId)
                || (this.threadPost && this.threadPost.id === postId ? this.threadPost : null)
                || (this.threadPost?.repostOf?.id === postId ? this.threadPost.repostOf : null);
            if (!post || !post.images?.length || !this.nodes.lightboxImg) return;

            // Full size here only — the timeline uses 600px thumbnails.
            this.nodes.lightboxImg.src = global.dataService.getFeedImageUrl(post, post.images[index] || post.images[0]);
            if (this.nodes.lightbox) this.nodes.lightbox.classList.add('open');
        },

        closeLightbox() {
            if (this.nodes.lightbox) this.nodes.lightbox.classList.remove('open');
        },

        // ============================================================
        // Helpers
        // ============================================================

        roleLabel(role) {
            const map = {
                admin: 'Admin',
                super_admin: 'Admin',
                teacher: 'Teacher',
                student: 'Student'
            };
            return map[role] || '';
        },

        formatCount(value) {
            const n = Number(value || 0);
            if (n < 1000) return String(n);
            if (n < 1000000) return (n / 1000).toFixed(n < 10000 ? 1 : 0).replace(/\.0$/, '') + 'K';
            return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
        },

        timeAgo(value) {
            if (!value) return '';
            const date = new Date(value);
            if (isNaN(date.getTime())) return '';
            const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
            if (seconds < 60) return 'now';
            const minutes = Math.floor(seconds / 60);
            if (minutes < 60) return minutes + 'm';
            const hours = Math.floor(minutes / 60);
            if (hours < 24) return hours + 'h';
            const days = Math.floor(hours / 24);
            if (days < 7) return days + 'd';
            return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
        },

        escape(value) {
            const div = document.createElement('div');
            div.textContent = String(value == null ? '' : value);
            return div.innerHTML;
        },

        /**
         * Escape first, THEN turn bare URLs into links. Doing it the other way
         * round would let a crafted post inject markup.
         */
        linkify(text) {
            const safe = this.escape(text);
            return safe.replace(/(https?:\/\/[^\s<]+)/g, (url) =>
                '<a href="' + url + '" target="_blank" rel="noopener noreferrer" style="color:var(--primary); font-weight:600;">' + url + '</a>'
            );
        },

        askConfirm(title, message) {
            if (global.Utils && typeof global.Utils.showConfirm === 'function') {
                return global.Utils.showConfirm(title, message);
            }
            return Promise.resolve(global.confirm(String(message).replace(/<[^>]*>/g, '')));
        },

        notify(title, message) {
            if (global.Utils && typeof global.Utils.showAlert === 'function') {
                return global.Utils.showAlert(title, message);
            }
            global.alert(String(message).replace(/<[^>]*>/g, ''));
            return Promise.resolve();
        },

        friendlyError(error, fallback) {
            // PocketBase reports per-field validation failures as
            // data.data = { fieldName: { code, message } }. Without this the
            // whole thing collapses into a generic 400 and you cannot tell
            // WHICH field the server refused — which is exactly what made the
            // first round of "400 Bad Request" reports hard to act on.
            const fields = error?.data?.data;
            if (fields && typeof fields === 'object') {
                const names = Object.keys(fields);
                if (names.length) {
                    const first = fields[names[0]] || {};
                    return 'The server rejected "' + names[0] + '": ' + (first.message || 'invalid value');
                }
            }

            const message = error?.message || error?.data?.message || '';
            if (!message) return fallback;
            if (/only staff can post/i.test(message)) {
                return 'Only staff can post to the school feed right now.';
            }
            if (/only staff can comment/i.test(message)) {
                return 'Only staff can comment on the school feed right now.';
            }
            if (/no school assigned/i.test(message)) {
                return 'Your account has no school assigned yet. Ask the school office to set your School ID.';
            }
            if (/auth|login|unauthor|forbid/i.test(message)) {
                return 'You do not have permission to do that.';
            }
            if (/network|fetch|connect|offline/i.test(message)) {
                return 'Network error. The feed needs an internet connection.';
            }
            if (/collection.*feed_/i.test(message) || /not\s*found.*collection/i.test(message)) {
                return 'The feed collections are missing on the server. Run the feed migration on PocketBase.';
            }
            return message || fallback;
        }
    };

    global.feedView = feedView;
})(typeof globalThis !== 'undefined' ? globalThis : window);
