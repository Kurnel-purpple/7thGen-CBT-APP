/// <reference path="../pb_data/types.d.ts" />

/**
 * Keep exams.content_updated accurate on the server, regardless of client
 * version:
 *   - on create: stamp it (the content is born now)
 *   - on update: stamp it ONLY if the questions payload actually changed
 *
 * Extension grants, status toggles and schedule edits update the exam record
 * WITHOUT touching questions, so content_updated stays put and every client's
 * cached copy of the (multi-MB, image-embedding) questions stays valid.
 *
 * NOTE: v0.21 executes each handler in an isolated goja runtime — no shared
 * outer scope between handlers.
 */

onRecordBeforeCreateRequest((e) => {
    e.record.set("content_updated", new Date().toISOString());
}, "exams");

onRecordBeforeUpdateRequest((e) => {
    try {
        const incoming = e.record.getString("questions");
        const original = e.record.originalCopy().getString("questions");
        if (incoming !== original) {
            e.record.set("content_updated", new Date().toISOString());
        }
    } catch (err) {
        // Never block an exam save over the freshness marker — worst case the
        // marker goes stale-pessimistic and a client re-downloads once.
        console.log("[exam_content_updated] compare failed:", err);
    }
}, "exams");
