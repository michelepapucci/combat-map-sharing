import type { BadgeStyle } from '../../state/naming'
import type { SizeCategory, TokenKind } from '../../state/types'
import { GLYPH_NAMES, type GlyphName } from './glyphs'
import { MAPS } from './maps'
import { PROPS } from './props'
import { svgDataUrl, svgDocument } from './svg'

/**
 * Built-in assets (Decision 17): generated in code, identified by stable ids
 * `builtin:<kind>/<slug>`, never stored in the library or uploaded to a gist.
 * Ids are persisted in campaigns, so never rename or remove one.
 */
export const BUILTIN_PREFIX = 'builtin:'

export function isBuiltinId(id: string): boolean {
  return id.startsWith(BUILTIN_PREFIX)
}

/** How a built-in token is drawn: badge text on a colored disc, or a glyph. */
export type TokenLook = { type: 'initials' } | { type: 'glyph'; glyph: GlyphName }

export interface BuiltinTokenAsset {
  id: string
  kind: 'token'
  name: string
  look: TokenLook
}

export interface BuiltinImageAsset {
  id: string
  kind: 'prop' | 'map'
  name: string
  /** Raster size in px (props: PROP_PX_PER_CELL per cell; maps: native size in world px). */
  width: number
  height: number
  /** Props: default footprint in cells. Maps: null (placed at native size). */
  cells: { w: number; h: number } | null
  svg: () => string
}

export type BuiltinAsset = BuiltinTokenAsset | BuiltinImageAsset

/** Props are rasterized at this many px per cell, enough for zooming in a few times. */
export const PROP_PX_PER_CELL = 256

export const INITIALS_TOKEN_ID = 'builtin:token/initials'

export const TOKEN_ASSETS: readonly BuiltinTokenAsset[] = [
  { id: INITIALS_TOKEN_ID, kind: 'token', name: 'Initials', look: { type: 'initials' } },
  ...GLYPH_NAMES.map((glyph): BuiltinTokenAsset => ({
    id: `builtin:token/${glyph}`,
    kind: 'token',
    name: glyph,
    look: { type: 'glyph', glyph },
  })),
]

export const PROP_ASSETS: readonly BuiltinImageAsset[] = PROPS.map((prop) => {
  const width = prop.cells.w * PROP_PX_PER_CELL
  const height = prop.cells.h * PROP_PX_PER_CELL
  return {
    id: `builtin:prop/${prop.slug}`,
    kind: 'prop',
    name: prop.name,
    width,
    height,
    cells: prop.cells,
    svg: () =>
      svgDocument(width, height, prop.body(), `0 0 ${prop.cells.w * 100} ${prop.cells.h * 100}`),
  }
})

export const MAP_ASSETS: readonly BuiltinImageAsset[] = MAPS.map((map) => ({
  id: `builtin:map/${map.slug}`,
  kind: 'map',
  name: map.name,
  width: map.width,
  height: map.height,
  cells: null,
  svg: () => svgDocument(map.width, map.height, map.body()),
}))

const BY_ID = new Map<string, BuiltinAsset>(
  [...TOKEN_ASSETS, ...PROP_ASSETS, ...MAP_ASSETS].map((asset) => [asset.id, asset]),
)

export function getBuiltinAsset(id: string): BuiltinAsset | undefined {
  return BY_ID.get(id)
}

export function getBuiltinImageAsset(id: string): BuiltinImageAsset | undefined {
  const asset = BY_ID.get(id)
  return asset && asset.kind !== 'token' ? asset : undefined
}

/** The look of a token's asset; uploaded token images (milestone 3) count as images. */
export function tokenLook(assetId: string): TokenLook | null {
  const asset = BY_ID.get(assetId)
  return asset?.kind === 'token' ? asset.look : null
}

/** Initials tokens show their badge as the main text; everything else shows a number pip. */
export function badgeStyleFor(assetId: string): BadgeStyle {
  return tokenLook(assetId)?.type === 'initials' ? 'initials' : 'number'
}

const thumbnailUrls = new Map<string, string>()

/** A data: URL of a prop or map drawing, for library thumbnails. Cached. */
export function builtinThumbnailUrl(asset: BuiltinImageAsset): string {
  let url = thumbnailUrls.get(asset.id)
  if (url === undefined) {
    url = svgDataUrl(asset.svg())
    thumbnailUrls.set(asset.id, url)
  }
  return url
}

// --- Token presets (library entries) -----------------------------------------

/** Default ring colors by token kind. */
export const KIND_COLORS: Readonly<Record<TokenKind, string>> = {
  player: '#3d7fd9',
  npc: '#3f9f5f',
  enemy: '#d0463f',
}

/** Palette offered in the library for new tokens. */
export const TOKEN_COLORS: readonly { name: string; value: string }[] = [
  { name: 'Red', value: '#d0463f' },
  { name: 'Orange', value: '#de7f26' },
  { name: 'Yellow', value: '#d8b62c' },
  { name: 'Green', value: '#3f9f5f' },
  { name: 'Teal', value: '#2a9d9a' },
  { name: 'Blue', value: '#3d7fd9' },
  { name: 'Purple', value: '#8c58d0' },
  { name: 'Gray', value: '#77808f' },
]

/** A library entry: a token asset plus the defaults a newly placed token gets. */
export interface TokenPreset {
  id: string
  name: string
  assetId: string
  kind: TokenKind
  sizeCategory: SizeCategory
}

export const TOKEN_PRESETS: readonly TokenPreset[] = [
  { id: 'hero', name: 'Hero', assetId: INITIALS_TOKEN_ID, kind: 'player', sizeCategory: 'medium' },
  { id: 'ally', name: 'Ally', assetId: INITIALS_TOKEN_ID, kind: 'npc', sizeCategory: 'medium' },
  {
    id: 'goblin',
    name: 'Goblin',
    assetId: INITIALS_TOKEN_ID,
    kind: 'enemy',
    sizeCategory: 'small',
  },
  {
    id: 'skeleton',
    name: 'Skeleton',
    assetId: 'builtin:token/skull',
    kind: 'enemy',
    sizeCategory: 'medium',
  },
  {
    id: 'bandit',
    name: 'Bandit',
    assetId: 'builtin:token/swords',
    kind: 'enemy',
    sizeCategory: 'medium',
  },
  {
    id: 'guard',
    name: 'Guard',
    assetId: 'builtin:token/shield',
    kind: 'npc',
    sizeCategory: 'medium',
  },
  { id: 'wolf', name: 'Wolf', assetId: 'builtin:token/paw', kind: 'enemy', sizeCategory: 'medium' },
  {
    id: 'noble',
    name: 'Noble',
    assetId: 'builtin:token/crown',
    kind: 'npc',
    sizeCategory: 'medium',
  },
  { id: 'ogre', name: 'Ogre', assetId: INITIALS_TOKEN_ID, kind: 'enemy', sizeCategory: 'large' },
  {
    id: 'elemental',
    name: 'Fire elemental',
    assetId: 'builtin:token/flame',
    kind: 'enemy',
    sizeCategory: 'large',
  },
  { id: 'giant', name: 'Giant', assetId: INITIALS_TOKEN_ID, kind: 'enemy', sizeCategory: 'huge' },
  {
    id: 'dragon',
    name: 'Dragon',
    assetId: 'builtin:token/flame',
    kind: 'enemy',
    sizeCategory: 'gargantuan',
  },
]

export function getTokenPreset(id: string): TokenPreset | undefined {
  return TOKEN_PRESETS.find((preset) => preset.id === id)
}
