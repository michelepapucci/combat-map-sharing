# Build: a simple, DM-only virtual tabletop (static site, GitHub Pages)

> This is the original product spec, kept verbatim as the reference for all milestones.
> Implementation decisions that refine or deviate from it are recorded in `CLAUDE.md` → "Decisions".

You are building a lightweight virtual tabletop for running D&D 5e combat. Think "Owlbear Rodeo, but single-user and much simpler." Only the DM uses the app. Players never connect; they look at a second browser window that the DM shares on a TV, projector or screen-share.

Read this whole document before writing code. Work in the milestones at the end, commit after each one, and stop at the end of each milestone so I can test it.

---

## 1. Hard constraints

- **Pure static site**, deployable to **GitHub Pages**. No backend and no app accounts. The only runtime network calls are to the GitHub API for Gist sync (§7), and only when the DM has configured it.
- **Single user.** All state lives in the DM's browser.
- **Two windows, same origin:**
  - **DM window**: the full editor with all tools.
  - **Player window** (presentation mode): only the map, the visible tokens, the fog, and whatever the DM chooses to show.
- **Campaign state syncs to a GitHub Gist** (see §7), so it can be reopened on another machine.
- No walls, line of sight, collision or dynamic lighting. Vision is radius-based only.
- Bundle only original or generated default assets (simple SVGs). No copyrighted art.

## 2. Tech stack

- Vite + React + TypeScript (strict)
- `react-konva` / Konva for the canvas
- Zustand for state, with Immer if it helps; undo/redo via patches or snapshots
- `idb` for IndexedDB
- Plain `fetch` against the GitHub REST API for Gist sync (or `@octokit/rest` if it keeps things cleaner)
- `fflate` for zipping local backup bundles
- Vitest for unit tests and Playwright for a few end-to-end smoke tests
- Tailwind (or plain CSS modules) with a dark theme by default; it's used in dim rooms

**GitHub Pages specifics:**
- Set Vite `base` from an env var, defaulting to `/<repo-name>/`.
- Use hash routing (`#/dm`, `#/player`) so deep links work without server rewrites.
- Add a GitHub Actions workflow that builds and deploys to Pages on push to `main`.
- Write a README section explaining how to enable Pages (Settings → Pages → Source: GitHub Actions).

## 3. Architecture (important)

- **Single source of truth:** the DM window owns the full `CampaignState`.
- **Player view = pure projection:** a function `projectForPlayers(state): PlayerViewState` removes everything players must not see:
  - hidden tokens
  - hidden props
  - hidden initiative entries
  - DM notes
  - HP values unless marked public
  - measurements unless "share ruler" is on

  Unit-test this function heavily. It is the main security boundary against spoilers.
- **Sync:** the DM window broadcasts the projected state over `BroadcastChannel('vtt-sync')`.
  - Send the full projection on connect, then diffs or throttled full snapshots (rAF/50 ms) while dragging.
  - The player window asks for a resync on load.
  - The player window never writes state.
- **Images** are not sent over the channel each time. Both windows read asset blobs from the same IndexedDB by `assetId`, and the channel only carries IDs.
- The player window must never receive data it shouldn't render. Don't send everything and hide it with CSS.

## 4. Data model (starting point; refine as needed)

```ts
type Id = string;

interface CampaignState {
  version: number;
  scenes: Scene[];
  activeSceneId: Id;
  library: AssetMeta[];            // blobs live in IndexedDB keyed by id
  settings: Settings;
}

interface Scene {
  id: Id; name: string;
  grid: { size: number; offsetX: number; offsetY: number; feetPerCell: number;
          visible: boolean; color: string; opacity: number; type: 'square' };
  layers: { map: Item[]; props: Item[]; tokens: Token[]; };
  fog: { enabled: boolean; exploredEnabled: boolean; explored: FogMask; manual: FogEdit[] };
  initiative: Initiative;
  playerCamera: Camera;             // what the player window shows
  pings: Ping[];                    // transient
}

interface Item {
  id: Id; assetId: Id; name: string;
  x: number; y: number; width: number; height: number; rotation: number;
  locked: boolean; hidden: boolean; opacity: number;
}

interface Token extends Item {
  kind: 'player' | 'npc' | 'enemy';
  sizeCategory: 'tiny'|'small'|'medium'|'large'|'huge'|'gargantuan';
  visionFt?: number;                // players (and optionally allies) only
  label?: string; showLabel: boolean;
  hp?: { current: number; max: number; publicBar: boolean };
  conditions: string[];             // standard 5e conditions + custom
  color: string;                    // ring color
  dmNotes?: string;
}

interface Initiative {
  entries: { id: Id; tokenId?: Id; name: string; value: number; dexTiebreak?: number;
             hidden: boolean }[];
  currentIndex: number; round: number;
  visibleToPlayers: boolean;
}
```

## 5. Features

### 5.1 Canvas, grid and snapping
- Infinite pan/zoom canvas.
  - Zoom toward the cursor with the wheel.
  - Pan with middle mouse, space+drag, or right-drag on empty space.
- Square grid with configurable size, color, opacity and feet per cell (default 5 ft).
- **Grid calibration tool** to align the grid to a map image that already has a grid drawn on it:
  - The DM drags a box over 1 cell, or over N×N cells for accuracy, and the app sets the grid size and offset.
  - Also provide numeric inputs.
- **Magnetic snapping:**
  - Tokens snap their footprint to cells according to size: Tiny/Small/Medium = 1 cell, Large = 2×2, Huge = 3×3, Gargantuan = 4×4.
  - Odd footprints snap to cell centers; even footprints snap to intersections.
  - Props snap position to grid corners and size to whole cells. The snap is "magnetic": it only engages within a threshold (~25% of a cell).
  - Hold **Alt** while dragging or resizing to disable snapping.
  - Global snap toggle in the toolbar.
- While dragging a token, show a **ghost at the origin** and a **movement path line with distance in feet** (using the diagonal rule from §5.4).

### 5.2 Asset library
- Side panel with tabs: **Tokens**, **Props**, **Maps**.
- **Built-in defaults**, all generated SVGs:
  - Tokens: colored circles with initials or simple glyphs, in several colors.
  - Props: tree, bush, rock, boulder, crate, barrel, table, chest, door, pillar, campfire, water tile, wall segment.
  - Plain textured map backgrounds: stone floor, grass, dirt.
- **Upload:** drag-and-drop or file picker for PNG, JPG and WebP.
  - Downscale images over 8192 px on the long side, with a notice.
  - Store blobs in IndexedDB.
  - Name, tags, and default size in cells (for tokens: size category).
- Library search by name and tag. Delete or rename assets. Warn if an asset is in use before deleting it.
- Drag an asset from the library onto the canvas to place it. Maps go to the map layer at native size, then the DM calibrates the grid.

### 5.3 Selection and editing (standard editor UX)
- Click to select, Shift-click to add to the selection, marquee drag on empty space (with the Select tool) to select multiple items.
- Konva Transformer for resize and rotate.
  - Shift keeps the aspect ratio while resizing.
  - Shift snaps rotation to 15° steps.
- **Layers:** map (bottom) → props → tokens (top).
  - Per-layer lock and visibility toggles in a small layers panel.
  - The map layer is locked by default so you don't drag it by accident.
  - Bring forward / send backward within a layer.
- **Keyboard shortcuts** (show a cheat sheet with `?`):

  | Key | Action |
  |---|---|
  | Ctrl+Z / Ctrl+Shift+Z | Undo / redo |
  | Ctrl+C / V / D | Copy / paste / duplicate |
  | Del | Delete |
  | Arrows | Nudge by 1 cell |
  | Shift+arrows | Nudge by 1 px |
  | H | Toggle hidden |
  | L | Lock |
  | Esc | Deselect / cancel tool |
  | V, M, A, F, P | Tools (select, measure, AoE, fog, ping) |

- Right-click **context menu** on items:
  - hide/show, lock, duplicate, delete, bring forward / send back
  - edit token (opens the properties panel)
  - add to initiative
- **Properties panel** for the selected token: name, label toggle, kind (player/npc/enemy), size category, vision ft, HP current/max with ± buttons, public HP bar toggle, conditions (chips), ring color, DM notes, hidden.
- **Auto-numbering:** placing or duplicating a token named "Goblin" creates "Goblin 1", "Goblin 2", etc.
- **Undo/redo** covers every state-changing action. Coalesce drags into a single entry.

### 5.4 Ruler
- Measure tool: click-drag from a point (snapped to cell centers by default; Alt for free measurement).
  - Shows a line plus distance in feet and cells.
  - Shift-click adds waypoints for multi-segment paths.
- **Diagonal rule setting:**
  - "5e standard (every square 5 ft)" (default)
  - "Alternating 5/10 ft (DMG variant)"
  - "Euclidean"
- "Share ruler with players" toggle. When on, the player window shows the live measurement.

### 5.5 Area-of-effect templates
- Shapes:
  - **circle/sphere** (radius)
  - **cone** (length; width at the far end equals the length; 53° angle)
  - **line** (length × width, default 5 ft wide)
  - **cube/square** (side)
  - **cylinder** (rendered as a circle)
- Placement: click the origin, drag to set size and direction.
  - Size snaps to 5 ft increments.
  - The origin snaps to grid intersections or cell centers depending on the shape (Alt for free placement).
  - Show the size in feet while dragging.
- **Affected-squares highlight**, with a setting:
  - "square counts if its center is inside" (default)
  - "square counts if ≥50% covered"

  Show a count of affected tokens and highlight them.
- Templates are either **temporary** (vanish when the tool changes) or **pinned** (persist, can be selected, moved and deleted).
- Each template has a color and a "visible to players" toggle (default on).

### 5.6 Fog of war (radius-based)
- Per scene: fog on/off.
- **Vision sources:** tokens with `kind: 'player'` and `visionFt > 0`. Optionally allow it on NPC allies too.
- **Currently visible area** = union of circles of radius `visionFt` around each vision source's center.
- **Explored memory** (toggleable per scene): areas seen before stay revealed, but are dimmed in the player view.
  - Store it as a low-res bitmap mask (e.g. 1 px per 1/4 cell), serialized compactly.
  - Include a "reset explored" button.
- **Reveal timing:** fog updates when a player token is dropped, not continuously during the drag. Also reveal along the straight-line path from origin to destination, so moving through a corridor reveals it. This avoids flashing glimpses while the DM is still deciding where to put the token.
- **Manual fog brushes** (Fog tool): reveal or hide using a rectangle, polygon or brush. These override automatic fog.
- **Rendering:**
  - **Player window:** opaque black outside the explored area, semi-dark over explored-but-not-visible areas, clear inside visible areas.
  - **DM window:** the same regions as a light tint so the DM can see everything, plus a toggle **"Preview as players"** that renders exactly the player projection.
- **Token visibility in the fog:** enemy and NPC tokens that are outside the currently visible area are not sent to the player window (even if not hidden), and neither are tokens in explored-but-dim areas. Props in explored areas stay visible.

### 5.7 Hidden things
- Any token or prop can be **hidden**. It renders semi-transparent with a "hidden" badge in the DM window, and it is never included in the player projection.
- Hidden tokens' initiative entries are hidden automatically. They can be unhidden separately.
- "Reveal" action with a short fade-in in the player window (nice touch).

### 5.8 Initiative tracker (DM panel)
- Add entries:
  - from selected tokens (bulk)
  - by name only
  - "roll for selected enemies": d20 + modifier, with an optional per-token initiative modifier field
- Sorted descending by value. Ties broken by dex tiebreak, then by manual drag-and-drop order. Values can be edited inline.
- Next/previous turn buttons (shortcut: `N` / `Shift+N`) and a round counter.
  - The active entry is highlighted.
  - Its token gets a pulsing ring on the canvas.
  - "Center on active" button.
- Per-entry hidden toggle, plus a global **"Show tracker to players"** toggle.
- **Player view of the tracker:** names only (no values or HP unless public), current turn highlighted. Hidden entries are omitted entirely, with no "???" placeholders.
- Clear / end combat (asks for confirmation).

### 5.9 Presentation mode (player window)
- An "Open player window" button runs `window.open('#/player')`.
- The player window has no UI chrome:
  - just the canvas
  - optional initiative overlay in a corner
  - a small "connecting…" state if no DM window is present

  Suggest F11 for fullscreen.
- **Camera control** with three modes:
  - **Follow DM camera:** the player view mirrors the DM view.
  - **Pushed view:** the DM frames a view, then clicks "Push view to players". This is the default.
  - **Fit to explored area:** auto-frames what the players have seen.

  The DM can also lock the player zoom to a fixed "1 cell = N px" so physical minis or a TV grid stay consistent.
- **Ping:** Ping tool or Alt+click shows an animated ripple at that point on both windows, for pointing at things.
- **Blackout / "scene transition":** a toggle that shows a black screen (or a chosen splash image) to players while the DM sets up.
- The player window renders at device pixel ratio and handles resize.

### 5.10 Scenes
- Multiple scenes per campaign: create, rename, duplicate, delete, reorder.
- Switching the active scene updates the player window. If blackout is on, the switch happens behind it.

## 6. Persistence

- **Autosave** to IndexedDB, debounced at about 1 s after changes. Show a "saved" indicator.
- On load, restore the last campaign automatically.
- Handle IndexedDB quota errors gracefully: show a clear message and suggest export or Gist sync.
- Schema `version` field with a migration function from day one.

## 7. Saving to a GitHub Gist

Goal: the campaign lives in one of the DM's own GitHub Gists, so it survives clearing the browser and can be reopened on another computer by opening the GitHub Pages site and connecting the same Gist.

### Authentication
- The DM pastes a GitHub **personal access token** in Settings → Sync. The UI explains how to create one:
  - classic token with only the `gist` scope, or
  - fine-grained token with the Gists account permission set to read/write, if GitHub offers it

  Link directly to the token-creation page.
- Validate the token with a test API call. Show the GitHub username it belongs to.
- Token storage: kept in IndexedDB only if "Remember token on this device" is checked (default on); otherwise kept in memory for the session only.
  - Provide a "Disconnect" button that clears the token.
  - Never put the token in URLs or logs, and never include it in the gist or in exports.
- Don't attempt the OAuth web or device flow. It needs a server, because GitHub's OAuth endpoints don't allow browser CORS. The PAT approach is intentional.

### Gist layout
- One gist per campaign, created as **secret** by default.
- The UI must state clearly that "secret" gists are **unlisted, not private**: anyone with the link can read them. So the gist URL/ID shouldn't be shared, and nothing truly sensitive should go in DM notes.
- Gist description: `VTT campaign: <name>`.
- Files:
  - `vtt-manifest.json`: app id, schema version, campaign name, `updatedAt`, list of assets with id/hash/size/mime/filename.
  - `campaign.json`: the full `CampaignState` minus blobs. Fog explored masks are stored compactly (run-length or base64 bitmap).
  - `asset-<id>.b64`: one file per **uploaded** asset, containing base64 image data. Built-in assets are not uploaded.
- Gists only take text files through the API, hence base64.
- When reading, files may be `truncated` in the API response. In that case fetch them via `raw_url`.
- Files over ~10 MB can't be fetched via the API at all, so:
  - re-encode large uploads to WebP at a sensible quality before syncing
  - refuse to sync any single asset still over ~8 MB after compression, with a clear message (that asset stays local-only and is flagged in the library)

### Sync behavior
- **Connect:** "Create new gist for this campaign", or "Open existing gist" (paste a gist URL or ID, or pick from a list of the DM's gists filtered by the `vtt-manifest.json` file).
- **Save:**
  - "Save to Gist" button with Ctrl+S.
  - Optional auto-sync every N minutes (default 2) plus on scene switch. Only push when state changed since the last push.
  - Upload asset files only when their content hash is not already in the remote manifest (diff by hash). Delete remote asset files no longer referenced.
- **Load:** pull the manifest, `campaign.json` and any missing assets into IndexedDB, then load the campaign.
- **Conflicts:** remember the gist's `updated_at` from the last pull/push.
  - On push, if the remote is newer than that (edited from another machine), stop and ask: overwrite remote, load remote, or save a local copy first.
  - Never silently overwrite.
- **Status indicator:** synced / unsynced changes / syncing / error (with the GitHub error message and rate-limit info if relevant).
- **Offline:** the app keeps working from IndexedDB autosave and syncs when the DM tries again.
- Revision history comes for free: gists are git-backed. Add a "Restore an earlier version" dialog that lists the gist's history and can load a past revision.

### Local backup (still useful)
- "Export backup" produces a `.zip` (fflate) with `campaign.json` and all assets. "Import backup" restores it. This is the fallback for when there's no network or assets are too big for the gist.

## 8. UX polish checklist

- Dark theme by default; light theme toggle.
- Toolbar on the left with tool icons and tooltips that include shortcuts. Library and properties panels on the right; initiative as a collapsible panel.
- Empty-state onboarding on first run: "Drop a map image here or pick a default map", plus a 4-step hint overlay (dismissible).
- Cursor changes per tool. Hover highlight on items. Selection outline in an accent color.
- Toasts for saves, imports, errors and "player window connected/disconnected".
- Confirmation dialogs for destructive actions only (delete scene, clear initiative, reset explored fog).
- Performance targets:
  - 60 fps panning with an 8k map plus 50 tokens
  - use Konva layer caching for the static map layer
  - throttle broadcasts
- Accessibility basics: focusable panels, labeled buttons, no color-only meaning for hidden/locked states (use icons too).

## 9. Testing

- **Vitest unit tests** for:
  - distance math (all three diagonal rules)
  - snapping (each size category)
  - AoE affected-squares (both rules, all shapes, rotated cones)
  - fog visible/explored computation
  - `projectForPlayers` (hidden tokens, fogged enemies, hidden initiative entries, private HP — none may leak)
  - initiative sorting and tiebreaks
  - gist serialization round-trip (state → gist files → state is identical; asset diffing by hash; truncated-file handling), using a mocked GitHub API
  - schema migration
- **Playwright smoke tests:**
  - place a token, open the player window, verify a hidden token is absent from the player view
  - export and re-import a local backup zip

## 10. Repository hygiene

- Create `CLAUDE.md` at the start, with:
  - the architecture summary
  - the data model
  - the projection rule ("player view never receives hidden data")
  - commands
  - milestone status

  Keep it updated.
- Clear folder structure, e.g. `src/state`, `src/canvas`, `src/tools`, `src/panels`, `src/player`, `src/persistence`, `src/gist`, `src/sync`, `src/geometry`.
- Pure geometry and rules logic lives in `src/geometry` with no React imports, so it's easy to test.

## 11. Milestones (stop and let me test after each)

1. **Scaffold + deploy:** Vite/React/TS, hash routes `#/dm` and `#/player`, GitHub Actions Pages deploy, `CLAUDE.md`.
2. **Canvas core:** pan/zoom, grid with calibration, layers, built-in assets, placing/selecting/moving/resizing/rotating, magnetic snapping, undo/redo, shortcuts, context menu.
3. **Library + persistence:** uploads in IndexedDB, library panel, autosave, scenes.
4. **Player window:** BroadcastChannel sync, `projectForPlayers`, camera modes, ping, blackout, hidden items.
5. **Tokens & fog:** token properties, vision radius, fog (visible + explored + manual brushes), preview-as-players.
6. **Initiative tracker** with player visibility.
7. **Ruler + AoE templates.**
8. **Gist sync** (token setup, create/open gist, push/pull with asset diffing, conflict handling, revision restore) + local zip backup.
9. **Polish + tests:** onboarding, toasts, performance pass, remaining tests, README.

If something in this spec is ambiguous or conflicts with a technical constraint, make a sensible choice, note it in `CLAUDE.md` under "Decisions", and tell me at the end of the milestone.
