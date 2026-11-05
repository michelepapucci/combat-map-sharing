# Combat Map

A lightweight virtual tabletop for running D&D 5e combat at the table, used by the DM alone. Think "Owlbear Rodeo, but single-user and much simpler". Players never connect: they look at a second browser window that the DM puts on a TV, a projector or a screen share.

- The **DM window** (`#/dm`) is the full editor: maps, tokens, fog of war, initiative, the ruler and area-of-effect templates.
- The **player window** (`#/player`) is a presentation view with no controls. It only ever receives what the players are allowed to see, so hidden things are never just hidden from view.

It is a static site with no backend and no accounts. Campaigns live in the DM's browser (IndexedDB). They can be backed up to a `.zip` file, or synced to one of the DM's GitHub Gists to open them on another computer.

**Live:** <https://michelepapucci.github.io/combat-map-sharing/>

## Using it

### Before the session

1. **Map.** Pick a default map, or drop your own image (PNG, JPEG or WebP) on the map. If the image has a grid drawn on it, open the **Scene** panel and use **Calibrate to the map's grid**: drag a box over one square, or over several squares for accuracy.
2. **Tokens and props.** Click one in the **Library** to place it in the middle of the view, or drag it onto the map. Upload your own token art there too.
   - Select a token to edit it in **Properties**: its label for players, vision radius, hit points (with an optional HP bar for players), conditions and DM notes.
   - New player tokens see 18 m (60 ft) in the fog. Enemies never reveal fog.
3. **Fog of war.** Turn it on in the **Scene** panel. Players see what their tokens see, and explored ground stays dimmed. To reveal or hide areas by hand, use the **Fog tool** (F) with a rectangle, polygon or brush.
4. **Units.** Settings switch between metric (1 square = 1.5 m, the default) and imperial (5 ft).

The side panels are cards. Collapse them, or pop one out (or drag its header) to float it anywhere over the map, for example the initiative tracker during combat.

### At the table

- **Open player window** and move it to the TV (F11 for full screen). The **Player view** panel chooses what it shows:
  - **Pushed view** (the default): the area you push with "Push my view to players".
  - **Follow my view**: whatever the DM window shows.
  - **Fit explored area**: what the players have seen.
- **Blackout** shows a black screen, or an image you pick, while you set up the next scene.
- **Preview as players** shows, in the DM window, exactly what the players' screen shows.
- **Initiative.**
  - Add selected tokens, roll d20 + modifier for the selected NPCs and enemies, or add creatures by name.
  - **N** moves to the next turn, **Shift+N** back. The active token pulses in both windows.
  - **Show tracker to players** puts the names (never the values) on the TV. Hidden creatures stay out of it.
- **Ruler** (M): drag from a square; hold Shift as you release to add a waypoint. "Players see the ruler" shares it.
- **Areas of effect** (A): sphere, cylinder, cone, line or cube. Drag from the origin. You see which squares and tokens it hits; Enter pins it.
- **Ping** (P, or Alt+click with any tool) shows a ripple on both screens.

Press **?** in the DM window for every keyboard shortcut. The getting-started tour can be shown again from there.

### Keeping campaigns safe

Campaigns save automatically in this browser. Clearing the browser's site data deletes them, so keep a copy.

- **Backup** (the campaign name at the top → **Export**): a `.zip` with the campaign and all its images. **Import a backup…** brings it back, on any computer.
- **GitHub Gist sync** (**Settings → Sync with a GitHub Gist**):
  1. Create a GitHub token. The best choice is a [fine-grained token](https://github.com/settings/personal-access-tokens/new) with only the account permission "Gists: read and write" and an expiry date. A [classic token](https://github.com/settings/tokens/new?scopes=gist&description=Combat%20Map) with only the `gist` scope also works.
  2. Paste it and connect. "Remember the token on this device" keeps it in this browser.
  3. **Create a secret gist** for the campaign. Ctrl+S then saves to it. It also saves automatically every 2 minutes, and on scene switches, when something changed.
  4. On another computer, connect the same way and open the gist by its address.

  If the gist was changed elsewhere, you choose: overwrite it, load it, or keep a copy and then load it. **Restore an earlier version…** brings back any past save.

  Images larger than about 7 MB cannot go in a gist: they stay on the computer that uploaded them, and in backups.

## Privacy and security

- The app makes **no network requests** except to the GitHub API (and gist file addresses) for Gist sync, and only once you connect a token. Production builds ship a Content-Security-Policy that enforces this.
- The token is only ever sent to `api.github.com`, in a request header. It never goes in a URL, the gist, a backup or the campaign data.
- Gists created by the app are **secret, which means unlisted, not private**: anyone who has the link can read them. Don't share the gist link, and keep anything truly sensitive out of DM notes.
- All GitHub Pages project sites of an account share one origin (`https://<user>.github.io`), so other sites published there can read this app's browser storage, including a remembered token. Use a token that can only reach gists, with an expiry date, or host the app on a custom domain.

## Development

Requirements: Node.js 24 (see [`.nvmrc`](.nvmrc)) and npm.

```sh
npm ci
npm run dev
```

Then open <http://localhost:5173/combat-map-sharing/>. Use `localhost` or https: the app needs a secure context, so it won't start from a LAN address over plain http. The dev server uses the same `/combat-map-sharing/` base path as the deployed site.

| Command             | What it does                                                                  |
| ------------------- | ----------------------------------------------------------------------------- |
| `npm run dev`       | Vite dev server with hot reload                                               |
| `npm run build`     | Type-check, then build the static site into `dist/`                           |
| `npm run preview`   | Serve the production build from `dist/`                                       |
| `npm run typecheck` | TypeScript (strict) across app, config and e2e code                           |
| `npm run lint`      | oxlint (React hooks, accessibility, imports, Vitest rules); warnings fail     |
| `npm run format`    | Format everything with Prettier (`format:check` only verifies)                |
| `npm test`          | Vitest unit tests (`npm run test:watch` for watch mode)                       |
| `npm run test:e2e`  | Playwright tests against a fresh production build (and the dev server)        |
| `npm run bench`     | Panning benchmark: an 8k map with 50 tokens, with and without a player window |
| `npm run check`     | typecheck + lint + format check + unit tests                                  |

The first time you run the end-to-end tests, install the browser with `npx playwright install chromium`. The tests use an in-memory stand-in for GitHub, so they never touch the network.

[`CLAUDE.md`](CLAUDE.md) describes the architecture, the data model, the rule that keeps hidden data out of the player window, and every design decision. [`docs/SPEC.md`](docs/SPEC.md) is the original product spec.

## Deploying to GitHub Pages

The workflow in [`.github/workflows/pages.yml`](.github/workflows/pages.yml) runs the checks and tests on pushes to `master` and to milestone branches, on pull requests and on manual runs. Only `master` builds the site and deploys it.

One-time setup:

1. Push the repository to GitHub.
2. Open the repository's **Settings → Pages**.
3. Under **Build and deployment → Source**, choose **GitHub Actions**.
4. Push to `master` (or run **Actions → CI and Pages → Run workflow** on `master`).

The site will be at `https://<your-user>.github.io/<repo-name>/`. The deploy job prints the URL in the workflow summary.

GitHub Pages serves a project site under `/<repo-name>/`, so Vite's `base` has to match. In CI the workflow reads the exact path from `actions/configure-pages` and passes it in the `BASE_PATH` environment variable; this also covers user sites and custom domains. Locally, `BASE_PATH` defaults to `/combat-map-sharing/`. If you fork or rename the repository, change `DEFAULT_BASE` in [`vite.config.ts`](vite.config.ts) or run with `BASE_PATH=/your-repo/ npm run dev`.

Routing uses the URL hash (`#/dm`, `#/player`), so links work on GitHub Pages without server rewrites.
