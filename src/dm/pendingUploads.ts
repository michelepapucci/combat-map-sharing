import type { Id } from '../state/types'

/**
 * Ids of uploads whose blobs are already stored but not yet in the library.
 * Asset garbage collection must keep them.
 */
export const pendingUploads = new Set<Id>()
