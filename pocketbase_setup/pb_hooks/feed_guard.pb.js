/// <reference path="../pb_data/types.d.ts" />

/**
 * Server-side guard and counter maintenance for the school feed.
 *
 * Responsibilities:
 *
 *   POSTING RIGHTS. Who may post is a per-school setting (app_settings key
 *   "feed_settings"), defaulting to staff-only. It is enforced HERE, because
 *   hiding the composer in the UI is not enforcement — a student with the
 *   network tab open can POST to the collection directly. A collection rule
 *   cannot express it, since rules cannot read another collection's row.
 *
 *   IDENTITY. author / author_name / author_role are taken from the caller, never
 *   from the request body, so nobody posts as the principal.
 *
 *   COUNTERS. like_count, repost_count, comment_count and save_count are
 *   maintained here on create and delete of the corresponding rows, and frozen on
 *   update. Counting at render time instead would be a query per post per counter
 *   — the N+1 fan-out that had to be collapsed out of 1.9.8.
 *
 *   TENANCY. Every row is stamped with the caller's school, and a post may not
 *   reply to or repost something from another school.
 *
 * DO NOT FACTOR THE LOOKUPS OUT INTO SHARED TOP-LEVEL FUNCTIONS.
 * PocketBase's JSVM serialises each handler and re-evaluates it in an isolated
 * context, so a handler cannot see anything declared in this file's outer scope.
 * An earlier version of result_school_stamp.pb.js called a top-level
 * resolveSchool() and every stamp failed with "ReferenceError: resolveSchool is
 * not defined" — silently. The repetition below is the price of that isolation.
 *
 * KNOWN LIMIT — counter drift. The increments below are read-modify-write, so two
 * simultaneous likes on the same post from different users can both read N and
 * write N+1, losing one. The unique index on (post, user, type) makes the common
 * case (one person double-tapping) impossible, and a vanity counter that is
 * occasionally one low is an acceptable trade against taking a row lock on every
 * like. If it ever matters, recompute from feed_interactions in a nightly job
 * rather than adding contention here.
 */

// ---------------------------------------------------------------------------
// feed_posts — CREATE: identity, tenancy, posting rights, shape
// ---------------------------------------------------------------------------
onRecordBeforeCreateRequest((e) => {
    const info = $apis.requestInfo(e.httpContext);
    const caller = info.authRecord;
    if (!caller) return; // unauthenticated creates are rejected by the collection rule

    // Resolve the caller's school and display name. school_version is
    // authoritative on profiles and may be blank on the users auth record
    // (see admin_user_password.pb.js), so prefer profiles and fall back.
    let sv = "";
    let fullName = "";
    try {
        const rows = $app.dao().findRecordsByFilter(
            "profiles", "user = {:uid}", "", 1, 0, { uid: caller.getId() }
        );
        if (rows.length > 0) {
            sv = (rows[0].getString("school_version") || "").trim();
            fullName = (rows[0].getString("full_name") || "").trim();
        }
    } catch (err) { /* no profile row */ }
    if (!sv) sv = (caller.getString("school_version") || "").trim();
    if (!fullName) fullName = (caller.getString("full_name") || caller.getString("name") || "").trim();
    if (!fullName) fullName = caller.getString("username") || "Someone";

    if (!sv) {
        throw new BadRequestError("Your account has no school assigned, so it cannot post to the school feed.");
    }

    const role = (caller.getString("role") || "").trim();
    const isStaff = (role === "teacher" || role === "admin" || role === "super_admin");

    const replyTo = (e.record.getString("reply_to") || "").trim();
    let repostOf = (e.record.getString("repost_of") || "").trim();

    if (replyTo && repostOf) {
        throw new BadRequestError("A post cannot be both a comment and a repost.");
    }

    // --- Posting rights, from this school's own settings -------------------
    // Defaults: staff may post; anyone may comment. A school that wants an open
    // feed sets whoCanPost to "everyone" from the feed page.
    let whoCanPost = "staff";
    let whoCanComment = "everyone";
    try {
        const rows = $app.dao().findRecordsByFilter(
            "app_settings", "key = 'feed_settings' && school_version = {:sv}", "", 1, 0, { sv: sv }
        );
        if (rows.length > 0) {
            const raw = rows[0].get("value");
            let parsed = null;
            if (raw) {
                if (typeof raw === "string") {
                    parsed = JSON.parse(raw);
                } else {
                    try { parsed = JSON.parse(String(raw)); } catch (inner) { parsed = raw; }
                }
            }
            if (parsed) {
                if (parsed.whoCanPost) whoCanPost = String(parsed.whoCanPost);
                if (parsed.whoCanComment) whoCanComment = String(parsed.whoCanComment);
            }
        }
    } catch (err) { /* no setting row, or app_settings absent — defaults apply */ }

    if (replyTo) {
        if (whoCanComment === "staff" && !isStaff) {
            throw new ForbiddenError("Only staff can comment on the school feed.");
        }
    } else {
        // Covers both new posts and reposts — a repost is a broadcast, so it
        // follows the posting right rather than the commenting right.
        if (whoCanPost === "staff" && !isStaff) {
            throw new ForbiddenError("Only staff can post to the school feed.");
        }
    }

    // --- Relation targets must exist and belong to the same school ---------
    if (replyTo) {
        let parent = null;
        try {
            parent = $app.dao().findRecordById("feed_posts", replyTo);
        } catch (err) {
            throw new BadRequestError("The post you are replying to no longer exists.");
        }
        if ((parent.getString("school_version") || "").trim() !== sv) {
            throw new ForbiddenError("You cannot comment on another school's post.");
        }
        if ((parent.getString("reply_to") || "").trim()) {
            throw new BadRequestError("Replies to replies are not supported.");
        }
    }

    if (repostOf) {
        let target = null;
        try {
            target = $app.dao().findRecordById("feed_posts", repostOf);
        } catch (err) {
            throw new BadRequestError("The post you are reposting no longer exists.");
        }
        if ((target.getString("school_version") || "").trim() !== sv) {
            throw new ForbiddenError("You cannot repost another school's post.");
        }
        // Reposting a repost points at the original instead, so chains cannot
        // form. Every platform behaves this way and users expect it.
        const inner = (target.getString("repost_of") || "").trim();
        if (inner) {
            repostOf = inner;
            e.record.set("repost_of", inner);
        }
    }

    // --- Shape -------------------------------------------------------------
    // Deliberately does NOT inspect the `images` field. At before-create the
    // uploaded files may not be attached to the record yet, so a count read here
    // can be 0 for a post that does carry images — and rejecting on that would
    // refuse legitimate image-only posts. The title requirement below is enough
    // to guarantee a post is not empty; "text or an image" is checked in the
    // composer, where the files are unambiguously in hand.
    const title = (e.record.getString("title") || "").trim();
    const body = (e.record.getString("body") || "").trim();

    if (repostOf) {
        // A plain repost carries none of its own content.
        e.record.set("title", "");
        e.record.set("body", "");
    } else if (replyTo) {
        if (!body) throw new BadRequestError("A comment cannot be empty.");
        e.record.set("title", "");
    } else {
        if (!title) throw new BadRequestError("Give your post a title.");
    }

    // --- Identity and counters --------------------------------------------
    e.record.set("school_version", sv);
    e.record.set("author", caller.getId());
    e.record.set("author_name", fullName);
    e.record.set("author_role", role);

    // Whatever the client sent for these is discarded. They are only ever
    // written by the counter handlers below.
    e.record.set("like_count", 0);
    e.record.set("repost_count", 0);
    e.record.set("comment_count", 0);
    e.record.set("save_count", 0);

    // Only an admin can pin, and never at creation time.
    e.record.set("pinned", false);
}, "feed_posts");

// ---------------------------------------------------------------------------
// feed_posts — UPDATE: an admin may pin. Nothing else is writable, by anyone.
// ---------------------------------------------------------------------------
onRecordBeforeUpdateRequest((e) => {
    const info = $apis.requestInfo(e.httpContext);
    const caller = info.authRecord;
    if (!caller) return;

    const role = (caller.getString("role") || "").trim();
    if (role !== "admin" && role !== "super_admin") {
        throw new ForbiddenError("Posts cannot be edited.");
    }

    const original = e.record.originalCopy();

    // `pinned` is the only field an update may carry. Freezing the counters here
    // is what makes them trustworthy: there is no API path that writes them.
    const frozen = [
        "title", "body", "author", "author_name", "author_role", "images",
        "reply_to", "repost_of",
        "like_count", "repost_count", "comment_count", "save_count",
        "school_version", "client_id"
    ];
    for (let i = 0; i < frozen.length; i++) {
        e.record.set(frozen[i], original.get(frozen[i]));
    }
}, "feed_posts");

// ---------------------------------------------------------------------------
// feed_posts — AFTER CREATE: bump the parent's comment or repost count
// ---------------------------------------------------------------------------
onRecordAfterCreateRequest((e) => {
    const replyTo = (e.record.getString("reply_to") || "").trim();
    const repostOf = (e.record.getString("repost_of") || "").trim();
    if (!replyTo && !repostOf) return;

    const targetId = replyTo || repostOf;
    const field = replyTo ? "comment_count" : "repost_count";

    try {
        const target = $app.dao().findRecordById("feed_posts", targetId);
        target.set(field, (target.getInt(field) || 0) + 1);
        $app.dao().saveRecord(target);
    } catch (err) {
        // A missing target is not worth failing the request the user already
        // completed — the reply exists, the count is cosmetic.
        console.log("[feed_guard] could not bump " + field + " on " + targetId + ": " + err);
    }
}, "feed_posts");

// ---------------------------------------------------------------------------
// feed_posts — AFTER DELETE: give the count back
// ---------------------------------------------------------------------------
onRecordAfterDeleteRequest((e) => {
    const replyTo = (e.record.getString("reply_to") || "").trim();
    const repostOf = (e.record.getString("repost_of") || "").trim();
    if (!replyTo && !repostOf) return;

    const targetId = replyTo || repostOf;
    const field = replyTo ? "comment_count" : "repost_count";

    try {
        const target = $app.dao().findRecordById("feed_posts", targetId);
        // Clamp: a drifted counter must never render as -1.
        const next = (target.getInt(field) || 0) - 1;
        target.set(field, next < 0 ? 0 : next);
        $app.dao().saveRecord(target);
    } catch (err) {
        // Expected when the parent is what is being deleted — the cascade takes
        // the children with it and there is nothing left to decrement.
        console.log("[feed_guard] could not lower " + field + " on " + targetId + ": " + err);
    }
}, "feed_posts");

// ---------------------------------------------------------------------------
// feed_interactions — CREATE: pin the user, stamp the school
// ---------------------------------------------------------------------------
onRecordBeforeCreateRequest((e) => {
    const info = $apis.requestInfo(e.httpContext);
    const caller = info.authRecord;
    if (!caller) return;

    let sv = "";
    try {
        const rows = $app.dao().findRecordsByFilter(
            "profiles", "user = {:uid}", "", 1, 0, { uid: caller.getId() }
        );
        if (rows.length > 0) sv = (rows[0].getString("school_version") || "").trim();
    } catch (err) { /* no profile row */ }
    if (!sv) sv = (caller.getString("school_version") || "").trim();

    const postId = (e.record.getString("post") || "").trim();
    if (!postId) throw new BadRequestError("Missing post.");

    let post = null;
    try {
        post = $app.dao().findRecordById("feed_posts", postId);
    } catch (err) {
        throw new BadRequestError("That post no longer exists.");
    }
    if (sv && (post.getString("school_version") || "").trim() !== sv) {
        throw new ForbiddenError("You cannot react to another school's post.");
    }

    // The user is the caller, full stop — otherwise anyone could like on
    // someone else's behalf, or inflate a count with fabricated user ids.
    e.record.set("user", caller.getId());
    e.record.set("school_version", sv);
}, "feed_interactions");

// ---------------------------------------------------------------------------
// feed_interactions — AFTER CREATE / AFTER DELETE: the like and save counters
// ---------------------------------------------------------------------------
onRecordAfterCreateRequest((e) => {
    const postId = (e.record.getString("post") || "").trim();
    const type = (e.record.getString("type") || "").trim();
    const field = type === "save" ? "save_count" : "like_count";
    if (!postId) return;

    try {
        const post = $app.dao().findRecordById("feed_posts", postId);
        post.set(field, (post.getInt(field) || 0) + 1);
        $app.dao().saveRecord(post);
    } catch (err) {
        console.log("[feed_guard] could not bump " + field + " on " + postId + ": " + err);
    }
}, "feed_interactions");

onRecordAfterDeleteRequest((e) => {
    const postId = (e.record.getString("post") || "").trim();
    const type = (e.record.getString("type") || "").trim();
    const field = type === "save" ? "save_count" : "like_count";
    if (!postId) return;

    try {
        const post = $app.dao().findRecordById("feed_posts", postId);
        const next = (post.getInt(field) || 0) - 1;
        post.set(field, next < 0 ? 0 : next);
        $app.dao().saveRecord(post);
    } catch (err) {
        // Expected when the post itself is being deleted and the cascade is
        // clearing its interactions.
        console.log("[feed_guard] could not lower " + field + " on " + postId + ": " + err);
    }
}, "feed_interactions");

// ---------------------------------------------------------------------------
// feed_reports — CREATE: pin the reporter, stamp the school, force "open"
// ---------------------------------------------------------------------------
onRecordBeforeCreateRequest((e) => {
    const info = $apis.requestInfo(e.httpContext);
    const caller = info.authRecord;
    if (!caller) return;

    let sv = "";
    let fullName = "";
    try {
        const rows = $app.dao().findRecordsByFilter(
            "profiles", "user = {:uid}", "", 1, 0, { uid: caller.getId() }
        );
        if (rows.length > 0) {
            sv = (rows[0].getString("school_version") || "").trim();
            fullName = (rows[0].getString("full_name") || "").trim();
        }
    } catch (err) { /* no profile row */ }
    if (!sv) sv = (caller.getString("school_version") || "").trim();
    if (!fullName) fullName = (caller.getString("full_name") || caller.getString("name") || "").trim();
    if (!fullName) fullName = caller.getString("username") || "Someone";

    const postId = (e.record.getString("post") || "").trim();
    if (!postId) throw new BadRequestError("Missing post.");

    let post = null;
    try {
        post = $app.dao().findRecordById("feed_posts", postId);
    } catch (err) {
        throw new BadRequestError("That post no longer exists.");
    }
    if (sv && (post.getString("school_version") || "").trim() !== sv) {
        throw new ForbiddenError("You cannot report another school's post.");
    }

    e.record.set("reporter", caller.getId());
    e.record.set("reporter_name", fullName);
    e.record.set("school_version", sv);
    // A reporter does not get to mark their own report actioned.
    e.record.set("status", "open");
}, "feed_reports");
