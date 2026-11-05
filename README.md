# Combat Map

A lightweight, DM-only virtual tabletop for running D&D 5e combat at the table. Think "Owlbear Rodeo, but single-user and much simpler":

- the **DM window** (`#/dm`) is the full editor: maps, tokens, fog of war, initiative, rulers and area templates;
- the **player window** (`#/player`) is a chrome-free presentation view that the DM puts on a TV, projector or screen-share. It only ever receives what the players are allowed to see.

It is a static site with no backend and no accounts. Everything lives in the DM's browser (IndexedDB). Campaigns can optionally be synced to a GitHub Gist so they can be reopened on another computer.

> **Status:** under construction, built milestone by milestone. See [`CLAUDE.md`](CLAUDE.md) for the current milestone, the architecture and the design decisions, and [`docs/SPEC.md`](docs/SPEC.md) for the full product spec.

## Running it locally

Requirements: Node.js 24 (see [`.nvmrc`](.nvmrc)) and npm.

```sh
npm ci
npm run dev
```

Then open <http://localhost:5173/combat-map-sharing/>. It redirects to the DM view; the **Open player window** button opens the presentation window. Use `localhost` (or https): the app needs a secure context, so it won't start from a LAN address over plain http.

The dev server uses the same `/combat-map-sharing/` base path as the deployed site, so links and assets behave the same locally and on GitHub Pages.

### Scripts

| Command             | What it does                                                   |
| ------------------- | -------------------------------------------------------------- |
| `npm run dev`       | Vite dev server with hot reload                                |
| `npm run build`     | Type-check, then build the static site into `dist/`            |
| `npm run preview`   | Serve the production build from `dist/`                        |
| `npm run typecheck` | TypeScript (strict) across app, config and e2e code            |
| `npm run lint`      | oxlint (React hooks, accessibility, imports, Vitest rules)     |
| `npm run format`    | Format everything with Prettier (`format:check` only verifies) |
| `npm test`          | Vitest unit tests (`npm run test:watch` for watch mode)        |
| `npm run test:e2e`  | Playwright smoke tests against a production build              |
| `npm run check`     | typecheck + lint + format check + unit tests                   |

The first time you run the end-to-end tests, install the browser with `npx playwright install chromium`. They always build a fresh `dist/` and serve it on port 4179, so a running `npm run preview` doesn't interfere.

## Deploying to GitHub Pages

The workflow in [`.github/workflows/pages.yml`](.github/workflows/pages.yml) runs the checks and tests on pushes to `master` and to milestone branches (`m<N>-<slug>`), on pull requests and on manual runs. Only `master` builds the site and deploys it to GitHub Pages.

One-time setup:

1. Push the repository to GitHub.
2. Open the repository's **Settings → Pages**.
3. Under **Build and deployment → Source**, choose **GitHub Actions**.
4. Push to `master` (or, once the workflow file is on `master`, use **Actions → CI and Pages → Run workflow** with branch `master`).

The site will be at `https://<your-user>.github.io/<repo-name>/`; for this repository, <https://michelepapucci.github.io/combat-map-sharing/>. The deploy job prints the URL in the workflow summary.

### Base path

GitHub Pages serves a project site under `/<repo-name>/`, so Vite's `base` has to match. In CI the workflow reads the exact path from `actions/configure-pages` and passes it in the `BASE_PATH` environment variable, which also covers user sites (`<user>.github.io`) and custom domains (`/`). Locally, `BASE_PATH` defaults to `/combat-map-sharing/`. If you fork or rename the repository, either change `DEFAULT_BASE` in [`vite.config.ts`](vite.config.ts) or run with `BASE_PATH=/your-repo/ npm run dev`.

Routing uses the URL hash (`#/dm`, `#/player`), so deep links work on GitHub Pages without any server rewrites.

## Privacy and network use

- The app makes **no network requests** other than the GitHub API (and gist file URLs) for the optional Gist sync. Production builds ship a Content-Security-Policy that enforces this.
- Campaign data stays in your browser unless you set up Gist sync. Gists created by the app are **secret, which means unlisted, not private**: anyone who has the link can read them, so don't share the gist URL or keep anything truly sensitive in DM notes.
- All GitHub Pages project sites of an account share one origin (`https://<user>.github.io`), so other sites published there can read this app's browser storage. When Gist sync arrives, use a fine-grained token limited to Gists with an expiry date, or host the app on its own custom domain.
