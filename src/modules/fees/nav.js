// Teachers are deliberately absent from both entries: fee receipts carry a
// family's financial position and are the admin's business, not the class
// teacher's. The collection rules enforce the same split server-side.
const feesNav = [
    {
        label: 'Fee Payments',
        path: '/pages/fees.html',
        roles: ['admin'],
        permissions: ['fees.review'],
        section: 'Administration'
    },
    {
        label: 'My Payments',
        path: '/pages/student-fees.html',
        roles: ['student'],
        permissions: ['fees.submit'],
        section: 'Administration'
    }
];

export default feesNav;
