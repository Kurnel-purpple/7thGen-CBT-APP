const feesRoutes = [
    {
        path: '/pages/fees.html',
        roles: ['admin'],
        permissions: ['fees.review']
    },
    {
        path: '/pages/student-fees.html',
        roles: ['student'],
        permissions: ['fees.submit']
    }
];

export default feesRoutes;
