/**
 * Tenant Service
 * Extends window.dataService with tenant-management methods used by the
 * master-admin page (and read-only by pageBootstrap to gate modules).
 *
 * Must be loaded AFTER dataService.js
 */

(function (ds) {
    if (!ds) {
        console.error('[tenantService] window.dataService not found — load dataService.js first');
        return;
    }

    const COLLECTION = 'tenants';

    function isNotFound(error) {
        const status = error?.status ?? error?.statusCode;
        const message = String(error?.message || '').toLowerCase();
        return status === 404 || message.includes('404') || message.includes('not found');
    }

    function normaliseModulesArray(value) {
        if (Array.isArray(value)) return value.filter(Boolean).map(String);
        if (typeof value === 'string') {
            try {
                const parsed = JSON.parse(value);
                return Array.isArray(parsed) ? parsed.filter(Boolean).map(String) : [];
            } catch (_) { return []; }
        }
        return [];
    }

    ds._mapTenant = function (record) {
        if (!record) return null;
        return {
            id: record.id,
            schoolVersion: record.school_version || '',
            name: record.name || '',
            clientId: record.client_id || '',
            plan: record.plan || 'trial',
            status: record.status || 'trial',
            modulesEnabled: normaliseModulesArray(record.modules_enabled),
            planExpiresAt: record.plan_expires_at || null,
            contactEmail: record.contact_email || '',
            notes: record.notes || '',
            createdAt: record.created,
            updatedAt: record.updated
        };
    };

    /**
     * Fetch the current user's tenant record (if any).
     * Returns null when the user isn't signed in or has no tenant.
     */
    ds.getOwnTenant = async function () {
        const user = this.getCurrentUser();
        const schoolVersion = user?.schoolVersion;
        if (!user || !schoolVersion) return null;
        try {
            const filter = this.pb.filter('school_version = {:sv}', { sv: schoolVersion });
            const record = await this.pb.collection(COLLECTION).getFirstListItem(filter);
            return ds._mapTenant(record);
        } catch (error) {
            if (isNotFound(error)) return null;
            throw error;
        }
    };

    /**
     * List every tenant. Super-admin only at the API level.
     */
    ds.listTenants = async function () {
        try {
            const records = await this.pb.collection(COLLECTION).getFullList({
                sort: 'name'
            });
            return records.map(ds._mapTenant);
        } catch (error) {
            console.error('[Tenant] listTenants error:', error);
            throw error;
        }
    };

    ds.createTenant = async function (payload = {}) {
        const data = {
            school_version: String(payload.schoolVersion || '').trim(),
            name: String(payload.name || '').trim(),
            client_id: String(payload.clientId || '').trim(),
            plan: payload.plan || 'trial',
            status: payload.status || 'trial',
            modules_enabled: normaliseModulesArray(payload.modulesEnabled),
            plan_expires_at: payload.planExpiresAt ? new Date(payload.planExpiresAt).toISOString() : '',
            contact_email: String(payload.contactEmail || '').trim(),
            notes: String(payload.notes || '').trim()
        };
        if (!data.school_version || !data.name) {
            throw new Error('School version and name are required.');
        }
        const created = await this.pb.collection(COLLECTION).create(data);
        return ds._mapTenant(created);
    };

    ds.updateTenant = async function (id, payload = {}) {
        if (!id) throw new Error('Tenant id is required.');
        const data = {};
        if (payload.schoolVersion !== undefined) data.school_version = String(payload.schoolVersion).trim();
        if (payload.name !== undefined) data.name = String(payload.name).trim();
        if (payload.clientId !== undefined) data.client_id = String(payload.clientId).trim();
        if (payload.plan !== undefined) data.plan = payload.plan;
        if (payload.status !== undefined) data.status = payload.status;
        if (payload.modulesEnabled !== undefined) data.modules_enabled = normaliseModulesArray(payload.modulesEnabled);
        if (payload.planExpiresAt !== undefined) {
            data.plan_expires_at = payload.planExpiresAt ? new Date(payload.planExpiresAt).toISOString() : '';
        }
        if (payload.contactEmail !== undefined) data.contact_email = String(payload.contactEmail).trim();
        if (payload.notes !== undefined) data.notes = String(payload.notes).trim();

        const updated = await this.pb.collection(COLLECTION).update(id, data);
        return ds._mapTenant(updated);
    };

    ds.deleteTenant = async function (id) {
        if (!id) throw new Error('Tenant id is required.');
        await this.pb.collection(COLLECTION).delete(id);
        return true;
    };

})(window.dataService);
