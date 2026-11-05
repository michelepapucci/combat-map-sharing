/**
 * GitHub REST client for gist sync (SPEC §7; CLAUDE.md "Gist (M8)", Decisions 31–34).
 *
 * Security rules (hard):
 * - The token travels only in the `Authorization` header of api.github.com
 *   requests: never in a URL, an error message, an error property or a log.
 * - Raw file URLs (gist.githubusercontent.com) are fetched with a bare
 *   `fetch(url)`: no init object, no headers, because that host rejects CORS
 *   preflights. They need no token (secret gists are unlisted, not private).
 * - Gists are created secret (`public: false`).
 * - API GETs use `cache: 'no-cache'`: GitHub marks responses cacheable for 60 s,
 *   and a stale commit SHA would hide a conflict.
 *
 * Responses are parsed defensively into fresh objects: a field GitHub omits gets
 * a neutral value, and a response of the wrong shape is a GitHubError.
 */

export const GITHUB_API = 'https://api.github.com'
const RAW_PREFIX = 'https://gist.githubusercontent.com/'
const RAW_HOST = 'gist.githubusercontent.com'
const API_VERSION = '2022-11-28'

const LIST_PAGE_SIZE = 100
const MAX_LIST_PAGES = 10
const COMMITS_PAGE_SIZE = 30
const DEFAULT_MAX_RETRIES = 3
/** Longest rate-limit wait worth retrying after; a longer one fails at once with its reset time. */
const MAX_WAIT_MS = 60_000
/** Margin added to x-ratelimit-reset, for clock differences with GitHub. */
const RESET_MARGIN_MS = 1_000
/** Wait before the single retry of a GET after a network error or a 5xx. */
const TRANSIENT_RETRY_MS = 1_000
const MAX_MESSAGE_LENGTH = 300

const GIST_ID = /^[A-Za-z0-9]{1,64}$/
const SHA = /^[0-9a-f]{1,64}$/i
/** GitHub tokens are visible ASCII; anything else would make `Headers` throw an error quoting it. */
const TOKEN_CHARS = /^[\x21-\x7e]+$/

const NETWORK_MESSAGE = 'Could not reach GitHub. Check the connection and try again.'
const UNEXPECTED_MESSAGE = 'GitHub sent an unexpected response.'
const RAW_NETWORK_MESSAGE =
  'Could not download a file from the gist. Check the connection and try again.'

export interface RateLimit {
  remaining: number
  /** Epoch ms when the limit resets. */
  resetAt: number
}

/** A failed GitHub request. The message is safe to show: it never contains the token. */
export class GitHubError extends Error {
  /** HTTP status; 0 for network failures. */
  readonly status: number
  /** From x-ratelimit-remaining / x-ratelimit-reset, when GitHub sent both. */
  readonly rateLimit: RateLimit | null

  constructor(message: string, status: number, rateLimit: RateLimit | null = null) {
    super(message)
    this.name = 'GitHubError'
    this.status = status
    this.rateLimit = rateLimit
  }
}

export interface GistFile {
  filename: string
  size: number
  /** `content` was cut short (files over about 1 MB): read the whole file from `rawUrl`. */
  truncated: boolean
  /** Null when the response did not include it (gist lists). */
  content: string | null
  /** Pinned to the revision's SHA; '' if GitHub sent none. */
  rawUrl: string
}

export interface GistData {
  id: string
  description: string
  htmlUrl: string
  updatedAt: string
  /** GitHub listed only some of the files (more than 300). */
  truncated: boolean
  files: Record<string, GistFile>
  /** SHA of the newest commit in `history`, when the response includes it. */
  latestSha: string | null
}

export interface GistSummary {
  id: string
  description: string
  htmlUrl: string
  updatedAt: string
  filenames: string[]
}

export interface GistCommit {
  sha: string
  committedAt: string
  /** change_status.total (changed lines), 0 when absent. */
  changes: number
}

export interface GistApi {
  /** GET /user: who the token belongs to (validates the token). */
  getUser(): Promise<{ login: string }>
  /** GET /gists, every page up to 1000 gists. */
  listGists(): Promise<GistSummary[]>
  getGist(id: string): Promise<GistData>
  /** The gist as it was at commit `sha`. */
  getRevision(id: string, sha: string): Promise<GistData>
  /** SHA of the newest commit, null if the gist has none. */
  latestCommitSha(id: string): Promise<string | null>
  /** Newest first, 30 per page (`page` from 1). */
  listCommits(id: string, page?: number): Promise<GistCommit[]>
  /** Creates a secret gist. */
  createGist(description: string, files: Record<string, string>): Promise<GistData>
  /** Sets file contents; `null` deletes a file. */
  updateGist(
    id: string,
    files: Record<string, string | null>,
    description?: string,
  ): Promise<GistData>
  /** A file from its raw URL (https://gist.githubusercontent.com/ only), with a bare fetch. */
  fetchRaw(rawUrl: string): Promise<string>
}

export interface GistApiOptions {
  fetch?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  /** Retries after rate-limit responses (default 3). */
  maxRetries?: number
}

interface Client {
  token: string
  fetch: typeof fetch
  sleep: (ms: number) => Promise<void>
  maxRetries: number
}

type Method = 'GET' | 'POST' | 'PATCH'

// The global fetch, called through a wrapper so it never runs with a foreign `this`.
const globalFetch: typeof fetch = (...args) => fetch(...args)

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function createGistApi(token: string, options: GistApiOptions = {}): GistApi {
  const client: Client = {
    token: token.trim(),
    fetch: options.fetch ?? globalFetch,
    sleep: options.sleep ?? delay,
    maxRetries: options.maxRetries ?? DEFAULT_MAX_RETRIES,
  }
  return {
    async getUser() {
      const data = await apiRequest(client, 'GET', '/user')
      if (!isRecord(data) || typeof data.login !== 'string') throw unexpected(200)
      return { login: data.login }
    },
    async listGists() {
      const summaries: GistSummary[] = []
      for (let page = 1; page <= MAX_LIST_PAGES; page++) {
        const data = await apiRequest(
          client,
          'GET',
          `/gists?per_page=${LIST_PAGE_SIZE}&page=${page}`,
        )
        if (!Array.isArray(data)) throw unexpected(200)
        summaries.push(...data.map(parseSummary))
        if (data.length < LIST_PAGE_SIZE) break
      }
      return summaries
    },
    async getGist(id) {
      return parseGist(await apiRequest(client, 'GET', `/gists/${gistPath(id)}`))
    },
    async getRevision(id, sha) {
      return parseGist(await apiRequest(client, 'GET', `/gists/${gistPath(id)}/${shaPath(sha)}`))
    },
    async latestCommitSha(id) {
      const data = await apiRequest(client, 'GET', `/gists/${gistPath(id)}/commits?per_page=1`)
      return parseCommits(data)[0]?.sha ?? null
    },
    async listCommits(id, page = 1) {
      if (!Number.isSafeInteger(page) || page < 1) {
        throw new RangeError('The history page must be a whole number from 1')
      }
      const path = `/gists/${gistPath(id)}/commits?per_page=${COMMITS_PAGE_SIZE}&page=${page}`
      return parseCommits(await apiRequest(client, 'GET', path))
    },
    async createGist(description, files) {
      const body = { description, public: false, files: fileContents(files) }
      return parseGist(await apiRequest(client, 'POST', '/gists', body))
    },
    async updateGist(id, files, description) {
      const path = `/gists/${gistPath(id)}`
      const body =
        description === undefined
          ? { files: fileContents(files) }
          : { description, files: fileContents(files) }
      return parseGist(await apiRequest(client, 'PATCH', path, body))
    },
    fetchRaw(rawUrl) {
      return fetchRaw(client, rawUrl)
    },
  }
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

function gistPath(id: string): string {
  if (!GIST_ID.test(id)) throw new GitHubError('That is not a valid gist id.', 404)
  return id
}

function shaPath(sha: string): string {
  if (!SHA.test(sha)) throw new GitHubError('That is not a valid gist revision.', 404)
  return sha
}

function fileContents(
  files: Record<string, string | null>,
): Record<string, { content: string } | null> {
  return Object.fromEntries(
    Object.entries(files).map(([name, content]) => [name, content === null ? null : { content }]),
  )
}

/**
 * One API call with retries: after rate limits (any method, since GitHub did not
 * process the request), and once after a network error or a 5xx for GETs only
 * (a POST or PATCH may have been applied).
 */
async function apiRequest(
  client: Client,
  method: Method,
  path: string,
  body?: unknown,
): Promise<unknown> {
  if (!TOKEN_CHARS.test(client.token)) {
    throw new GitHubError('The GitHub token is malformed. Paste it again.', 401)
  }
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${client.token}`,
    'X-GitHub-Api-Version': API_VERSION,
  }
  const init: RequestInit = { method, headers }
  if (method === 'GET') init.cache = 'no-cache'
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
    init.body = JSON.stringify(body)
  }
  const idempotent = method === 'GET'
  let limitedRetries = 0
  let transientRetried = false
  for (;;) {
    let response: Response
    try {
      response = await client.fetch(`${GITHUB_API}${path}`, init)
    } catch {
      // Not the thrown error itself: its message or cause could describe the request.
      if (idempotent && !transientRetried) {
        transientRetried = true
        await client.sleep(TRANSIENT_RETRY_MS)
        continue
      }
      throw new GitHubError(NETWORK_MESSAGE, 0)
    }
    const text = await readText(response)
    if (response.ok) {
      if (text === null) throw new GitHubError(NETWORK_MESSAGE, 0)
      return parseJson(text, response.status)
    }
    const message = cleanMessage(githubMessage(text ?? ''), client.token)
    const limited = isRateLimited(response.status, response.headers, message)
    if (limited) {
      const wait = rateLimitWait(response.headers, limitedRetries, Date.now())
      if (limitedRetries < client.maxRetries && wait <= MAX_WAIT_MS) {
        limitedRetries++
        await client.sleep(wait)
        continue
      }
    } else if (response.status >= 500 && idempotent && !transientRetried) {
      transientRetried = true
      await client.sleep(TRANSIENT_RETRY_MS)
      continue
    }
    throw new GitHubError(
      errorMessage(response.status, message, limited),
      response.status,
      readRateLimit(response.headers),
    )
  }
}

/** A gist file's text from its raw URL: a bare fetch (no init, no headers), one retry. */
async function fetchRaw(client: Client, rawUrl: string): Promise<string> {
  if (!isRawUrl(rawUrl))
    throw new Error('Refusing to download a gist file from an unexpected address.')
  let retried = false
  for (;;) {
    let response: Response
    try {
      response = await client.fetch(rawUrl)
    } catch {
      if (!retried) {
        retried = true
        await client.sleep(TRANSIENT_RETRY_MS)
        continue
      }
      throw new GitHubError(RAW_NETWORK_MESSAGE, 0)
    }
    if (response.ok) {
      const text = await readText(response)
      if (text === null) throw new GitHubError(RAW_NETWORK_MESSAGE, 0)
      return text
    }
    if ((response.status >= 500 || response.status === 429) && !retried) {
      retried = true
      await client.sleep(TRANSIENT_RETRY_MS)
      continue
    }
    throw new GitHubError(
      `Could not download a file from the gist (HTTP ${response.status}).`,
      response.status,
    )
  }
}

function isRawUrl(rawUrl: string): boolean {
  if (!rawUrl.startsWith(RAW_PREFIX)) return false
  try {
    const url = new URL(rawUrl)
    return (
      url.protocol === 'https:' &&
      url.hostname === RAW_HOST &&
      url.port === '' &&
      url.username === '' &&
      url.password === ''
    )
  } catch {
    return false
  }
}

async function readText(response: Response): Promise<string | null> {
  try {
    return await response.text()
  } catch {
    return null
  }
}

function parseJson(text: string, status: number): unknown {
  if (text === '') return null
  try {
    return JSON.parse(text)
  } catch {
    throw unexpected(status)
  }
}

function unexpected(status: number): GitHubError {
  return new GitHubError(UNEXPECTED_MESSAGE, status)
}

/** GitHub's JSON `message`, or ''. */
function githubMessage(text: string): string {
  try {
    const data: unknown = JSON.parse(text)
    return isRecord(data) && typeof data.message === 'string' ? data.message : ''
  } catch {
    return ''
  }
}

/** Never lets the token through (should GitHub ever echo it), and keeps messages short. */
function cleanMessage(message: string, token: string): string {
  const safe = token === '' ? message : message.split(token).join('[token]')
  const oneLine = safe.replace(/\s+/g, ' ').trim()
  return oneLine.length > MAX_MESSAGE_LENGTH
    ? `${oneLine.slice(0, MAX_MESSAGE_LENGTH - 1)}…`
    : oneLine
}

function errorMessage(status: number, message: string, rateLimited: boolean): string {
  if (status === 401) return 'The GitHub token was rejected (expired or revoked?)'
  if (status === 404) return 'Gist not found (or the token cannot see it)'
  if (message !== '') return message
  if (rateLimited) return 'GitHub rate limit reached. Try again later.'
  return `GitHub request failed (HTTP ${status}).`
}

function isRateLimited(status: number, headers: Headers, message: string): boolean {
  if (status === 429) return true
  if (status !== 403) return false
  return (
    headers.has('retry-after') ||
    headers.get('x-ratelimit-remaining') === '0' ||
    /secondary rate limit/i.test(message)
  )
}

/** GitHub's advice: retry-after seconds, else until x-ratelimit-reset, else 1 s, 2 s, 4 s... */
function rateLimitWait(headers: Headers, attempt: number, now: number): number {
  const retryAfter = headers.get('retry-after')?.trim() ?? ''
  if (/^\d+$/.test(retryAfter)) return Number(retryAfter) * 1000
  if (headers.get('x-ratelimit-remaining') === '0') {
    const reset = Number(headers.get('x-ratelimit-reset'))
    if (Number.isFinite(reset) && reset > 0) {
      return Math.max(0, reset * 1000 - now) + RESET_MARGIN_MS
    }
  }
  return 1000 * 2 ** attempt
}

function readRateLimit(headers: Headers): RateLimit | null {
  const remaining = headers.get('x-ratelimit-remaining')
  const reset = headers.get('x-ratelimit-reset')
  if (remaining === null || reset === null) return null
  if (!/^\d+$/.test(remaining.trim()) || !/^\d+$/.test(reset.trim())) return null
  return { remaining: Number(remaining), resetAt: Number(reset) * 1000 }
}

// ---------------------------------------------------------------------------
// Response parsing
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringOr(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function parseFile(name: string, value: unknown): GistFile | null {
  if (!isRecord(value)) return null
  const size = value.size
  return {
    filename: typeof value.filename === 'string' ? value.filename : name,
    size: typeof size === 'number' && Number.isFinite(size) && size >= 0 ? size : 0,
    truncated: value.truncated === true,
    content: typeof value.content === 'string' ? value.content : null,
    rawUrl: stringOr(value.raw_url),
  }
}

function parseGist(data: unknown): GistData {
  if (!isRecord(data) || typeof data.id !== 'string' || data.id === '') throw unexpected(200)
  const rawFiles = isRecord(data.files) ? data.files : {}
  // fromEntries defines own properties, so a file named `__proto__` cannot reach the prototype.
  const files = Object.fromEntries(
    Object.entries(rawFiles).flatMap(([name, value]) => {
      const file = parseFile(name, value)
      return file === null ? [] : [[name, file] as const]
    }),
  )
  const history = Array.isArray(data.history) ? data.history : []
  const first: unknown = history[0]
  return {
    id: data.id,
    description: stringOr(data.description),
    htmlUrl: stringOr(data.html_url),
    updatedAt: stringOr(data.updated_at),
    truncated: data.truncated === true,
    files,
    latestSha: isRecord(first) && typeof first.version === 'string' ? first.version : null,
  }
}

function parseSummary(value: unknown): GistSummary {
  if (!isRecord(value) || typeof value.id !== 'string') throw unexpected(200)
  return {
    id: value.id,
    description: stringOr(value.description),
    htmlUrl: stringOr(value.html_url),
    updatedAt: stringOr(value.updated_at),
    filenames: isRecord(value.files) ? Object.keys(value.files) : [],
  }
}

function parseCommits(data: unknown): GistCommit[] {
  if (!Array.isArray(data)) throw unexpected(200)
  return data.map((value: unknown): GistCommit => {
    if (!isRecord(value) || typeof value.version !== 'string') throw unexpected(200)
    const status = value.change_status
    const total = isRecord(status) ? status.total : undefined
    return {
      sha: value.version,
      committedAt: stringOr(value.committed_at),
      changes: typeof total === 'number' && Number.isFinite(total) ? total : 0,
    }
  })
}
