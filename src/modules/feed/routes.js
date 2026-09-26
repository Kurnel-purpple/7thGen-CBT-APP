const feedRoutes = [
    {
        path: '/pages/feed.html',
        roles: ['admin', 'teacher', 'student'],
        permissions: ['feed.view']
    }
];

export default feedRoutes;
