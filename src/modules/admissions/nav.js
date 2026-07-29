// Plenty of schools never run entrance exams and shouldn't see this at all.
// That is handled by the module system, not here: 'admissions' has to be in the
// school's modules.enabled (or the tenant's modules_enabled) for this nav item
// to render at all.
const admissionsNav = [
    {
        label: 'Admissions',
        path: '/pages/admissions.html',
        roles: ['admin', 'super_admin'],
        permissions: ['admissions.manage_sessions'],
        section: 'Assessment'
    }
];

export default admissionsNav;
