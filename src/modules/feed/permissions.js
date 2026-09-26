const feedPermissions = [
    'feed.view',        // read the school timeline
    'feed.post',        // create a top-level post
    'feed.comment',     // reply to a post
    'feed.react',       // like / repost / save
    'feed.report',      // flag a post for the admin
    'feed.moderate',    // delete anyone's post, pin, work the report queue
    'feed.configure'    // change who may post / comment for this school
];

export default feedPermissions;
