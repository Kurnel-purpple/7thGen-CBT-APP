const feesPermissions = [
    'fees.submit',       // upload a receipt for yourself
    'fees.view_own',     // see your own submissions and their status
    'fees.review',       // open the admin queue
    'fees.confirm',      // mark a submission confirmed
    'fees.reject',       // mark a submission rejected, with a reason
    'fees.delete'        // remove a submission
];

export default feesPermissions;
