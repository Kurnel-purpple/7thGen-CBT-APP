// NOTE: /pages/admission.html (the candidate entry page) is deliberately absent.
// It is the one surface in the app served to someone who is not authenticated —
// a prospective student holding a printed access slip — so it must not be
// subject to the role guard that protects every route listed here.
const admissionsRoutes = [
    {
        path: '/pages/admissions.html',
        roles: ['admin', 'super_admin'],
        permissions: ['admissions.manage_sessions']
    }
];

export default admissionsRoutes;
