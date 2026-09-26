/// <reference path="../pb_data/types.d.ts" />

/**
 * The school's own web address, so the login and registration screens can be
 * branded before anyone signs in.
 *
 * WHY THIS IS NEEDED
 * A school's name, logo and colours live in app_settings, scoped by
 * school_version — which the client can only read once someone is signed in
 * and a school context exists. That is fine everywhere inside the app, but the
 * login and register screens come BEFORE any of that, so a student arriving at
 * their school's domain saw the generic Gen7 branding and no way to tell they
 * were in the right place.
 *
 * Until now the only fix was a static src/config/clients/<id>.js per school,
 * which is exactly the per-client code change that clients.json and
 * scripts/prepare-client-build.js removed. Storing the domain here instead
 * keeps onboarding to "add the school in the master dashboard" — the operator
 * fills this field in, and pb_hooks/public_brand.pb.js resolves hostname ->
 * branding for logged-out visitors.
 *
 * NOT made unique at the DB level: two rows legitimately share a blank value,
 * and PocketBase unique indexes count blanks as duplicates. public_brand.pb.js
 * matches on the first non-blank hit and ignores the rest.
 *
 * Store the bare hostname, no scheme and no path — "readingrainbow.edu.ng".
 * The lookup strips a leading "www." from both sides before comparing, so one
 * row covers the apex and the www subdomain.
 */

migrate((db) => {
    const dao = new Dao(db);
    const collection = dao.findCollectionByNameOrId("tenants");

    collection.schema.addField(new SchemaField({
        "system": false,
        "id": "tnt_domain0",
        "name": "domain",
        "type": "text",
        "required": false,
        "presentable": false,
        "unique": false,
        "options": { "min": null, "max": 253, "pattern": "" }
    }));

    return dao.saveCollection(collection);
}, (db) => {
    const dao = new Dao(db);
    const collection = dao.findCollectionByNameOrId("tenants");

    collection.schema.removeField("tnt_domain0");

    return dao.saveCollection(collection);
});
