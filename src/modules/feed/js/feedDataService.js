/**
 * Feed Data Service
 * Extends window.dataService with school-feed functionality.
 * Persists to PocketBase: feed_posts, feed_interactions, feed_reports.
 * Must be loaded AFTER dataService.js (and after imageUpload.js to post images).
 *
 * THE THREE RULES THIS FILE IS BUILT AROUND
 *
 * 1. NO REALTIME. A feed begs for pb.collection().subscribe(), and SSE
 *    subscription accumulation on a 1GB Fly node is what caused both the
 *    bandwidth incident and the v1.9.7 slowdown. The view polls on window focus
 *    and on pull-to-refresh instead. Do not add a subscription here.
 *
 * 2. NO N+1. Everything the timeline needs beyond the posts themselves — which
 *    posts you liked, saved, or reposted — is fetched as ONE query with an OR
 *    chain across the visible ids, never a query per post. Counts come
 *    denormalised on the row, maintained by pb_hooks/feed_guard.pb.js.
 *
 * 3. IMAGES ARE FILES. Up to 2 per post, uploaded as multipart FormData into a
 *    PocketBase `file` field and read back through thumbnails. Never base64.
 */

(function (ds) {
    if (!ds) {
        console.error('[feedDataService] window.dataService not found — load dataService.js first');
        return;
    }

    const POSTS = 'feed_posts';
    const INTERACTIONS = 'feed_interactions';
    const REPORTS = 'feed_reports';
    const SETTINGS_KEY = 'feed_settings';

    // MAX 2 images per post. Mirrored in the collection schema (maxSelect: 2),
    // which is where it is actually enforced.
    const MAX_IMAGES = 2;
    const MAX_BODY = 1000;
    const MAX_TITLE = 120;

    ds.FEED_MAX_IMAGES = MAX_IMAGES;
    ds.FEED_MAX_BODY = MAX_BODY;
    ds.FEED_MAX_TITLE = MAX_TITLE;

    ds.FEED_REPORT_REASONS = {
        bullying: 'Bullying or harassment',
        inappropriate: 'Inappropriate content',
        spam: 'Spam',
        exam_leak: 'Exam content leak',
        false_info: 'False information',
        other: 'Something else'
    };

    function ownerId(user) {
        return user?.id || user?.user || null;
    }

    function isNotFound(error) {
        const status = error?.status ?? error?.statusCode;
        const message = String(error?.message || '').toLowerCase();
        return status === 404 || message.includes('404') || message.includes('not found');
    }

    /**
     * Build an OR-chained filter across a list of ids for one field.
     * PocketBase has no IN operator — the homework summary query does the same
     * thing, and it is the difference between one request and forty.
     */
    function orFilter(pb, field, ids, extraClause, extraParams) {
        const params = Object.assign({}, extraParams || {});
        const chain = ids.map((id, index) => {
            params['id' + index] = id;
            return field + ' = {:id' + index + '}';
        }).join(' || ');
        const whole = extraClause ? '(' + chain + ') && ' + extraClause : '(' + chain + ')';
        return pb.filter(whole, params);
    }

    ds._mapFeedPost = function (record) {
        if (!record) return null;
        const images = Array.isArray(record.images)
            ? record.images
            : (record.images ? [record.images] : []);

        const repostOf = record.expand?.repost_of
            ? ds._mapFeedPost(record.expand.repost_of)
            : null;

        return {
            id: record.id,
            title: record.title || '',
            body: record.body || '',
            authorId: record.author || '',
            authorName: record.author_name || 'Someone',
            authorRole: record.author_role || '',
            images,
            replyTo: record.reply_to || '',
            repostOfId: record.repost_of || '',
            repostOf,
            likeCount: Number(record.like_count || 0),
            repostCount: Number(record.repost_count || 0),
            commentCount: Number(record.comment_count || 0),
            saveCount: Number(record.save_count || 0),
            pinned: !!record.pinned,
            schoolVersion: record.school_version || '',
            createdAt: record.created,
            updatedAt: record.updated,
            _fileRef: {
                id: record.id,
                collectionId: record.collectionId,
                collectionName: record.collectionName || POSTS
            }
        };
    };

    /**
     * URL for a post image. Feed images are unprotected (they are visible to the
     * whole school by definition), so no file token is needed — which keeps them
     * cacheable and saves a round trip per timeline render.
     */
    ds.getFeedImageUrl = function (post, filename, { thumb = '' } = {}) {
        if (!post || !filename) return '';
        const ref = post._fileRef || post;
        const options = thumb ? { thumb } : {};
        try {
            return this.pb.files.getUrl(ref, filename, options);
        } catch (error) {
            if (typeof this.pb.getFileUrl === 'function') {
                return this.pb.getFileUrl(ref, filename, options);
            }
            return '';
        }
    };

    // ================================================================
    // Settings — who may post / comment in this school
    // ================================================================

    ds.getFeedSettings = async function () {
        const defaults = { whoCanPost: 'staff', whoCanComment: 'everyone' };
        try {
            const value = await this.getAppSetting(SETTINGS_KEY);
            if (!value || typeof value !== 'object') return defaults;
            return {
                whoCanPost: value.whoCanPost === 'everyone' ? 'everyone' : 'staff',
                whoCanComment: value.whoCanComment === 'staff' ? 'staff' : 'everyone'
            };
        } catch (error) {
            // Fail closed: if the setting cannot be read, assume the stricter
            // default rather than opening the feed up.
            console.warn('[Feed] could not read feed settings:', error?.message || error);
            return defaults;
        }
    };

    ds.saveFeedSettings = async function (settings = {}) {
        const value = {
            whoCanPost: settings.whoCanPost === 'everyone' ? 'everyone' : 'staff',
            whoCanComment: settings.whoCanComment === 'staff' ? 'staff' : 'everyone'
        };
        await this.saveAppSetting(SETTINGS_KEY, value);
        return value;
    };

    /**
     * What the signed-in user may do, given their role and the school's setting.
     * The UI uses this to hide affordances; feed_guard.pb.js enforces the same
     * thing server-side, because hiding a button is not enforcement.
     */
    ds.getFeedAbilities = function (settings) {
        const user = this.getCurrentUser() || {};
        const role = user.role || '';
        const isStaff = role === 'teacher' || role === 'admin' || role === 'super_admin';
        const isAdmin = role === 'admin' || role === 'super_admin';
        const cfg = settings || { whoCanPost: 'staff', whoCanComment: 'everyone' };

        return {
            role,
            isStaff,
            isAdmin,
            canPost: cfg.whoCanPost === 'everyone' ? true : isStaff,
            canComment: cfg.whoCanComment === 'staff' ? isStaff : true,
            canModerate: isAdmin,
            canConfigure: isAdmin
        };
    };

    // ================================================================
    // Timeline
    // ================================================================

    /**
     * The school timeline: top-level posts and reposts, newest first, pinned
     * first. Replies are excluded by `reply_to = ""` — they live under their
     * parent, not in the timeline.
     *
     * Returns { items, page, totalPages, totalItems }.
     */
    ds.getFeedTimeline = async function ({ page = 1, perPage = 20, search = '' } = {}) {
        const school = this.getSchoolContext();
        // "Not a comment". Both spellings are checked because an unset single
        // relation can land as "" or as null depending on how the row was
        // written — matching only one would silently hide half the timeline.
        const clauses = ['(reply_to = "" || reply_to = null)'];
        const params = {};

        if (school.schoolVersion) {
            clauses.push('school_version = {:sv}');
            params.sv = school.schoolVersion;
        }
        if (search) {
            clauses.push('(title ~ {:q} || body ~ {:q} || author_name ~ {:q})');
            params.q = search;
        }

        try {
            const result = await this.pb.collection(POSTS).getList(page, perPage, {
                filter: this.pb.filter(clauses.join(' && '), params),
                sort: '-pinned,-created',
                // One expand rather than a second fetch per repost.
                expand: 'repost_of'
            });
            return {
                items: result.items.map(ds._mapFeedPost),
                page: result.page,
                perPage: result.perPage,
                totalPages: result.totalPages,
                totalItems: result.totalItems
            };
        } catch (error) {
            if (isNotFound(error)) {
                return { items: [], page: 1, perPage, totalPages: 0, totalItems: 0 };
            }
            console.error('[Feed] getFeedTimeline error:', error);
            throw error;
        }
    };

    /**
     * The posts the signed-in user has saved. Two queries total: their save rows,
     * then the posts those rows point at.
     */
    ds.getSavedFeedPosts = async function () {
        const user = this.getCurrentUser();
        if (!user) return [];

        try {
            const saves = await this.pb.collection(INTERACTIONS).getFullList({
                filter: this.pb.filter('user = {:uid} && type = "save"', { uid: ownerId(user) }),
                sort: '-created'
            });
            const ids = saves.map((row) => row.post).filter(Boolean);
            if (!ids.length) return [];

            const records = await this.pb.collection(POSTS).getFullList({
                filter: orFilter(this.pb, 'id', ids),
                sort: '-created',
                expand: 'repost_of'
            });
            return records.map(ds._mapFeedPost);
        } catch (error) {
            if (isNotFound(error)) return [];
            console.error('[Feed] getSavedFeedPosts error:', error);
            throw error;
        }
    };

    ds.getMyFeedPosts = async function () {
        const user = this.getCurrentUser();
        if (!user) return [];
        try {
            const records = await this.pb.collection(POSTS).getFullList({
                filter: this.pb.filter('author = {:uid} && (reply_to = "" || reply_to = null)', { uid: ownerId(user) }),
                sort: '-created',
                expand: 'repost_of'
            });
            return records.map(ds._mapFeedPost);
        } catch (error) {
            if (isNotFound(error)) return [];
            console.error('[Feed] getMyFeedPosts error:', error);
            throw error;
        }
    };

    ds.getFeedPost = async function (postId) {
        if (!postId) return null;
        try {
            const record = await this.pb.collection(POSTS).getOne(postId, { expand: 'repost_of' });
            return ds._mapFeedPost(record);
        } catch (error) {
            if (isNotFound(error)) return null;
            throw error;
        }
    };

    ds.getFeedComments = async function (postId) {
        if (!postId) return [];
        try {
            const records = await this.pb.collection(POSTS).getFullList({
                filter: this.pb.filter('reply_to = {:pid}', { pid: postId }),
                sort: 'created'
            });
            return records.map(ds._mapFeedPost);
        } catch (error) {
            if (isNotFound(error)) return [];
            console.error('[Feed] getFeedComments error:', error);
            throw error;
        }
    };

    /**
     * For a batch of visible posts, what has the signed-in user done to each?
     *
     * TWO queries for the whole page, not two per post:
     *   - their like/save rows for these post ids
     *   - their repost rows pointing at these post ids
     *
     * Returns { [postId]: { liked, saved, likeRowId, saveRowId, repostRowId } }.
     */
    ds.getMyFeedInteractions = async function (postIds = []) {
        const user = this.getCurrentUser();
        const map = {};
        const ids = (postIds || []).filter(Boolean);
        if (!user || !ids.length) return map;

        ids.forEach((id) => {
            map[id] = { liked: false, saved: false, likeRowId: '', saveRowId: '', repostRowId: '' };
        });

        const uid = ownerId(user);

        try {
            const [rows, reposts] = await Promise.all([
                this.pb.collection(INTERACTIONS).getFullList({
                    filter: orFilter(this.pb, 'post', ids, 'user = {:uid}', { uid })
                }),
                this.pb.collection(POSTS).getFullList({
                    filter: orFilter(this.pb, 'repost_of', ids, 'author = {:uid}', { uid })
                })
            ]);

            rows.forEach((row) => {
                const entry = map[row.post];
                if (!entry) return;
                if (row.type === 'like') { entry.liked = true; entry.likeRowId = row.id; }
                if (row.type === 'save') { entry.saved = true; entry.saveRowId = row.id; }
            });

            reposts.forEach((row) => {
                const entry = map[row.repost_of];
                if (entry) entry.repostRowId = row.id;
            });
        } catch (error) {
            if (!isNotFound(error)) {
                console.warn('[Feed] getMyFeedInteractions failed:', error?.message || error);
            }
        }

        return map;
    };

    // ================================================================
    // Writing
    // ================================================================

    /**
     * Create a top-level post.
     * `files` must already be prepared by window.imageUpload.prepareMany.
     *
     * WHY `author` IS SENT even though the hook overwrites it:
     * PocketBase validates the submitted form BEFORE the before-create hook
     * runs, so a `required: true` field the client omits fails validation with a
     * 400 and the hook never executes. `author` is required on the collection,
     * so it has to be in the payload. feed_guard.pb.js still replaces it with
     * the authenticated caller's id, so sending it buys a client nothing — you
     * cannot post as someone else by putting their id here. Same reasoning
     * applies to `user` on interactions and `reporter` on reports.
     *
     * author_name, author_role, school_version and every counter are optional on
     * the collection, so those really are left to the hook.
     */
    ds.createFeedPost = async function ({ title = '', body = '', files = [] } = {}) {
        const user = this.getCurrentUser();
        if (!user) throw new Error('You need to be signed in to post.');

        const cleanTitle = String(title).trim();
        const cleanBody = String(body).trim();
        const images = Array.isArray(files) ? files : [];

        if (!cleanTitle) throw new Error('Give your post a title.');
        if (cleanTitle.length > MAX_TITLE) throw new Error('Titles are limited to ' + MAX_TITLE + ' characters.');
        if (cleanBody.length > MAX_BODY) throw new Error('Posts are limited to ' + MAX_BODY + ' characters.');
        if (!cleanBody && !images.length) throw new Error('Add something to your post — text or an image.');
        if (images.length > MAX_IMAGES) throw new Error('You can attach at most ' + MAX_IMAGES + ' images.');

        const school = this.getSchoolContext();
        const form = new FormData();
        form.append('title', cleanTitle);
        form.append('body', cleanBody);
        // Required on the collection — see the note above. Overwritten by the hook.
        form.append('author', ownerId(user) || '');
        form.append('client_id', school.clientId || '');
        images.forEach((file) => form.append('images', file));

        const created = await this.pb.collection(POSTS).create(form);
        return ds._mapFeedPost(created);
    };

    ds.createFeedComment = async function (postId, body) {
        const user = this.getCurrentUser();
        if (!user) throw new Error('You need to be signed in to comment.');
        if (!postId) throw new Error('Post id is required.');
        const cleanBody = String(body || '').trim();
        if (!cleanBody) throw new Error('Your comment is empty.');
        if (cleanBody.length > MAX_BODY) throw new Error('Comments are limited to ' + MAX_BODY + ' characters.');

        const school = this.getSchoolContext();
        const created = await this.pb.collection(POSTS).create({
            body: cleanBody,
            reply_to: postId,
            author: ownerId(user),   // required field; hook overwrites it
            client_id: school.clientId || ''
        });
        return ds._mapFeedPost(created);
    };

    /**
     * Repost, or undo one. A repost is a post row with repost_of set — that is
     * what makes it appear in the timeline. The unique index on (author,
     * repost_of) means a second one cannot be created, so undo is a delete of
     * the row we already know about.
     */
    ds.toggleFeedRepost = async function (postId, existingRepostRowId = '') {
        const user = this.getCurrentUser();
        if (!user) throw new Error('You need to be signed in to repost.');
        if (!postId) throw new Error('Post id is required.');

        if (existingRepostRowId) {
            await this.pb.collection(POSTS).delete(existingRepostRowId);
            return { reposted: false, rowId: '' };
        }

        const school = this.getSchoolContext();
        const created = await this.pb.collection(POSTS).create({
            repost_of: postId,
            author: ownerId(user),   // required field; hook overwrites it
            client_id: school.clientId || ''
        });
        return { reposted: true, rowId: created.id };
    };

    /**
     * Like/unlike or save/unsave. Toggling is create-or-delete; there is no
     * update path, and the unique index makes a duplicate impossible.
     */
    ds.toggleFeedInteraction = async function (postId, type, existingRowId = '') {
        const user = this.getCurrentUser();
        if (!user) throw new Error('You need to be signed in to react.');
        if (!postId) throw new Error('Post id is required.');
        if (type !== 'like' && type !== 'save') throw new Error('Unknown reaction.');

        if (existingRowId) {
            await this.pb.collection(INTERACTIONS).delete(existingRowId);
            return { active: false, rowId: '' };
        }

        const school = this.getSchoolContext();
        const created = await this.pb.collection(INTERACTIONS).create({
            post: postId,
            type,
            user: ownerId(user),   // required field; hook overwrites it
            client_id: school.clientId || ''
        });
        return { active: true, rowId: created.id };
    };

    ds.deleteFeedPost = async function (postId) {
        if (!postId) throw new Error('Post id is required.');
        // Cascade takes replies, reposts and interactions with it.
        await this.pb.collection(POSTS).delete(postId);
        return true;
    };

    /**
     * Pin / unpin. Admin-only, and the only field an update may carry —
     * feed_guard.pb.js restores everything else, counters included.
     */
    ds.setFeedPostPinned = async function (postId, pinned) {
        if (!postId) throw new Error('Post id is required.');
        const updated = await this.pb.collection(POSTS).update(postId, { pinned: !!pinned });
        return ds._mapFeedPost(updated);
    };

    // ================================================================
    // Moderation
    // ================================================================

    ds.reportFeedPost = async function (postId, { reason = 'other', note = '' } = {}) {
        const user = this.getCurrentUser();
        if (!user) throw new Error('You need to be signed in to report a post.');
        if (!postId) throw new Error('Post id is required.');
        if (!ds.FEED_REPORT_REASONS[reason]) throw new Error('Choose a reason.');

        const school = this.getSchoolContext();
        try {
            await this.pb.collection(REPORTS).create({
                post: postId,
                reporter: ownerId(user),   // required field; hook overwrites it
                reason,
                note: String(note || '').trim().slice(0, 500),
                status: 'open',
                client_id: school.clientId || ''
            });
            return true;
        } catch (error) {
            // The unique (post, reporter) index means a second report from the
            // same person is a duplicate, not a failure worth alarming them over.
            const message = String(error?.message || '').toLowerCase();
            if (message.includes('unique') || error?.status === 400) {
                return true;
            }
            throw error;
        }
    };

    /**
     * The admin report queue, with the reported post expanded so the queue can
     * show what was actually said without a second fetch per row.
     */
    ds.getFeedReports = async function ({ status = 'open' } = {}) {
        const school = this.getSchoolContext();
        const clauses = [];
        const params = {};

        if (status) {
            clauses.push('status = {:st}');
            params.st = status;
        }
        if (school.schoolVersion) {
            clauses.push('school_version = {:sv}');
            params.sv = school.schoolVersion;
        }

        try {
            const records = await this.pb.collection(REPORTS).getFullList({
                filter: clauses.length ? this.pb.filter(clauses.join(' && '), params) : '',
                sort: '-created',
                expand: 'post'
            });
            return records.map((record) => ({
                id: record.id,
                postId: record.post || '',
                post: record.expand?.post ? ds._mapFeedPost(record.expand.post) : null,
                reporterName: record.reporter_name || 'Someone',
                reason: record.reason || 'other',
                reasonLabel: ds.FEED_REPORT_REASONS[record.reason] || 'Something else',
                note: record.note || '',
                status: record.status || 'open',
                createdAt: record.created
            }));
        } catch (error) {
            if (isNotFound(error)) return [];
            console.error('[Feed] getFeedReports error:', error);
            throw error;
        }
    };

    ds.resolveFeedReport = async function (reportId, status) {
        if (!reportId) throw new Error('Report id is required.');
        if (!['open', 'actioned', 'dismissed'].includes(status)) throw new Error('Unknown status.');
        await this.pb.collection(REPORTS).update(reportId, { status });
        return true;
    };

    ds.getOpenFeedReportCount = async function () {
        const school = this.getSchoolContext();
        const clauses = ['status = "open"'];
        const params = {};
        if (school.schoolVersion) {
            clauses.push('school_version = {:sv}');
            params.sv = school.schoolVersion;
        }
        try {
            const result = await this.pb.collection(REPORTS).getList(1, 1, {
                filter: this.pb.filter(clauses.join(' && '), params)
            });
            return result.totalItems;
        } catch (error) {
            return 0;
        }
    };

})(window.dataService);
