/**
 * An in-memory GitHub for the gist tests (imported by tests only). It serves the
 * endpoints api.ts uses, with git-backed history (every change is a commit with
 * a random 40-hex SHA; GET /gists/{id}/{sha} returns that revision), files cut
 * short over `truncateOver` characters with a SHA-pinned raw_url, a top-level
 * `truncated` flag over `maxListedFiles` files, a scriptable failure queue, and
 * 401 for a wrong token.
 *
 * Raw URLs on gist.githubusercontent.com need no token. Like the real host, a
 * raw request that would need a CORS preflight (any header, or a method other
 * than GET) fails as a network error.
 */
import { GITHUB_API } from './api'

export const FAKE_TOKEN = 'ghp_FakeTokenForTheGistTests0123456789'
export const FAKE_LOGIN = 'dungeon-master'
const RAW_ORIGIN = 'https://gist.githubusercontent.com'
const HISTORY_IN_GIST = 10

export interface FakeCommit {
  sha: string
  committedAt: string
  /** The full file set at this commit. */
  files: Record<string, string>
  /** Files added, changed or deleted by this commit. */
  changes: number
}

export interface FakeGist {
  id: string
  description: string
  public: boolean
  createdAt: string
  /** Newest first; never empty. */
  history: FakeCommit[]
}

export interface FakeRequest {
  url: string
  method: string
  /** Lowercased names, as `Headers` reports them. */
  headers: Record<string, string>
  cache: RequestCache | undefined
  /** Parsed JSON body, null without one. */
  body: unknown
  /** How many arguments fetch was called with (a bare fetch passes exactly 1). */
  argCount: number
}

/** The next request matching `match` (any request without it) fails like this; no `message` = no JSON message. */
export type FakeFailure = (
  { status: number; headers?: Record<string, string>; message?: string } | { network: true }
) & { match?: (request: FakeRequest) => boolean }

export interface FakeGitHubOptions {
  token?: string
  login?: string
  /** Inline content is cut short above this many characters (GitHub: about 1 MB). */
  truncateOver?: number
  /** At most this many files are listed in a gist response (GitHub: 300). */
  maxListedFiles?: number
}

export interface FakeGitHub {
  fetch: typeof fetch
  gists: Map<string, FakeGist>
  requests: FakeRequest[]
  /** Mutable: tests may change the limits between requests. */
  settings: { truncateOver: number; maxListedFiles: number }
  /** Queues failures for the next matching requests, in order. */
  fail(...failures: FakeFailure[]): void
  /** Creates a gist directly (no request, no auth), e.g. to fill gist lists. */
  seedGist(files: Record<string, string>, description?: string): FakeGist
  /** The files of a gist's latest commit. */
  latestFiles(id: string): Record<string, string>
}

function randomHex(length: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(Math.ceil(length / 2)))
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, length)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function json(status: number, data: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  })
}

function notFound(): Response {
  return json(404, { message: 'Not Found' })
}

function invalid(message = 'Validation Failed'): Response {
  return json(422, { message })
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  return input.url
}

function recordHeaders(init: RequestInit | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  new Headers(init?.headers).forEach((value, name) => {
    out[name] = value
  })
  return out
}

function parseBody(init: RequestInit | undefined): unknown {
  return typeof init?.body === 'string' ? JSON.parse(init.body) : null
}

function pageOf<T>(items: T[], params: URLSearchParams): T[] {
  const perPage = Math.min(100, Number(params.get('per_page') ?? 30))
  const page = Math.max(1, Number(params.get('page') ?? 1))
  return items.slice((page - 1) * perPage, page * perPage)
}

function countChanges(before: Record<string, string>, after: Record<string, string>): number {
  const names = new Set([...Object.keys(before), ...Object.keys(after)])
  let changes = 0
  for (const name of names) {
    if (before[name] !== after[name]) changes++
  }
  return changes
}

export function createFakeGitHub(options: FakeGitHubOptions = {}): FakeGitHub {
  const token = options.token ?? FAKE_TOKEN
  const login = options.login ?? FAKE_LOGIN
  const settings = {
    truncateOver: options.truncateOver ?? 1_000_000,
    maxListedFiles: options.maxListedFiles ?? 300,
  }
  const gists = new Map<string, FakeGist>()
  const requests: FakeRequest[] = []
  const failures: FakeFailure[] = []
  let clock = Date.parse('2026-01-01T00:00:00Z')

  const tick = (): string => {
    clock += 1000
    return new Date(clock).toISOString()
  }

  const latest = (gist: FakeGist): FakeCommit => {
    const commit = gist.history[0]
    if (!commit) throw new Error('A fake gist always has a commit')
    return commit
  }

  const addCommit = (gist: FakeGist, files: Record<string, string>, changes: number): void => {
    gist.history.unshift({ sha: randomHex(40), committedAt: tick(), files, changes })
  }

  const rawUrl = (gist: FakeGist, commit: FakeCommit, name: string): string =>
    `${RAW_ORIGIN}/${login}/${gist.id}/raw/${commit.sha}/${encodeURIComponent(name)}`

  const fileJson = (gist: FakeGist, commit: FakeCommit, name: string, withContent: boolean) => {
    const content = commit.files[name] ?? ''
    const truncated = content.length > settings.truncateOver
    return {
      filename: name,
      type: 'text/plain',
      language: null,
      raw_url: rawUrl(gist, commit, name),
      size: content.length,
      ...(withContent
        ? { truncated, content: truncated ? content.slice(0, settings.truncateOver) : content }
        : {}),
    }
  }

  const commitJson = (gist: FakeGist, commit: FakeCommit) => ({
    user: { login },
    version: commit.sha,
    committed_at: commit.committedAt,
    change_status: { total: commit.changes, additions: commit.changes, deletions: 0 },
    url: `${GITHUB_API}/gists/${gist.id}/${commit.sha}`,
  })

  const gistJson = (gist: FakeGist, commit: FakeCommit, full: boolean) => {
    const names = Object.keys(commit.files).toSorted()
    const listed = names.slice(0, settings.maxListedFiles)
    const index = gist.history.indexOf(commit)
    return {
      id: gist.id,
      url: `${GITHUB_API}/gists/${gist.id}`,
      html_url: `https://gist.github.com/${login}/${gist.id}`,
      description: gist.description,
      public: gist.public,
      created_at: gist.createdAt,
      updated_at: latest(gist).committedAt,
      owner: { login },
      truncated: names.length > settings.maxListedFiles,
      files: Object.fromEntries(listed.map((name) => [name, fileJson(gist, commit, name, full)])),
      ...(full
        ? {
            history: gist.history
              .slice(index, index + HISTORY_IN_GIST)
              .map((c) => commitJson(gist, c)),
          }
        : {}),
    }
  }

  const seedGist = (files: Record<string, string>, description = ''): FakeGist => {
    const createdAt = tick()
    const gist: FakeGist = {
      id: randomHex(32),
      description,
      public: false,
      createdAt,
      history: [],
    }
    addCommit(gist, { ...files }, Object.keys(files).length)
    gists.set(gist.id, gist)
    return gist
  }

  const createGist = (body: unknown): Response => {
    if (!isRecord(body) || !isRecord(body.files) || typeof body.public !== 'boolean') {
      return invalid()
    }
    const files: Record<string, string> = {}
    for (const [name, value] of Object.entries(body.files)) {
      if (!isRecord(value) || typeof value.content !== 'string' || value.content === '') {
        return invalid()
      }
      files[name] = value.content
    }
    if (Object.keys(files).length === 0) return invalid()
    const gist = seedGist(files, typeof body.description === 'string' ? body.description : '')
    gist.public = body.public
    return json(201, gistJson(gist, latest(gist), true))
  }

  const updateGist = (gist: FakeGist, body: unknown): Response => {
    if (!isRecord(body)) return invalid()
    const before = latest(gist).files
    const after: Record<string, string> = { ...before }
    if (body.files !== undefined) {
      if (!isRecord(body.files)) return invalid()
      for (const [name, value] of Object.entries(body.files)) {
        if (value === null) {
          if (!Object.hasOwn(after, name)) return invalid()
          delete after[name]
        } else if (isRecord(value) && typeof value.content === 'string' && value.content !== '') {
          after[name] = value.content
        } else {
          return invalid()
        }
      }
    }
    if (Object.keys(after).length === 0) return invalid()
    if (typeof body.description === 'string') gist.description = body.description
    const changes = countChanges(before, after)
    // Like git: no commit when no file changed.
    if (changes > 0) addCommit(gist, after, changes)
    return json(200, gistJson(gist, latest(gist), true))
  }

  const listGists = (params: URLSearchParams): Response => {
    const all = [...gists.values()].toSorted((a, b) =>
      latest(b).committedAt.localeCompare(latest(a).committedAt),
    )
    return json(
      200,
      pageOf(all, params).map((gist) => gistJson(gist, latest(gist), false)),
    )
  }

  const api = (request: FakeRequest, url: URL): Response => {
    if (request.headers.authorization !== `Bearer ${token}`) {
      return json(401, { message: 'Bad credentials' })
    }
    const parts = url.pathname.split('/').filter((part) => part !== '')
    const { method } = request
    if (parts[0] === 'user' && parts.length === 1 && method === 'GET') {
      return json(200, { login, id: 1 })
    }
    if (parts[0] !== 'gists') return notFound()
    if (parts.length === 1) {
      if (method === 'GET') return listGists(url.searchParams)
      if (method === 'POST') return createGist(request.body)
      return notFound()
    }
    const gist = gists.get(parts[1] ?? '')
    if (!gist) return notFound()
    if (parts.length === 2) {
      if (method === 'GET') return json(200, gistJson(gist, latest(gist), true))
      if (method === 'PATCH') return updateGist(gist, request.body)
      return notFound()
    }
    if (parts.length === 3 && method === 'GET') {
      if (parts[2] === 'commits') {
        return json(
          200,
          pageOf(gist.history, url.searchParams).map((c) => commitJson(gist, c)),
        )
      }
      const commit = gist.history.find((c) => c.sha === parts[2])
      return commit ? json(200, gistJson(gist, commit, true)) : notFound()
    }
    return notFound()
  }

  const raw = (url: URL): Response => {
    // /<login>/<gist id>/raw/<sha>/<file name>
    const parts = url.pathname.split('/').filter((part) => part !== '')
    const [owner, id, kind, sha, name] = parts
    const gist = gists.get(id ?? '')
    const commit = gist?.history.find((c) => c.sha === sha)
    const file = name === undefined ? undefined : decodeURIComponent(name)
    if (owner !== login || kind !== 'raw' || parts.length !== 5 || !commit || file === undefined) {
      return new Response('404: Not Found', { status: 404 })
    }
    const content = Object.hasOwn(commit.files, file) ? commit.files[file] : undefined
    if (content === undefined) return new Response('404: Not Found', { status: 404 })
    return new Response(content, { status: 200, headers: { 'content-type': 'text/plain' } })
  }

  const fakeFetch: typeof fetch = async (...args) => {
    const [input, init] = args
    const url = requestUrl(input)
    const request: FakeRequest = {
      url,
      method: init?.method ?? 'GET',
      headers: recordHeaders(init),
      cache: init?.cache,
      body: parseBody(init),
      argCount: args.length,
    }
    requests.push(request)
    const index = failures.findIndex((failure) => !failure.match || failure.match(request))
    if (index >= 0) {
      const [failure] = failures.splice(index, 1)
      if (failure && 'network' in failure) throw new TypeError('Failed to fetch')
      if (failure) {
        const body = failure.message === undefined ? {} : { message: failure.message }
        return json(failure.status, body, failure.headers)
      }
    }
    const parsed = new URL(url)
    if (parsed.origin === RAW_ORIGIN) {
      // gist.githubusercontent.com rejects CORS preflights.
      if (Object.keys(request.headers).length > 0 || request.method !== 'GET') {
        throw new TypeError('Failed to fetch')
      }
      return raw(parsed)
    }
    if (parsed.origin === GITHUB_API) return api(request, parsed)
    throw new TypeError('Failed to fetch')
  }

  return {
    fetch: fakeFetch,
    gists,
    requests,
    settings,
    fail(...queued) {
      failures.push(...queued)
    },
    seedGist,
    latestFiles(id) {
      const gist = gists.get(id)
      if (!gist) throw new Error(`No fake gist ${id}`)
      return latest(gist).files
    },
  }
}
