import { afterEach, describe, expect, it } from 'vitest'
import { createGistApi, GITHUB_API, GitHubError, type GistApi } from './api'
import { createFakeGitHub, FAKE_LOGIN, FAKE_TOKEN, type FakeGitHub } from './fakeGitHub'

let fake: FakeGitHub
let sleeps: number[]

function setup(
  options: { token?: string; maxRetries?: number; truncateOver?: number } = {},
): GistApi {
  fake = createFakeGitHub({ truncateOver: options.truncateOver })
  sleeps = []
  return createGistApi(options.token ?? FAKE_TOKEN, {
    fetch: fake.fetch,
    sleep: (ms) => {
      sleeps.push(ms)
      return Promise.resolve()
    },
    maxRetries: options.maxRetries,
  })
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise
  } catch (error) {
    return error
  }
  throw new Error('expected a rejection')
}

async function githubError(promise: Promise<unknown>): Promise<GitHubError> {
  const error = await rejection(promise)
  expect(error).toBeInstanceOf(GitHubError)
  if (!(error instanceof GitHubError)) throw new Error('not a GitHubError')
  return error
}

/** Every string an error exposes: message, properties, JSON, stack. */
function exposed(error: unknown): string {
  if (!(error instanceof Error)) return String(error)
  return [
    String(error),
    error.message,
    error.stack ?? '',
    JSON.stringify(error),
    JSON.stringify(Object.entries(error)),
  ].join('\n')
}

afterEach(() => {
  // The token never appears in any URL or body, in any test.
  for (const request of fake.requests) {
    if (request.url.includes(FAKE_TOKEN) || JSON.stringify(request.body).includes(FAKE_TOKEN)) {
      throw new Error(`The token leaked into a request to ${request.url.slice(0, 40)}`)
    }
  }
})

describe('requests', () => {
  it('sends the token only in the Authorization header, with the API headers', async () => {
    const api = setup()
    expect(await api.getUser()).toStrictEqual({ login: FAKE_LOGIN })
    expect(fake.requests).toHaveLength(1)
    const [request] = fake.requests
    expect(request?.url).toBe(`${GITHUB_API}/user`)
    expect(request?.method).toBe('GET')
    expect(request?.headers).toStrictEqual({
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${FAKE_TOKEN}`,
      'x-github-api-version': '2022-11-28',
    })
  })

  it('trims a pasted token', async () => {
    const api = setup({ token: `  ${FAKE_TOKEN}\n` })
    expect(await api.getUser()).toStrictEqual({ login: FAKE_LOGIN })
  })

  it('refuses a malformed token without sending it anywhere', async () => {
    const api = setup({ token: 'ghp_abc\ndef' })
    const error = await githubError(api.getUser())
    expect(error.status).toBe(401)
    expect(exposed(error)).not.toContain('ghp_abc')
    expect(fake.requests).toHaveLength(0)
  })

  it('bypasses the HTTP cache on GETs only', async () => {
    const api = setup()
    const gist = await api.createGist('d', { 'a.txt': 'one' })
    await api.getGist(gist.id)
    await api.updateGist(gist.id, { 'a.txt': 'two' })
    await api.latestCommitSha(gist.id)
    await api.listCommits(gist.id)
    await api.getRevision(gist.id, gist.latestSha ?? '')
    await api.listGists()
    for (const request of fake.requests) {
      expect(request.cache).toBe(request.method === 'GET' ? 'no-cache' : undefined)
    }
    const bodies = fake.requests.filter((r) => r.method !== 'GET')
    expect(bodies).toHaveLength(2)
    for (const request of bodies) expect(request.headers['content-type']).toBe('application/json')
  })

  it('creates secret gists', async () => {
    const api = setup()
    const gist = await api.createGist('VTT campaign: X', { 'a.json': '{}', 'b.txt': 'b' })
    expect(fake.requests[0]?.method).toBe('POST')
    expect(fake.requests[0]?.url).toBe(`${GITHUB_API}/gists`)
    expect(fake.requests[0]?.body).toStrictEqual({
      description: 'VTT campaign: X',
      public: false,
      files: { 'a.json': { content: '{}' }, 'b.txt': { content: 'b' } },
    })
    expect(fake.gists.get(gist.id)?.public).toBe(false)
    expect(gist.description).toBe('VTT campaign: X')
    expect(gist.truncated).toBe(false)
    expect(gist.latestSha).toMatch(/^[0-9a-f]{40}$/)
    expect(gist.htmlUrl).toBe(`https://gist.github.com/${FAKE_LOGIN}/${gist.id}`)
    expect(gist.files['a.json']).toStrictEqual({
      filename: 'a.json',
      size: 2,
      truncated: false,
      content: '{}',
      rawUrl: `https://gist.githubusercontent.com/${FAKE_LOGIN}/${gist.id}/raw/${gist.latestSha}/a.json`,
    })
  })

  it('updates, deletes files and changes the description', async () => {
    const api = setup()
    const gist = await api.createGist('old', { 'a.txt': 'a', 'b.txt': 'b' })
    const updated = await api.updateGist(
      gist.id,
      { 'a.txt': 'A', 'b.txt': null, 'c.txt': 'c' },
      'new',
    )
    expect(fake.requests[1]?.method).toBe('PATCH')
    expect(fake.requests[1]?.body).toStrictEqual({
      description: 'new',
      files: { 'a.txt': { content: 'A' }, 'b.txt': null, 'c.txt': { content: 'c' } },
    })
    expect(Object.keys(updated.files).toSorted()).toStrictEqual(['a.txt', 'c.txt'])
    expect(updated.description).toBe('new')
    expect(updated.latestSha).not.toBe(gist.latestSha)
    expect(await api.latestCommitSha(gist.id)).toBe(updated.latestSha)
    // Without a description, the body has no description key.
    await api.updateGist(gist.id, { 'a.txt': 'AA' })
    expect(fake.requests.at(-1)?.body).toStrictEqual({ files: { 'a.txt': { content: 'AA' } } })
  })

  it('reads revisions and the commit history', async () => {
    const api = setup()
    const first = await api.createGist('d', { 'a.txt': 'v1' })
    const second = await api.updateGist(first.id, { 'a.txt': 'v2' })
    const third = await api.updateGist(first.id, { 'a.txt': 'v3' })
    const old = await api.getRevision(first.id, first.latestSha ?? '')
    expect(old.files['a.txt']?.content).toBe('v1')
    expect((await api.getGist(first.id)).files['a.txt']?.content).toBe('v3')
    const commits = await api.listCommits(first.id)
    expect(commits.map((c) => c.sha)).toStrictEqual([
      third.latestSha,
      second.latestSha,
      first.latestSha,
    ])
    expect(commits[0]?.changes).toBe(1)
    expect(commits[0]?.committedAt).toMatch(/^\d{4}-\d\d-\d\dT/)
    expect(fake.requests.at(-1)?.url).toBe(
      `${GITHUB_API}/gists/${first.id}/commits?per_page=30&page=1`,
    )
    expect(await api.listCommits(first.id, 2)).toStrictEqual([])
    expect(fake.requests.at(-1)?.url).toContain('per_page=30&page=2')
  })

  it('asks for one commit to learn the latest SHA, null when there is none', async () => {
    const api = setup()
    const gist = fake.seedGist({ 'a.txt': 'a' })
    expect(await api.latestCommitSha(gist.id)).toBe(gist.history[0]?.sha)
    expect(fake.requests.at(-1)?.url).toBe(`${GITHUB_API}/gists/${gist.id}/commits?per_page=1`)
    const empty = createGistApi(FAKE_TOKEN, {
      fetch: () => Promise.resolve(new Response('[]', { status: 200 })),
    })
    expect(await empty.latestCommitSha(gist.id)).toBeNull()
  })

  it('validates ids, SHAs and pages before requesting', async () => {
    const api = setup()
    const gist = await api.createGist('d', { 'a.txt': 'a' })
    const before = fake.requests.length
    for (const bad of ['', '../user', 'abc/def', 'a b', 'x'.repeat(65), 'abc?x=1', 'abc#']) {
      await githubError(api.getGist(bad))
      await githubError(api.latestCommitSha(bad))
      await githubError(api.updateGist(bad, { 'a.txt': 'b' }))
    }
    for (const bad of ['', 'xyz', '../commits', 'a'.repeat(65), 'abc def']) {
      await githubError(api.getRevision(gist.id, bad))
    }
    await expect(api.listCommits(gist.id, 0)).rejects.toThrow(RangeError)
    await expect(api.listCommits(gist.id, 1.5)).rejects.toThrow(RangeError)
    expect(fake.requests.length).toBe(before)
    // Legacy numeric ids and upper-case SHAs are requested (the fake has neither).
    await githubError(api.getGist('12345'))
    await githubError(api.getRevision(gist.id, (gist.latestSha ?? '').toUpperCase()))
    expect(fake.requests.length).toBe(before + 2)
  })

  it('lists gists across pages until a short page', async () => {
    const api = setup()
    for (let i = 0; i < 250; i++) fake.seedGist({ [i % 2 ? 'vtt-manifest.json' : 'x.txt']: 'x' })
    const gists = await api.listGists()
    expect(gists).toHaveLength(250)
    expect(new Set(gists.map((g) => g.id)).size).toBe(250)
    expect(fake.requests.map((r) => r.url)).toStrictEqual([
      `${GITHUB_API}/gists?per_page=100&page=1`,
      `${GITHUB_API}/gists?per_page=100&page=2`,
      `${GITHUB_API}/gists?per_page=100&page=3`,
    ])
    const summary = gists.find((g) => g.filenames.includes('vtt-manifest.json'))
    expect(summary?.htmlUrl).toMatch(/^https:\/\/gist\.github\.com\//)
    expect(summary?.updatedAt).toMatch(/^\d{4}-/)
  })

  it('asks for one more page after a full last page, and stops at ten pages', async () => {
    const api = setup()
    for (let i = 0; i < 200; i++) fake.seedGist({ 'a.txt': 'a' })
    expect(await api.listGists()).toHaveLength(200)
    expect(fake.requests).toHaveLength(3)
    for (let i = 0; i < 900; i++) fake.seedGist({ 'a.txt': 'a' })
    fake.requests.length = 0
    expect(await api.listGists()).toHaveLength(1000)
    expect(fake.requests).toHaveLength(10)
  })
})

describe('raw files', () => {
  it('fetches raw URLs with a bare fetch: no init, no headers, no token', async () => {
    const api = setup({ truncateOver: 10 })
    const content = 'x'.repeat(50)
    const gist = await api.createGist('d', { 'big.txt': content })
    const file = gist.files['big.txt']
    expect(file?.truncated).toBe(true)
    expect(file?.content).toBe('x'.repeat(10))
    expect(await api.fetchRaw(file?.rawUrl ?? '')).toBe(content)
    const raw = fake.requests.at(-1)
    expect(raw?.url).toBe(file?.rawUrl)
    expect(raw?.argCount).toBe(1)
    expect(raw?.headers).toStrictEqual({})
    expect(raw?.cache).toBeUndefined()
  })

  it('refuses addresses outside gist.githubusercontent.com', async () => {
    const api = setup()
    for (const url of [
      'http://gist.githubusercontent.com/u/1/raw/a/b',
      'https://api.github.com/gists',
      'https://gist.githubusercontent.com.evil.example/u/raw',
      'https://gist.githubusercontent.com@evil.example/u/raw',
      'https://gist.githubusercontent.com:8443/u/raw',
      'https://evil.example/https://gist.githubusercontent.com/',
      'gist.githubusercontent.com/u/raw',
      '',
    ]) {
      await expect(api.fetchRaw(url)).rejects.toThrow(/unexpected address/)
    }
    expect(fake.requests).toHaveLength(0)
  })

  it('retries a raw download once, then reports the HTTP status', async () => {
    const api = setup()
    const gist = await api.createGist('d', { 'a.txt': 'abc' })
    const url = gist.files['a.txt']?.rawUrl ?? ''
    fake.fail({ network: true })
    expect(await api.fetchRaw(url)).toBe('abc')
    fake.fail({ status: 502 }, { status: 502 })
    const error = await githubError(api.fetchRaw(url))
    expect(error.status).toBe(502)
    const missing = await githubError(api.fetchRaw(url.replace('a.txt', 'nope.txt')))
    expect(missing.status).toBe(404)
  })
})

describe('errors', () => {
  it('explains a rejected token, without the token', async () => {
    fake = createFakeGitHub()
    const api = createGistApi('ghp_wrongTokenValue123', { fetch: fake.fetch })
    const error = await githubError(api.getUser())
    expect(error.status).toBe(401)
    expect(error.message).toBe('The GitHub token was rejected (expired or revoked?)')
    expect(exposed(error)).not.toContain('ghp_wrongTokenValue123')
    expect(fake.requests[0]?.url).not.toContain('ghp_wrongTokenValue123')
  })

  it('explains a missing gist', async () => {
    const api = setup()
    const error = await githubError(api.getGist('0123456789abcdef'))
    expect(error.status).toBe(404)
    expect(error.message).toBe('Gist not found (or the token cannot see it)')
  })

  it("uses GitHub's message, with the token redacted if GitHub echoed it", async () => {
    const api = setup()
    fake.fail({ status: 422, message: `Validation Failed for ${FAKE_TOKEN}` })
    const error = await githubError(api.createGist('d', { 'a.txt': 'a' }))
    expect(error.status).toBe(422)
    expect(error.message).toBe('Validation Failed for [token]')
    expect(exposed(error)).not.toContain(FAKE_TOKEN)
    fake.fail({ status: 403, message: 'Resource not accessible by personal access token' })
    const forbidden = await githubError(api.getUser())
    expect(forbidden.message).toBe('Resource not accessible by personal access token')
    expect(forbidden.rateLimit).toBeNull()
    expect(sleeps).toStrictEqual([])
  })

  it('reports network failures as status 0, without the request details', async () => {
    const api = setup()
    fake.fail({ network: true }, { network: true })
    const error = await githubError(api.getUser())
    expect(error.status).toBe(0)
    expect(error.message).toMatch(/Could not reach GitHub/)
    expect(exposed(error)).not.toContain(FAKE_TOKEN)
    expect(error.cause).toBeUndefined()
  })

  it('reports the rate limit from the headers', async () => {
    const api = setup({ maxRetries: 0 })
    fake.fail({
      status: 429,
      message: 'API rate limit exceeded',
      headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1800000000' },
    })
    const error = await githubError(api.getUser())
    expect(error.status).toBe(429)
    expect(error.message).toBe('API rate limit exceeded')
    expect(error.rateLimit).toStrictEqual({ remaining: 0, resetAt: 1_800_000_000_000 })
  })

  it('treats an unparseable success as an unexpected response', async () => {
    fake = createFakeGitHub()
    const api = createGistApi(FAKE_TOKEN, {
      fetch: () => Promise.resolve(new Response('<html>', { status: 200 })),
    })
    const error = await githubError(api.getUser())
    expect(error.message).toBe('GitHub sent an unexpected response.')
    const wrongShape = createGistApi(FAKE_TOKEN, {
      fetch: () => Promise.resolve(new Response('{"nope":1}', { status: 200 })),
    })
    await githubError(wrongShape.getGist('abc'))
    await githubError(wrongShape.latestCommitSha('abc'))
  })
})

describe('retries', () => {
  it('waits retry-after seconds after a 403', async () => {
    const api = setup()
    fake.fail({ status: 403, headers: { 'retry-after': '1' }, message: 'slow down' })
    expect(await api.getUser()).toStrictEqual({ login: FAKE_LOGIN })
    expect(sleeps).toStrictEqual([1000])
    expect(fake.requests).toHaveLength(2)
  })

  it('backs off exponentially after a 429 or a secondary rate limit without headers', async () => {
    const api = setup()
    fake.fail(
      { status: 429 },
      { status: 403, message: 'You have exceeded a secondary rate limit. Please wait.' },
      { status: 429 },
    )
    const gist = await api.createGist('d', { 'a.txt': 'a' })
    expect(gist.files['a.txt']?.content).toBe('a')
    expect(sleeps).toStrictEqual([1000, 2000, 4000])
    // The rejected POSTs created nothing.
    expect(fake.gists.size).toBe(1)
  })

  it('waits until x-ratelimit-reset (plus a margin) when the limit is used up', async () => {
    const api = setup()
    const reset = Math.ceil(Date.now() / 1000) + 5
    fake.fail({
      status: 403,
      headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(reset) },
    })
    await api.getUser()
    expect(sleeps).toHaveLength(1)
    expect(sleeps[0]).toBeGreaterThan(4000)
    expect(sleeps[0]).toBeLessThanOrEqual(7000)
  })

  it('fails at once when the wait is longer than a minute', async () => {
    const api = setup()
    const reset = Math.ceil(Date.now() / 1000) + 3600
    fake.fail({
      status: 403,
      headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(reset) },
    })
    const error = await githubError(api.getUser())
    expect(error.status).toBe(403)
    expect(error.message).toBe('GitHub rate limit reached. Try again later.')
    expect(error.rateLimit).toStrictEqual({ remaining: 0, resetAt: reset * 1000 })
    expect(sleeps).toStrictEqual([])
    fake.fail({ status: 429, headers: { 'retry-after': '61' } })
    await githubError(api.getUser())
    expect(sleeps).toStrictEqual([])
    fake.fail({ status: 429, headers: { 'retry-after': '60' } })
    await api.getUser()
    expect(sleeps).toStrictEqual([60_000])
  })

  it('gives up after maxRetries', async () => {
    const api = setup({ maxRetries: 2 })
    fake.fail({ status: 429 }, { status: 429 }, { status: 429 })
    const error = await githubError(api.getUser())
    expect(error.status).toBe(429)
    expect(sleeps).toStrictEqual([1000, 2000])
    expect(fake.requests).toHaveLength(3)
  })

  it('retries a GET once after a 5xx or a network error', async () => {
    const api = setup()
    fake.fail({ status: 502 })
    await api.getUser()
    fake.fail({ network: true })
    await api.getUser()
    expect(sleeps).toStrictEqual([1000, 1000])
    expect(fake.requests).toHaveLength(4)
    fake.fail({ status: 500 }, { status: 503, message: 'Unavailable' })
    const error = await githubError(api.getUser())
    expect(error.status).toBe(503)
    expect(error.message).toBe('Unavailable')
    // One transient retry per call, even when the failures differ.
    fake.fail({ network: true }, { status: 500 })
    await githubError(api.getUser())
  })

  it('never retries a PATCH or POST after a 5xx or a network error', async () => {
    const api = setup()
    const gist = await api.createGist('d', { 'a.txt': 'a' })
    const before = fake.requests.length
    fake.fail({ status: 500 })
    expect((await githubError(api.updateGist(gist.id, { 'a.txt': 'b' }))).status).toBe(500)
    fake.fail({ network: true })
    expect((await githubError(api.updateGist(gist.id, { 'a.txt': 'b' }))).status).toBe(0)
    fake.fail({ status: 502 })
    await githubError(api.createGist('d', { 'a.txt': 'a' }))
    expect(fake.requests.length).toBe(before + 3)
    expect(sleeps).toStrictEqual([])
    expect(fake.latestFiles(gist.id)).toStrictEqual({ 'a.txt': 'a' })
  })

  it('retries rate-limited PATCHes (GitHub did not apply them)', async () => {
    const api = setup()
    const gist = await api.createGist('d', { 'a.txt': 'a' })
    fake.fail({ status: 403, headers: { 'retry-after': '2' } })
    await api.updateGist(gist.id, { 'a.txt': 'b' })
    expect(sleeps).toStrictEqual([2000])
    expect(fake.latestFiles(gist.id)).toStrictEqual({ 'a.txt': 'b' })
  })
})
