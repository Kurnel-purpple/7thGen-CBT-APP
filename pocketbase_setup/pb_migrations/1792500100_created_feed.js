/// <reference path="../pb_data/types.d.ts" />

/**
 * The school feed — feed_posts, feed_interactions, feed_reports.
 *
 * An X/Twitter-shaped timeline: a post carries a title and body, and each post
 * can be liked, reposted, commented on and saved, each with a visible count.
 *
 * MODELLING NOTES — why three mechanisms rather than one interactions table
 *
 *   COMMENT  = a feed_posts row with `reply_to` set. This is how X works, and it
 *              means a comment is itself likeable, reportable and deletable with
 *              exactly the same code as a post. The cost is that every timeline
 *              query must say `reply_to = ""`, or the feed fills with replies.
 *
 *   REPOST   = a feed_posts row with `repost_of` set and no body of its own. It
 *              has to be a row because a repost APPEARS in the timeline; an
 *              interaction row would not. A partial unique index on
 *              (author, repost_of) is what stops the same person reposting twice.
 *
 *   LIKE/SAVE = a feed_interactions row. These do not appear in anyone's
 *              timeline, so they stay cheap rows. One table for both, keyed
 *              unique on (post, user, type), which makes toggling a delete and
 *              makes double-liking impossible at the database level.
 *
 * COUNTS ARE DENORMALISED onto the post and maintained by pb_hooks/feed_guard.pb.js.
 * The alternative — counting interactions per post at render time — is a query per
 * post per counter, which is the same N+1 fan-out that had to be collapsed out of
 * 1.9.8 after it slowed the whole app down. No client can write these fields: the
 * post updateRule admits only admins, and the hook freezes the counters even for them.
 *
 * NO REALTIME SUBSCRIPTION. A feed is the most tempting thing in this app to wire
 * to PocketBase realtime, and SSE-subscription accumulation on a 1GB Fly node is
 * precisely what caused both the bandwidth incident and the v1.9.7 slowdown. The
 * client polls on focus and on pull-to-refresh instead.
 *
 * WHO MAY POST is a per-school setting, not a hardcode: app_settings key
 * "feed_settings", value { whoCanPost: "staff" | "everyone", whoCanComment: ... }.
 * It defaults to staff-only, because an unmoderated student-writable feed in a
 * school is a bullying and exam-leak surface and that should be a decision the
 * school makes deliberately rather than a default they discover. The hook enforces
 * it server-side — the composer being hidden in the UI is not enforcement.
 *
 * IMAGES: max 2 per post, as real `file` uploads (not base64 in a text column,
 * which is what every other image in this app still does and what made the
 * bandwidth bill). Unprotected, unlike fee receipts — feed images are visible to
 * the whole school by definition, and leaving them unprotected keeps them
 * cacheable and avoids a file-token round trip per timeline render.
 */

const SUPER = '@request.auth.role = "super_admin"';
const SAME_SCHOOL = 'school_version = @request.auth.school_version';
const ADMIN_HERE = '(@request.auth.role = "admin" && ' + SAME_SCHOOL + ')';

migrate((db) => {
    const dao = new Dao(db);

    // ----------------------------------------------------------------
    // 1. feed_posts — posts, comments (reply_to) and reposts (repost_of)
    // ----------------------------------------------------------------
    const posts = new Collection({
        "id": "feedposts000001",
        "created": "2026-09-20 00:00:00.000Z",
        "updated": "2026-09-20 00:00:00.000Z",
        "name": "feed_posts",
        "type": "base",
        "system": false,
        "schema": [
            {
                // Optional at the schema level because comments and reposts have
                // no title; required for top-level posts by the hook.
                "system": false,
                "id": "fpo_title00",
                "name": "title",
                "type": "text",
                "required": false,
                "presentable": false,
                "unique": false,
                "options": { "min": null, "max": 120, "pattern": "" }
            },
            {
                // 1000 characters. X is 280 free / 25k paid, LinkedIn 3000,
                // Threads 500 — with a separate title field, 1000 is the right
                // size for a school announcement. Enforced here AND in the
                // composer's live counter.
                "system": false,
                "id": "fpo_body000",
                "name": "body",
                "type": "text",
                "required": false,
                "presentable": false,
                "unique": false,
                "options": { "min": null, "max": 1000, "pattern": "" }
            },
            {
                "system": false,
                "id": "fpo_author0",
                "name": "author",
                "type": "relation",
                "required": true,
                "presentable": false,
                "unique": false,
                "options": {
                    "collectionId": "_pb_users_auth_",
                    "cascadeDelete": false,
                    "minSelect": null,
                    "maxSelect": 1,
                    "displayFields": null
                }
            },
            {
                // Denormalised so a timeline renders without expanding the author
                // relation on every row.
                "system": false,
                "id": "fpo_auth_nm",
                "name": "author_name",
                "type": "text",
                "required": false,
                "presentable": false,
                "unique": false,
                "options": { "min": null, "max": 120, "pattern": "" }
            },
            {
                // Drives the "Teacher" / "Admin" badge next to the name.
                "system": false,
                "id": "fpo_auth_rl",
                "name": "author_role",
                "type": "text",
                "required": false,
                "presentable": false,
                "unique": false,
                "options": { "min": null, "max": null, "pattern": "" }
            },
            {
                // MAX 2 IMAGES PER POST.
                "system": false,
                "id": "fpo_images0",
                "name": "images",
                "type": "file",
                "required": false,
                "presentable": false,
                "unique": false,
                "options": {
                    "mimeTypes": ["image/jpeg", "image/png", "image/webp"],
                    "thumbs": ["600x0", "200x200"],
                    "maxSelect": 2,
                    "maxSize": 5242880,
                    "protected": false
                }
            },
            // reply_to and repost_of are SELF-relations and are added in a
            // second pass below — see the note after this saveCollection.
            {
                "system": false,
                "id": "fpo_likes00",
                "name": "like_count",
                "type": "number",
                "required": false,
                "presentable": false,
                "unique": false,
                "options": { "min": 0, "max": null, "noDecimal": true }
            },
            {
                "system": false,
                "id": "fpo_reposts",
                "name": "repost_count",
                "type": "number",
                "required": false,
                "presentable": false,
                "unique": false,
                "options": { "min": 0, "max": null, "noDecimal": true }
            },
            {
                "system": false,
                "id": "fpo_comment",
                "name": "comment_count",
                "type": "number",
                "required": false,
                "presentable": false,
                "unique": false,
                "options": { "min": 0, "max": null, "noDecimal": true }
            },
            {
                "system": false,
                "id": "fpo_saves00",
                "name": "save_count",
                "type": "number",
                "required": false,
                "presentable": false,
                "unique": false,
                "options": { "min": 0, "max": null, "noDecimal": true }
            },
            {
                // Admin-only: keeps an announcement at the top of the timeline.
                "system": false,
                "id": "fpo_pinned0",
                "name": "pinned",
                "type": "bool",
                "required": false,
                "presentable": false,
                "unique": false,
                "options": {}
            },
            {
                "system": false,
                "id": "fpo_schver0",
                "name": "school_version",
                "type": "text",
                "required": false,
                "presentable": false,
                "unique": false,
                "options": { "min": null, "max": null, "pattern": "" }
            },
            {
                "system": false,
                "id": "fpo_clntid0",
                "name": "client_id",
                "type": "text",
                "required": false,
                "presentable": false,
                "unique": false,
                "options": { "min": null, "max": null, "pattern": "" }
            }
        ],
        // Only the indexes that do NOT touch reply_to / repost_of can be
        // declared here — those columns do not exist until the second pass.
        "indexes": [
            "CREATE INDEX `idx_feed_posts_author` ON `feed_posts` (`author`)"
        ],
        // Everyone in the school reads the school's feed. Nobody reads another
        // school's.
        "listRule": '@request.auth.id != "" && (' + SUPER + ' || ' + SAME_SCHOOL + ')',
        "viewRule": '@request.auth.id != "" && (' + SUPER + ' || ' + SAME_SCHOOL + ')',
        // Posting RIGHTS (staff-only vs everyone) are enforced by the hook from
        // the school's own app_settings, not here — a rule cannot read a setting.
        "createRule": '@request.auth.id != ""',
        // Deliberately narrow: nobody edits a post. Admins may PATCH only to pin
        // (the hook freezes every other field, counters included), so there is no
        // path by which a like count can be written from the API.
        "updateRule": SUPER + ' || ' + ADMIN_HERE,
        // Your own post, or an admin moderating their school.
        "deleteRule": SUPER + ' || ' + ADMIN_HERE + ' || (author = @request.auth.id && ' + SAME_SCHOOL + ')',
        "options": {}
    });
    dao.saveCollection(posts);

    // ----------------------------------------------------------------
    // 1b. The two SELF-relations, added in a second pass.
    //
    // A relation field is validated against a collection that already exists.
    // feed_posts points at ITSELF for reply_to (comments) and repost_of
    // (reposts), and at the moment of the create above it is not yet in the
    // database for the validator to find. So the collection is saved first and
    // the self-relations are attached to the saved copy here. The three indexes
    // that reference those columns follow for the same reason - SQLite cannot
    // index a column that does not exist yet.
    // ----------------------------------------------------------------
    const savedPosts = dao.findCollectionByNameOrId("feedposts000001");

    savedPosts.schema.addField(new SchemaField({
        // Set => this row is a comment on that post.
        "system": false,
        "id": "fpo_replyto",
        "name": "reply_to",
        "type": "relation",
        "required": false,
        "presentable": false,
        "unique": false,
        "options": {
            "collectionId": "feedposts000001",
            "cascadeDelete": true,
            "minSelect": null,
            "maxSelect": 1,
            "displayFields": null
        }
    }));

    savedPosts.schema.addField(new SchemaField({
        // Set => this row is a repost of that post.
        "system": false,
        "id": "fpo_repostf",
        "name": "repost_of",
        "type": "relation",
        "required": false,
        "presentable": false,
        "unique": false,
        "options": {
            "collectionId": "feedposts000001",
            "cascadeDelete": true,
            "minSelect": null,
            "maxSelect": 1,
            "displayFields": null
        }
    }));

    savedPosts.indexes = [
        "CREATE INDEX `idx_feed_posts_author` ON `feed_posts` (`author`)",
        "CREATE INDEX `idx_feed_posts_timeline` ON `feed_posts` (`school_version`, `reply_to`, `created`)",
        "CREATE INDEX `idx_feed_posts_replies` ON `feed_posts` (`reply_to`)",
        // Partial unique index: one repost of a given post per author. The WHERE
        // clause is what keeps ordinary posts (blank repost_of) from colliding
        // with each other - and if an unset relation stores as NULL rather than
        // '', SQLite treats NULLs as distinct in a unique index, so this is
        // correct under either representation.
        "CREATE UNIQUE INDEX `idx_feed_posts_repost_once` ON `feed_posts` (`author`, `repost_of`) WHERE `repost_of` != ''"
    ];

    dao.saveCollection(savedPosts);

    // ----------------------------------------------------------------
    // 2. feed_interactions — likes and saves
    // ----------------------------------------------------------------
    const interactions = new Collection({
        "id": "feedinteract001",
        "created": "2026-09-20 00:00:00.000Z",
        "updated": "2026-09-20 00:00:00.000Z",
        "name": "feed_interactions",
        "type": "base",
        "system": false,
        "schema": [
            {
                "system": false,
                "id": "fin_post000",
                "name": "post",
                "type": "relation",
                "required": true,
                "presentable": false,
                "unique": false,
                "options": {
                    "collectionId": "feedposts000001",
                    // Deleting a post takes its likes and saves with it.
                    "cascadeDelete": true,
                    "minSelect": null,
                    "maxSelect": 1,
                    "displayFields": null
                }
            },
            {
                "system": false,
                "id": "fin_user000",
                "name": "user",
                "type": "relation",
                "required": true,
                "presentable": false,
                "unique": false,
                "options": {
                    "collectionId": "_pb_users_auth_",
                    "cascadeDelete": true,
                    "minSelect": null,
                    "maxSelect": 1,
                    "displayFields": null
                }
            },
            {
                "system": false,
                "id": "fin_type000",
                "name": "type",
                "type": "select",
                "required": true,
                "presentable": false,
                "unique": false,
                "options": { "maxSelect": 1, "values": ["like", "save"] }
            },
            {
                "system": false,
                "id": "fin_schver0",
                "name": "school_version",
                "type": "text",
                "required": false,
                "presentable": false,
                "unique": false,
                "options": { "min": null, "max": null, "pattern": "" }
            },
            {
                "system": false,
                "id": "fin_clntid0",
                "name": "client_id",
                "type": "text",
                "required": false,
                "presentable": false,
                "unique": false,
                "options": { "min": null, "max": null, "pattern": "" }
            }
        ],
        "indexes": [
            // The database, not the client, is what makes double-liking impossible.
            "CREATE UNIQUE INDEX `idx_feed_interactions_once` ON `feed_interactions` (`post`, `user`, `type`)",
            "CREATE INDEX `idx_feed_interactions_user` ON `feed_interactions` (`user`, `type`)"
        ],
        // A user only ever reads their OWN interaction rows. That is all the
        // client needs ("have I liked this?", "what have I saved?"), it keeps
        // saves private, and it means nobody can enumerate who liked what.
        "listRule": '@request.auth.id != "" && user = @request.auth.id',
        "viewRule": '@request.auth.id != "" && user = @request.auth.id',
        "createRule": '@request.auth.id != ""',
        // No updates at all — toggling a like is a create or a delete.
        "updateRule": null,
        "deleteRule": '@request.auth.id != "" && user = @request.auth.id',
        "options": {}
    });
    dao.saveCollection(interactions);

    // ----------------------------------------------------------------
    // 3. feed_reports — the moderation path
    // ----------------------------------------------------------------
    const reports = new Collection({
        "id": "feedreports0001",
        "created": "2026-09-20 00:00:00.000Z",
        "updated": "2026-09-20 00:00:00.000Z",
        "name": "feed_reports",
        "type": "base",
        "system": false,
        "schema": [
            {
                "system": false,
                "id": "frp_post000",
                "name": "post",
                "type": "relation",
                "required": true,
                "presentable": false,
                "unique": false,
                "options": {
                    "collectionId": "feedposts000001",
                    "cascadeDelete": true,
                    "minSelect": null,
                    "maxSelect": 1,
                    "displayFields": null
                }
            },
            {
                "system": false,
                "id": "frp_repbyid",
                "name": "reporter",
                "type": "relation",
                "required": true,
                "presentable": false,
                "unique": false,
                "options": {
                    "collectionId": "_pb_users_auth_",
                    "cascadeDelete": false,
                    "minSelect": null,
                    "maxSelect": 1,
                    "displayFields": null
                }
            },
            {
                "system": false,
                "id": "frp_repbynm",
                "name": "reporter_name",
                "type": "text",
                "required": false,
                "presentable": false,
                "unique": false,
                "options": { "min": null, "max": 120, "pattern": "" }
            },
            {
                "system": false,
                "id": "frp_reason0",
                "name": "reason",
                "type": "select",
                "required": true,
                "presentable": false,
                "unique": false,
                "options": {
                    "maxSelect": 1,
                    // exam_leak is here because this is a school app running a CBT
                    // module — a post containing exam content is a category of its
                    // own and an admin needs to spot it at a glance.
                    "values": ["bullying", "inappropriate", "spam", "exam_leak", "false_info", "other"]
                }
            },
            {
                "system": false,
                "id": "frp_note000",
                "name": "note",
                "type": "text",
                "required": false,
                "presentable": false,
                "unique": false,
                "options": { "min": null, "max": 500, "pattern": "" }
            },
            {
                "system": false,
                "id": "frp_status0",
                "name": "status",
                "type": "select",
                "required": true,
                "presentable": false,
                "unique": false,
                "options": { "maxSelect": 1, "values": ["open", "actioned", "dismissed"] }
            },
            {
                "system": false,
                "id": "frp_schver0",
                "name": "school_version",
                "type": "text",
                "required": false,
                "presentable": false,
                "unique": false,
                "options": { "min": null, "max": null, "pattern": "" }
            },
            {
                "system": false,
                "id": "frp_clntid0",
                "name": "client_id",
                "type": "text",
                "required": false,
                "presentable": false,
                "unique": false,
                "options": { "min": null, "max": null, "pattern": "" }
            }
        ],
        "indexes": [
            "CREATE INDEX `idx_feed_reports_queue` ON `feed_reports` (`school_version`, `status`)",
            // One report per person per post — a pile-on should not look like
            // fifty separate problems in the admin's queue.
            "CREATE UNIQUE INDEX `idx_feed_reports_once` ON `feed_reports` (`post`, `reporter`)"
        ],
        // Only admins read the report queue. A reporter does not get to see
        // who else reported, and does not need to read their own row back.
        "listRule": SUPER + ' || ' + ADMIN_HERE,
        "viewRule": SUPER + ' || ' + ADMIN_HERE,
        "createRule": '@request.auth.id != ""',
        "updateRule": SUPER + ' || ' + ADMIN_HERE,
        "deleteRule": SUPER + ' || ' + ADMIN_HERE,
        "options": {}
    });
    dao.saveCollection(reports);

    return null;
}, (db) => {
    const dao = new Dao(db);
    // Reverse order: the two child collections hold relations into feed_posts.
    dao.deleteCollection(dao.findCollectionByNameOrId("feedreports0001"));
    dao.deleteCollection(dao.findCollectionByNameOrId("feedinteract001"));
    dao.deleteCollection(dao.findCollectionByNameOrId("feedposts000001"));
    return null;
})
