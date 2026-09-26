// One page for everyone — the feed is the whole school's, and what a given role
// may DO on it (post, comment, moderate) is decided by role plus the school's
// own feed_settings, not by routing them somewhere different.
const feedNav = [
    {
        label: 'School Feed',
        path: '/pages/feed.html',
        roles: ['admin', 'teacher', 'student'],
        permissions: ['feed.view'],
        section: 'School Life'
    }
];

export default feedNav;
