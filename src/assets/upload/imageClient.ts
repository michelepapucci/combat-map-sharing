import type { AssetKind } from '../../state/types'
import type { ImageJob, ImageJobResult, ImportedImage } from './imageWorker'
import type { ImageMime } from './plan'

/**
 * Main-thread side of the image worker: one lazily started worker, jobs matched
 * to replies by id. DM only (uploads and library thumbnails).
 */

type Waiter = { resolve: (result: ImageJobResult) => void; reject: (error: Error) => void }

let worker: Worker | null = null
let nextId = 1
const waiting = new Map<number, Waiter>()

function failAll(message: string): void {
  for (const waiter of waiting.values()) waiter.reject(new Error(message))
  waiting.clear()
}

function getWorker(): Worker {
  if (worker) return worker
  const created = new Worker(new URL('./imageWorker.ts', import.meta.url), { type: 'module' })
  created.addEventListener('message', (event: MessageEvent<ImageJobResult>) => {
    const waiter = waiting.get(event.data.id)
    waiting.delete(event.data.id)
    waiter?.resolve(event.data)
  })
  created.addEventListener('error', (event) => {
    event.preventDefault()
    created.terminate()
    if (worker === created) worker = null
    failAll('The image processor stopped unexpectedly.')
  })
  worker = created
  return created
}

type JobInput =
  | { type: 'import'; file: Blob; mime: ImageMime; kind: AssetKind }
  | { type: 'thumbnail'; blob: Blob }

function run(input: JobInput): Promise<ImageJobResult> {
  const id = nextId++
  const job: ImageJob = { ...input, id }
  return new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject })
    // oxlint-disable-next-line unicorn/require-post-message-target-origin -- Worker.postMessage has no target origin
    getWorker().postMessage(job)
  })
}

/** Decodes, downscales and re-encodes as needed, hashes and thumbnails an uploaded file. */
export async function processImage(
  file: Blob,
  mime: ImageMime,
  kind: AssetKind,
): Promise<ImportedImage> {
  const result = await run({ type: 'import', file, mime, kind })
  if (!result.ok) throw new Error(result.error)
  if (!('image' in result)) throw new Error('Unexpected reply from the image processor.')
  return result.image
}

/** A library thumbnail for a stored image (for assets that arrived without one). */
export async function makeThumbnail(blob: Blob): Promise<Blob> {
  const result = await run({ type: 'thumbnail', blob })
  if (!result.ok) throw new Error(result.error)
  if (!('thumbnail' in result)) throw new Error('Unexpected reply from the image processor.')
  return result.thumbnail
}
