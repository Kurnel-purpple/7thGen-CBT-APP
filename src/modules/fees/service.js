const feesService = {
    moduleId: 'fees',
    getStatus() {
        return {
            moduleId: 'fees',
            ready: true,
            phase: 'live',
            note: 'Fees runs on PocketBase (fee_payments). Parents/students upload up to 5 receipt images with a purpose and caption; admins confirm or reject, and the decision shows on the submitter\'s page. Receipts are protected file uploads, not base64. This is a confirmation ledger, not a payment gateway — no card or bank access.'
        };
    }
};

export default feesService;
