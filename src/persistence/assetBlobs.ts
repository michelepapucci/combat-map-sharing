import { openDB, type DBSchema, type IDBPDatabase } from 'idb'

/**
 * The IndexedDB database `vtt` and read access to asset blobs.
 *
 * This is the ONLY persistence module the player window may import (lint and
 * src/architecture.test.ts enforce it): the player reads image blobs by the ids
 * it was sent and never loads a campaign. `openVttDb` is exported for the DM's
 * persistence modules only; player and canvas code must not call it (an
 * architecture test checks the source text).
 *
 * Stores (out-of-line keys):
 * - campaigns: campaign id -> campaign JSON (raw; validated on every load)
 * - assets: asset id -> image Blob (final at import, see AssetMeta)
 * - thumbnails: asset id -> small WebP/PNG Blob for the library (derived, never synced)
 * - meta: key -> value (last campaign id; later the remembered PAT and gist sync records)
 */
export const DB_NAME = 'vtt'
export const DB_VERSION = 1

export interface VttDbSchema extends DBSchema {
  campaigns: { key: string; value: unknown }
  assets: { key: string; value: Blob }
  thumbnails: { key: string; value: Blob }
  meta: { key: string; value: unknown }
}

export type VttDb = IDBPDatabase<VttDbSchema>

let connection: Promise<VttDb> | null = null

/** Opens (once) the app database, creating or upgrading its stores. DM persistence only. */
export function openVttDb(): Promise<VttDb> {
  if (connection) return connection
  const opening = openDB<VttDbSchema>(DB_NAME, DB_VERSION, {
    upgrade(db, oldVersion) {
      if (oldVersion < 1) {
        db.createObjectStore('campaigns')
        db.createObjectStore('assets')
        db.createObjectStore('thumbnails')
        db.createObjectStore('meta')
      }
    },
    // A newer app version (another tab) wants to upgrade: step aside, reopen on next use.
    blocking() {
      void opening.then((db) => db.close())
      connection = null
    },
    terminated() {
      connection = null
    },
  })
  connection = opening
  opening.catch(() => {
    if (connection === opening) connection = null
  })
  return opening
}

/** Closes the connection (tests use a fresh fake IndexedDB per test). */
export async function closeVttDb(): Promise<void> {
  const current = connection
  connection = null
  if (current) (await current.catch(() => null))?.close()
}

/** The stored image of an uploaded asset, or undefined if this device does not have it. */
export async function getAssetBlob(assetId: string): Promise<Blob | undefined> {
  const db = await openVttDb()
  return db.get('assets', assetId)
}
