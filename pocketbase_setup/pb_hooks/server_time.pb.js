/// <reference path="../pb_data/types.d.ts" />

/**
 * Trusted server time, readable cross-origin.
 *
 * WHY: the client used to read the `Date` HTTP header off /api/health. But
 * `Date` is NOT a CORS-safelisted response header, and the frontend
 * (seatoscbt.com, Netlify) is a different origin from this API
 * (gen7-cbt-app.fly.dev, Fly) — so headers.get('Date') returns null in the
 * browser every single time in production.
 *
 * The client then fell through to estimating server time from the newest
 * record's `updated` timestamp, which is the AGE OF THAT RECORD, not the
 * time. Whenever nothing had been written for a while, that produced wild
 * offsets (-12.8h was seen in the field). The offset is persisted, and every
 * scheduled exam is compared against it, so the dashboard silently showed no
 * exams until a later sync happened to overwrite the bad value.
 *
 * Returning the time in the response BODY sidesteps CORS header rules
 * entirely. Unauthenticated on purpose: the login screen and the exam
 * countdown both need it before any session exists, and the current time is
 * not a secret.
 *
 * NOTE: v0.21 executes each handler in an isolated goja runtime — no shared
 * outer scope between handlers.
 */

routerAdd("GET", "/api/cbt/time", (c) => {
    const now = new Date();
    return c.json(200, {
        // Milliseconds since epoch — what the client actually does arithmetic on
        now: now.getTime(),
        iso: now.toISOString()
    });
});

/**
 * Belt and braces: also expose the `Date` header to cross-origin readers, so
 * the header strategy works for any client that still prefers it (and for
 * anything hitting the API directly).
 */
routerAdd("GET", "/api/cbt/time-check", (c) => {
    c.response().header().set("Access-Control-Expose-Headers", "Date");
    return c.json(200, { ok: true });
});
