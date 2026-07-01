/// <reference path="../pb_data/types.d.ts" />
// Adds the "super_admin" value to the role select on _pb_users_auth_ and profiles.
// Idempotent — re-running has no effect.
//
// IMPORTANT: never use `Object.assign({}, field.options, ...)` here. The Goja
// binding around field.options is a Go struct proxy whose enumerable
// properties include bound Go methods; copying them into a plain JS object
// produces a `func() bool` value that PocketBase can't JSON-marshal.
// Always build a fresh options literal with only the data fields.

migrate((db) => {
  const dao = new Dao(db)
  const targets = [
    { collectionId: "_pb_users_auth_" },
    { collectionId: "zcs0vt9obnt3yzy" }
  ]

  for (const t of targets) {
    try {
      const collection = dao.findCollectionByNameOrId(t.collectionId)
      const field = collection.schema.getFieldByName("role")
      if (!field || !field.options) continue

      const currentValues = []
      const src = field.options.values || []
      for (let i = 0; i < src.length; i++) {
        currentValues.push(String(src[i]))
      }
      if (currentValues.indexOf("super_admin") !== -1) {
        // Already present — skip this collection
        continue
      }

      currentValues.push("super_admin")

      // Build a fresh options literal — only data fields, no Go method refs
      field.options = {
        maxSelect: field.options.maxSelect || 1,
        values: currentValues
      }

      dao.saveCollection(collection)
    } catch (e) {
      console.log("[migration 1770841000] skipped " + t.collectionId + ": " + (e && e.message || e))
    }
  }

  return null
}, (db) => {
  const dao = new Dao(db)
  const targets = [
    { collectionId: "_pb_users_auth_" },
    { collectionId: "zcs0vt9obnt3yzy" }
  ]

  for (const t of targets) {
    try {
      const collection = dao.findCollectionByNameOrId(t.collectionId)
      const field = collection.schema.getFieldByName("role")
      if (!field || !field.options) continue

      const filtered = []
      const src = field.options.values || []
      for (let i = 0; i < src.length; i++) {
        const v = String(src[i])
        if (v !== "super_admin") filtered.push(v)
      }

      field.options = {
        maxSelect: field.options.maxSelect || 1,
        values: filtered
      }

      dao.saveCollection(collection)
    } catch (_) { /* ignore */ }
  }

  return null
})
