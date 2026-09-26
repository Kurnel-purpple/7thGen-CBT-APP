/// <reference path="../pb_data/types.d.ts" />

/**
 * Hostname -> a school's public branding, for logged-out screens.
 *
 * WHY A HOOK AND NOT AN OPEN COLLECTION
 * The obvious shortcut is to make `tenants` publicly readable and query it from
 * the browser. That would also publish plan, status, plan_expires_at,
 * contact_email, modules_enabled and the operator's private notes for every
 * school on the platform, to anyone. This route returns the four fields a login
 * screen actually needs and nothing else, so the rest of the row stays behind
 * the authenticated rules it already has.
 *
 * WHAT IT IS NOT
 * Not an authentication boundary and not a secret. Everything it returns is
 * already visible to anyone who opens the school's website — their name, their
 * logo, their colours. It deliberately does NOT reveal school_version, because
 * that value is the tenancy key used in API rules and join codes; a caller who
 * knew it would learn which string to aim at, even though the rules still stop
 * them using it. The client does not need it to paint a login screen.
 *
 * Unauthenticated on purpose, same as /api/cbt/time: it runs before any session
 * exists.
 *
 * NOTE: v0.21 runs each handler in an isolated goja runtime — nothing from this
 * file's outer scope is visible inside, so everything is declared inline.
 */

routerAdd("GET", "/api/cbt/brand", (c) => {
    // ---- normalise the requested host -------------------------------------
    const raw = String(c.queryParam("host") || "").trim().toLowerCase();
    if (!raw) {
        return c.json(400, { message: "host is required" });
    }

    // Accept a bare hostname only. Strip anything that looks like a scheme,
    // port, path or credentials rather than trying to parse a URL.
    let host = raw
        .replace(/^[a-z]+:\/\//, "")
        .replace(/^[^@]*@/, "")
        .split("/")[0]
        .split(":")[0]
        .replace(/\.$/, "");

    if (!/^[a-z0-9.-]{1,253}$/.test(host)) {
        return c.json(400, { message: "invalid host" });
    }

    const bare = host.replace(/^www\./, "");

    // ---- find the tenant ---------------------------------------------------
    // Matched in JS rather than SQL so the www/apex equivalence is applied to
    // BOTH sides — a row saved as "www.school.edu" still matches "school.edu".
    let tenant = null;
    try {
        const rows = $app.dao().findRecordsByFilter(
            "tenants",
            "domain != '' && status != 'suspended'",
            "-created",
            200,
            0
        );
        for (let i = 0; i < rows.length; i++) {
            const stored = String(rows[i].get("domain") || "")
                .trim()
                .toLowerCase()
                .replace(/^[a-z]+:\/\//, "")
                .split("/")[0]
                .replace(/^www\./, "");
            if (stored && stored === bare) {
                tenant = rows[i];
                break;
            }
        }
    } catch (err) {
        console.log("[brand] tenant lookup failed for " + bare + ": " + err);
    }

    // An unknown host is not an error — it is every visitor on the public site.
    // 200 with found:false keeps that off the client's error path.
    if (!tenant) {
        return c.json(200, { found: false });
    }

    const schoolVersion = String(tenant.get("school_version") || "");
    const out = {
        found: true,
        name: String(tenant.get("name") || ""),
        clientId: String(tenant.get("client_id") || ""),
        logoUrl: "",
        primaryColor: "",
        secondaryColor: "",
        accentColor: ""
    };

    // ---- overlay whatever the school saved in its branding form -----------
    // app_settings holds the authoritative name/logo/colours once an admin has
    // set them; the tenant row only carries the name the operator typed.
    if (schoolVersion) {
        try {
            const setting = $app.dao().findFirstRecordByFilter(
                "app_settings",
                "key = {:key} && school_version = {:sv}",
                { key: "school_theme", sv: schoolVersion }
            );

            if (setting) {
                let theme = setting.get("value");
                if (typeof theme === "string") {
                    try { theme = JSON.parse(theme); } catch (e) { theme = null; }
                }
                if (theme && typeof theme === "object") {
                    if (theme.schoolName) out.name = String(theme.schoolName);
                    if (theme.primaryColor) out.primaryColor = String(theme.primaryColor);
                    if (theme.secondaryColor) out.secondaryColor = String(theme.secondaryColor);
                    if (theme.accentColor) out.accentColor = String(theme.accentColor);
                }

                // The logo is a file on the app_settings row, so build a URL the
                // browser can fetch directly rather than echoing bytes here.
                const logo = setting.get("logo");
                if (logo) {
                    out.logoUrl = "/api/files/" + setting.collection().Id +
                        "/" + setting.Id + "/" + logo;
                }
            }
        } catch (err) {
            // No theme saved yet, or the collection predates the migration.
            // The tenant's name alone is still worth returning.
            console.log("[brand] theme lookup failed for " + schoolVersion + ": " + err);
        }
    }

    // Cacheable: this changes only when a school edits its branding, and a few
    // minutes of staleness on a login screen is harmless. Keeps the login page
    // off the database on every visit.
    c.response().header().set("Cache-Control", "public, max-age=300");
    return c.json(200, out);
});
