const feedService = {
    moduleId: 'feed',
    getStatus() {
        return {
            moduleId: 'feed',
            ready: true,
            phase: 'live',
            note: 'Feed runs on PocketBase (feed_posts, feed_interactions, feed_reports). X-style timeline: title + body posts with up to 2 images, and like / repost / comment / save with counts. Who may post is a per-school setting (app_settings "feed_settings"), staff-only by default, enforced server-side. No realtime subscription by design — the client polls on focus.'
        };
    }
};

export default feedService;
