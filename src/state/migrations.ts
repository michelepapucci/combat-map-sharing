/**
 * Schema versioning for persisted campaigns (IndexedDB autosave, gist sync, zip
 * backups). Every persisted campaign document carries a numeric `version`, and
 * migrateToCurrent upgrades old documents one version at a time.
 *
 * To change the persisted shape, follow CLAUDE.md → "Data model" → "Schema
 * changes" (bump the version, add MIGRATIONS[old], update the sample, add a new
 * frozen fixture). Migrations operate on plain JSON and must not import app
 * types or code: those change over time, while old saves do not.
 *
 * migrateToCurrent only checks and upgrades the version. It does NOT validate the
 * rest of the document: every load, import and gist pull must also run the
 * campaign validator (planned for milestone 3) before using or saving the result.
 *
 * Pure module: no React, no DOM.
 */
export const CURRENT_SCHEMA_VERSION = 2

export type JsonObject = { [key: string]: unknown }

/** Upgrades a document by exactly one version. Receives a deep copy; may mutate it. */
export type Migration = (doc: JsonObject) => JsonObject

/** MIGRATIONS[n] upgrades a version-n document to version n + 1. */
export const MIGRATIONS: Readonly<Partial<Record<number, Migration>>> = {
  /** v2 adds settings.units. Existing campaigns switch to metric (the DM's table uses meters). */
  1: (doc) => {
    const settings = doc['settings']
    return isJsonObject(settings) ? { ...doc, settings: { ...settings, units: 'metric' } } : doc
  },
}

export class SchemaVersionError extends Error {
  override name = 'SchemaVersionError'
}

export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Upgrades a persisted document of any supported version to CURRENT_SCHEMA_VERSION.
 * Throws SchemaVersionError for non-objects, documents without a valid version,
 * documents from a newer app version, or a missing migration step. The input is
 * never mutated. The result is NOT validated beyond its version.
 */
export function migrateToCurrent(
  raw: unknown,
  migrations: Readonly<Partial<Record<number, Migration>>> = MIGRATIONS,
  currentVersion: number = CURRENT_SCHEMA_VERSION,
): JsonObject {
  if (!isJsonObject(raw)) {
    throw new SchemaVersionError('This file does not contain a campaign.')
  }
  const version = raw['version']
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new SchemaVersionError('This campaign has no valid schema version.')
  }
  if (version > currentVersion) {
    throw new SchemaVersionError(
      `This campaign was saved by a newer version of the app (schema v${version}; this version ` +
        `understands up to v${currentVersion}). Reload the page to get the latest version.`,
    )
  }
  let doc: JsonObject = structuredClone(raw)
  for (let from = version; from < currentVersion; from++) {
    const migrate = migrations[from]
    if (!migrate) {
      throw new SchemaVersionError(`No migration from schema v${from} to v${from + 1}.`)
    }
    doc = { ...migrate(doc), version: from + 1 }
  }
  return doc
}
