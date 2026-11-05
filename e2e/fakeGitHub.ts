import type { BrowserContext, Route } from '@playwright/test'

/**
 * A tiny in-memory GitHub for the e2e tests: the gist endpoints the app uses,
 * with GitHub's real response shapes. Browser requests to api.github.com and
 * gist.githubusercontent.com are routed here, so nothing leaves the machine.
 * Several browser contexts can share one fake (two "computers").
 */

export const TEST_TOKEN = 'github_pat_TESTTOKEN0123456789'
export const TEST_LOGIN = 'dm-test'

interface Commit {
  sha: string
  at: string
  files: Record<string, string>
}

interface FakeGist {
  id: string
  description: string
  public: boolean
  history: Commit[] // newest first
}

export interface FakeGitHub {
  gists: Map<string, FakeGist>
  /** Every request seen: method, URL, whether it carried an Authorization header. */
  requests: { method: string; url: string; auth: string | null }[]
  install(context: BrowserContext): Promise<void>
}

function hex(length: number): string {
  let out = ''
  while (out.length < length) out += Math.floor(Math.random() * 16).toString(16)
  return out
}

function filesOf(gist: FakeGist, sha?: string): Record<string, string> | null {
  const commit = sha ? gist.history.find((c) => c.sha === sha) : gist.history[0]
  return commit ? commit.files : null
}

function gistJson(gist: FakeGist, sha?: string) {
  const files = filesOf(gist, sha) ?? {}
  const version = sha ?? gist.history[0]?.sha ?? null
  return {
    id: gist.id,
    description: gist.description,
    public: gist.public,
    html_url: `https://gist.github.com/${TEST_LOGIN}/${gist.id}`,
    updated_at: gist.history[0]?.at ?? new Date().toISOString(),
    truncated: false,
    files: Object.fromEntries(
      Object.entries(files).map(([name, content]) => [
        name,
        {
          filename: name,
          size: content.length,
          truncated: false,
          content,
          raw_url: `https://gist.githubusercontent.com/${TEST_LOGIN}/${gist.id}/raw/${version}/${name}`,
        },
      ]),
    ),
    history: gist.history.map((c) => ({ version: c.sha, committed_at: c.at })),
  }
}

function json(route: Route, status: number, body: unknown) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    headers: { 'access-control-allow-origin': '*' },
    body: JSON.stringify(body),
  })
}

export function createFakeGitHub(): FakeGitHub {
  const gists = new Map<string, FakeGist>()
  const requests: FakeGitHub['requests'] = []

  async function api(route: Route): Promise<void> {
    const request = route.request()
    const url = new URL(request.url())
    const auth = request.headers()['authorization'] ?? null
    requests.push({ method: request.method(), url: request.url(), auth })
    if (request.method() === 'OPTIONS') {
      await route.fulfill({
        status: 204,
        headers: {
          'access-control-allow-origin': '*',
          'access-control-allow-headers': '*',
          'access-control-allow-methods': 'GET, POST, PATCH, DELETE',
        },
      })
      return
    }
    if (auth !== `Bearer ${TEST_TOKEN}`) {
      await json(route, 401, { message: 'Bad credentials' })
      return
    }
    const parts = url.pathname.split('/').filter(Boolean)
    const method = request.method()
    if (parts[0] === 'user' && method === 'GET') {
      await json(route, 200, { login: TEST_LOGIN })
      return
    }
    if (parts[0] !== 'gists') {
      await json(route, 404, { message: 'Not Found' })
      return
    }
    const id = parts[1]
    if (!id) {
      if (method === 'GET') {
        const page = Number(url.searchParams.get('page') ?? '1')
        const list = page > 1 ? [] : [...gists.values()].map((g) => gistJson(g))
        await json(route, 200, list)
        return
      }
      if (method === 'POST') {
        const body = request.postDataJSON() as {
          description: string
          public: boolean
          files: Record<string, { content: string }>
        }
        const gist: FakeGist = {
          id: hex(32),
          description: body.description,
          public: body.public,
          history: [
            {
              sha: hex(40),
              at: new Date().toISOString(),
              files: Object.fromEntries(Object.entries(body.files).map(([n, f]) => [n, f.content])),
            },
          ],
        }
        gists.set(gist.id, gist)
        await json(route, 201, gistJson(gist))
        return
      }
    }
    const gist = id ? gists.get(id) : undefined
    if (!gist) {
      await json(route, 404, { message: 'Not Found' })
      return
    }
    if (parts[2] === 'commits' && method === 'GET') {
      const perPage = Number(url.searchParams.get('per_page') ?? '30')
      const page = Number(url.searchParams.get('page') ?? '1')
      const slice = gist.history.slice((page - 1) * perPage, page * perPage)
      await json(
        route,
        200,
        slice.map((c) => ({
          version: c.sha,
          committed_at: c.at,
          change_status: { total: Object.keys(c.files).length },
        })),
      )
      return
    }
    if (parts[2] && method === 'GET') {
      const files = filesOf(gist, parts[2])
      if (!files) await json(route, 404, { message: 'Not Found' })
      else await json(route, 200, gistJson(gist, parts[2]))
      return
    }
    if (method === 'GET') {
      await json(route, 200, gistJson(gist))
      return
    }
    if (method === 'PATCH') {
      const body = request.postDataJSON() as {
        description?: string
        files: Record<string, { content: string } | null>
      }
      const files = { ...filesOf(gist) }
      for (const [name, file] of Object.entries(body.files)) {
        if (file === null) delete files[name]
        else files[name] = file.content
      }
      if (body.description !== undefined) gist.description = body.description
      gist.history.unshift({ sha: hex(40), at: new Date().toISOString(), files })
      await json(route, 200, gistJson(gist))
      return
    }
    await json(route, 404, { message: 'Not Found' })
  }

  async function raw(route: Route): Promise<void> {
    const request = route.request()
    requests.push({
      method: request.method(),
      url: request.url(),
      auth: request.headers()['authorization'] ?? null,
    })
    const [, , id, , sha, name] = new URL(request.url()).pathname.split('/')
    const gist = id ? gists.get(id) : undefined
    const content = gist && sha && name ? filesOf(gist, sha)?.[name] : undefined
    await route.fulfill({
      status: content === undefined ? 404 : 200,
      headers: { 'access-control-allow-origin': '*' },
      contentType: 'text/plain',
      body: content ?? 'Not Found',
    })
  }

  return {
    gists,
    requests,
    async install(context) {
      await context.route('https://api.github.com/**', api)
      await context.route('https://gist.githubusercontent.com/**', raw)
    },
  }
}
