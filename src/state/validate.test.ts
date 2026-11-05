import { describe, expect, it } from 'vitest'
import fixtureV1 from './fixtures/campaign.v1.json'
import { sampleCampaign } from './fixtures/sampleCampaign'
import { createCampaign, createItem, createSceneMemory, createToken } from './defaults'
import { isJsonObject, migrateToCurrent, type JsonObject } from './migrations'
import {
  CampaignValidationError,
  MAX_ID_LENGTH,
  MAX_NAME_LENGTH,
  MAX_NOTES_LENGTH,
  MAX_TAG_LENGTH,
  validateCampaign,
} from './validate'

// ---------------------------------------------------------------------------
// Helpers: documents are edited by path, in the same syntax as error paths.
// ---------------------------------------------------------------------------

/** A fresh, mutable JSON copy of the sample campaign. */
function sample(): JsonObject {
  return migrateToCurrent(sampleCampaign)
}

type Segment = string | number

/** `scenes[0].grid.color` / `sceneMemory["scene-1"].explored` → path segments. */
function segments(path: string): Segment[] {
  const out: Segment[] = []
  let rest = path
  while (rest !== '') {
    const m = /^\.?([A-Za-z_$][\w$]*)|^\[(\d+)\]|^\[("(?:[^"\\]|\\.)*")\]/.exec(rest)
    if (!m) throw new Error(`bad test path: ${path}`)
    const [whole, name, index, quoted] = m
    if (name !== undefined) out.push(name)
    else if (index !== undefined) out.push(Number(index))
    else out.push(String(JSON.parse(quoted ?? '""')))
    rest = rest.slice(whole.length)
  }
  return out
}

function child(node: unknown, key: Segment): unknown {
  if (typeof key === 'number' && Array.isArray(node)) return node[key]
  if (typeof key === 'string' && isJsonObject(node)) return node[key]
  throw new Error(`bad test path segment: ${key}`)
}

function at(doc: JsonObject, path: string): unknown {
  return segments(path).reduce<unknown>(child, doc)
}

/** Sets the value at `path` (`undefined` deletes the key) and returns the document. */
function put(doc: JsonObject, path: string, value: unknown): JsonObject {
  const keys = segments(path)
  const last = keys.pop()
  const node = keys.reduce<unknown>(child, doc)
  if (typeof last === 'number' && Array.isArray(node)) {
    node[last] = value
  } else if (typeof last === 'string' && isJsonObject(node)) {
    if (value === undefined) Reflect.deleteProperty(node, last)
    else node[last] = value
  } else {
    throw new Error(`bad test path: ${path}`)
  }
  return doc
}

/** The sample campaign with one value replaced. */
function sampleWith(path: string, value: unknown): JsonObject {
  return put(sample(), path, value)
}

/** The error validateCampaign throws for `doc` (fails the test if it does not throw one). */
function rejection(doc: JsonObject): CampaignValidationError {
  try {
    validateCampaign(doc)
  } catch (error) {
    if (error instanceof CampaignValidationError) return error
    throw error
  }
  throw new Error('expected validateCampaign to throw a CampaignValidationError')
}

/** Every object and array reachable from `value`. */
function references(value: unknown, into = new Set<object>()): Set<object> {
  if (typeof value === 'object' && value !== null && !into.has(value)) {
    into.add(value)
    for (const v of Object.values(value)) references(v, into)
  }
  return into
}

/** A JSON-parsed copy of `value` (an object) with an own `__proto__` key in front. */
function withProtoKey(value: unknown): JsonObject {
  const parsed: unknown = JSON.parse(
    `{"__proto__":{"polluted":true},${JSON.stringify(value).slice(1)}`,
  )
  if (!isJsonObject(parsed) || !Object.hasOwn(parsed, '__proto__')) {
    throw new Error('expected an object with an own __proto__ key')
  }
  return parsed
}

function longString(length: number): string {
  return 'x'.repeat(length)
}

const TOKEN = 'scenes[0].layers.tokens[0]'
const CHUNKS = 'sceneMemory["scene-1"].explored.chunks'

// ---------------------------------------------------------------------------

describe('validateCampaign: valid documents', () => {
  it('turns the v1 fixture into exactly the sample campaign, with no repairs', () => {
    const result = validateCampaign(migrateToCurrent(fixtureV1))
    expect(result).toStrictEqual({ campaign: sampleCampaign, repairs: [] })
  })

  it('returns a copy that shares no object or array with the input and leaves it untouched', () => {
    const input = migrateToCurrent(fixtureV1)
    const { campaign } = validateCampaign(input)
    const inputRefs = references(input)
    const outputRefs = references(campaign)
    expect(outputRefs.size).toBeGreaterThan(50)
    expect([...outputRefs].filter((ref) => inputRefs.has(ref))).toStrictEqual([])
    expect(input).toStrictEqual(migrateToCurrent(fixtureV1))
  })

  it('round-trips a new campaign from createCampaign() through JSON unchanged', () => {
    const campaign = createCampaign()
    const loaded = migrateToCurrent(JSON.parse(JSON.stringify(campaign)))
    expect(validateCampaign(loaded)).toStrictEqual({ campaign, repairs: [] })
  })

  it('accepts items and tokens made by the factories', () => {
    const campaign = createCampaign()
    const scene = campaign.scenes[0]
    if (!scene) throw new Error('createCampaign made no scene')
    const item = { assetId: 'builtin:prop/chest', name: 'Chest', x: 35, y: 35 }
    scene.layers.props.push(createItem({ ...item, width: 70, height: 140 }))
    scene.layers.tokens.push(
      createToken({
        assetId: 'builtin:token/initials',
        name: 'Ogre 1',
        kind: 'enemy',
        sizeCategory: 'large',
        color: '#ef4444',
        badge: 'O1',
        x: 140,
        y: 140,
        gridSize: scene.grid.size,
      }),
    )
    const loaded = migrateToCurrent(JSON.parse(JSON.stringify(campaign)))
    expect(validateCampaign(loaded)).toStrictEqual({ campaign, repairs: [] })
  })

  it('accepts values at the edge of every limit', () => {
    const doc = sample()
    put(doc, 'name', 'n'.repeat(MAX_NAME_LENGTH))
    put(doc, 'id', 'i'.repeat(MAX_ID_LENGTH))
    put(doc, `${TOKEN}.badge`, '🐉🐉🐉') // 3 characters, 6 UTF-16 code units
    put(doc, `${TOKEN}.dmNotes`, 'x'.repeat(MAX_NOTES_LENGTH))
    put(doc, `${TOKEN}.conditions`, ['c'.repeat(MAX_TAG_LENGTH)])
    put(doc, `${TOKEN}.visionFt`, 0)
    put(doc, 'scenes[0].grid.color', '#ABCDEF80')
    put(doc, 'sceneMemory["scene-1"].playerView', null)
    put(doc, 'scenes[0].fog.manual[0].shape.width', 0)
    put(doc, `${CHUNKS}["-123456,654321"]`, `${'A'.repeat(680)}AAA=`) // exactly 512 bytes
    put(doc, 'library[0].width', 16384)
    put(doc, 'library[2].defaultCells', { w: 100, h: 1 })
    const { campaign, repairs } = validateCampaign(doc)
    expect(repairs).toStrictEqual([])
    expect(campaign.id).toBe('i'.repeat(MAX_ID_LENGTH))
    expect(campaign.scenes[0]?.layers.tokens[0]?.badge).toBe('🐉🐉🐉')
  })

  it('keeps an initiative entry whose token was deleted', () => {
    const doc = sampleWith('scenes[0].initiative.entries[0].tokenId', 'deleted-token')
    const { campaign, repairs } = validateCampaign(doc)
    expect(campaign.scenes[0]?.initiative.entries[0]?.tokenId).toBe('deleted-token')
    expect(repairs).toStrictEqual([])
  })

  it('allows the same item id in different scenes', () => {
    const doc = sample()
    put(doc, 'scenes[1]', structuredClone(at(doc, 'scenes[0]')))
    put(doc, 'scenes[1].id', 'scene-2')
    put(doc, 'sceneMemory["scene-2"]', structuredClone(at(doc, 'sceneMemory["scene-1"]')))
    const { campaign, repairs } = validateCampaign(doc)
    expect(campaign.scenes.map((scene) => scene.id)).toStrictEqual(['scene-1', 'scene-2'])
    expect(repairs).toStrictEqual([])
  })
})

describe('validateCampaign: unknown keys', () => {
  it('drops unknown keys at every level', () => {
    const containers = [
      '',
      'scenes[0]',
      'scenes[0].grid',
      'scenes[0].layers',
      'scenes[0].layers.map[0]',
      'scenes[0].layers.props[0]',
      TOKEN,
      `${TOKEN}.hp`,
      'scenes[0].layerState',
      'scenes[0].layerState.map',
      'scenes[0].fog',
      'scenes[0].fog.manual[0]',
      'scenes[0].fog.manual[0].shape',
      'scenes[0].fog.manual[1].shape',
      'scenes[0].fog.manual[2].shape',
      'scenes[0].initiative',
      'scenes[0].initiative.entries[0]',
      'scenes[0].templates[0]',
      'sceneMemory["scene-1"]',
      'sceneMemory["scene-1"].explored',
      'sceneMemory["scene-1"].playerView',
      'library[0]',
      'library[2].defaultCells',
      'settings',
      'presentation',
    ]
    const doc = sample()
    for (const path of containers) put(doc, `${path}.extra`, { nested: ['x'] })
    // An extra layer is an unknown key too.
    put(doc, 'scenes[0].layers.walls', [])
    expect(validateCampaign(doc)).toStrictEqual({ campaign: sampleCampaign, repairs: [] })
  })

  it('drops JSON-parsed "__proto__" keys without polluting any prototype', () => {
    const doc = withProtoKey(sample())
    put(doc, 'scenes[0]', withProtoKey(at(doc, 'scenes[0]')))
    put(doc, TOKEN, withProtoKey(at(doc, TOKEN)))
    put(doc, `${TOKEN}.hp`, withProtoKey(at(doc, `${TOKEN}.hp`)))
    put(doc, 'library[0]', withProtoKey(at(doc, 'library[0]')))
    put(doc, 'sceneMemory', withProtoKey(at(doc, 'sceneMemory')))

    const { campaign, repairs } = validateCampaign(doc)

    expect(campaign).toStrictEqual(sampleCampaign)
    expect(repairs).toStrictEqual(['sceneMemory["__proto__"]: dropped memory of a deleted scene'])
    for (const object of [
      campaign,
      campaign.sceneMemory,
      campaign.scenes[0],
      campaign.library[0],
    ]) {
      expect(Object.getPrototypeOf(object)).toBe(Object.prototype)
      expect(Object.hasOwn(object ?? {}, '__proto__')).toBe(false)
    }
    expect('polluted' in {}).toBe(false)
    expect('polluted' in campaign.sceneMemory).toBe(false)
  })

  it.each(['__proto__', 'constructor', 'toString'])(
    'rejects "%s" as a scene id, so it can never become a sceneMemory key',
    (sceneId) => {
      const doc = sampleWith('scenes[0].id', sceneId)
      expect(rejection(doc).path).toBe('scenes[0].id')
    },
  )

  it('rejects a "__proto__" fog chunk key', () => {
    const doc = sampleWith(CHUNKS, JSON.parse('{"__proto__": "gA=="}'))
    expect(rejection(doc).path).toBe(`${CHUNKS}["__proto__"]`)
  })
})

describe('validateCampaign: rejections', () => {
  const cases: { family: string; path: string; value: unknown }[] = [
    // Wrong or missing schema version (validateCampaign runs after migrateToCurrent).
    { family: 'version', path: 'version', value: 2 },
    { family: 'version', path: 'version', value: 0 },
    { family: 'version', path: 'version', value: '1' },
    { family: 'version', path: 'version', value: undefined },

    // Enumerations.
    { family: 'enum', path: `${TOKEN}.kind`, value: 'boss' },
    { family: 'enum', path: `${TOKEN}.kind`, value: 'Player' },
    { family: 'enum', path: `${TOKEN}.sizeCategory`, value: 'colossal' },
    { family: 'enum', path: 'scenes[0].grid.type', value: 'hex' },
    { family: 'enum', path: 'scenes[0].fog.manual[0].mode', value: 'erase' },
    { family: 'enum', path: 'scenes[0].fog.manual[0].shape.type', value: 'circle' },
    { family: 'enum', path: 'scenes[0].initiative.entries[0].visibility', value: 'secret' },
    { family: 'enum', path: 'scenes[0].templates[0].shape', value: 'square' },
    { family: 'enum', path: 'library[0].kind', value: 'sound' },
    { family: 'enum', path: 'library[0].mime', value: 'image/svg+xml' },
    { family: 'enum', path: 'library[1].defaultSize', value: 'big' },
    { family: 'enum', path: 'library[1].defaultKind', value: 'boss' },
    { family: 'enum', path: 'settings.diagonalRule', value: 'manhattan' },
    { family: 'enum', path: 'settings.aoeCoverage', value: 'all' },
    { family: 'enum', path: 'presentation.cameraMode', value: 'free' },

    // Numbers: finite only, no numeric strings, ranges.
    { family: 'number', path: `${TOKEN}.x`, value: Number.NaN },
    { family: 'number', path: 'scenes[0].layers.map[0].y', value: Number.POSITIVE_INFINITY },
    { family: 'number', path: 'scenes[0].layers.props[0].rotation', value: -Infinity },
    { family: 'number', path: 'scenes[0].layers.props[0].width', value: '70' },
    { family: 'number', path: 'scenes[0].layers.props[0].height', value: 0 },
    { family: 'number', path: 'scenes[0].layers.props[0].opacity', value: 1.5 },
    { family: 'number', path: 'scenes[0].grid.size', value: 3 },
    { family: 'number', path: 'scenes[0].grid.size', value: 2001 },
    { family: 'number', path: 'scenes[0].grid.size', value: Number.NaN },
    { family: 'number', path: 'scenes[0].grid.offsetX', value: '12' },
    { family: 'number', path: 'scenes[0].grid.feetPerCell', value: 0 },
    { family: 'number', path: 'scenes[0].grid.opacity', value: -0.1 },
    { family: 'number', path: `${TOKEN}.hp.max`, value: 0 },
    { family: 'number', path: `${TOKEN}.hp.max`, value: '12' },
    { family: 'number', path: `${TOKEN}.hp.current`, value: Number.NaN },
    { family: 'number', path: `${TOKEN}.visionFt`, value: -5 },
    { family: 'number', path: `${TOKEN}.initiativeModifier`, value: 1.5 },
    { family: 'number', path: 'scenes[0].initiative.entries[0].value', value: '15' },
    { family: 'number', path: 'scenes[0].initiative.entries[0].dexTiebreak', value: Infinity },
    { family: 'number', path: 'scenes[0].initiative.round', value: 0 },
    { family: 'number', path: 'scenes[0].initiative.round', value: 1.5 },
    { family: 'number', path: 'scenes[0].templates[0].sizeFt', value: -5 },
    { family: 'number', path: 'scenes[0].templates[0].widthFt', value: 0 },
    { family: 'number', path: 'scenes[0].fog.manual[0].shape.width', value: -1 },
    { family: 'number', path: 'scenes[0].fog.manual[2].shape.radius', value: 0 },
    { family: 'number', path: 'sceneMemory["scene-1"].explored.cellPx', value: 0 },
    { family: 'number', path: 'sceneMemory["scene-1"].playerView.width', value: 0 },
    { family: 'number', path: 'library[0].width', value: 16385 },
    { family: 'number', path: 'library[0].height', value: 2.5 },
    { family: 'number', path: 'library[0].bytes', value: -1 },
    { family: 'number', path: 'library[2].defaultCells.w', value: 0 },
    { family: 'number', path: 'library[2].defaultCells.h', value: 101 },
    { family: 'number', path: 'createdAt', value: Number.NaN },
    { family: 'number', path: 'updatedAt', value: '1762300500000' },

    // Booleans.
    { family: 'boolean', path: 'scenes[0].layers.map[0].locked', value: 'true' },
    { family: 'boolean', path: 'scenes[0].layers.tokens[1].hidden', value: 0 },
    { family: 'boolean', path: 'scenes[0].layerState.props.visible', value: null },
    { family: 'boolean', path: 'settings.snapEnabled', value: 1 },
    { family: 'boolean', path: 'presentation.blackout', value: 'false' },

    // Colors: hex only.
    { family: 'color', path: 'scenes[0].grid.color', value: 'red' },
    { family: 'color', path: `${TOKEN}.color`, value: 'url(x)' },
    { family: 'color', path: 'scenes[0].templates[0].color', value: 'rgb(0, 0, 0)' },
    { family: 'color', path: `${TOKEN}.color`, value: '#12345' },
    { family: 'color', path: `${TOKEN}.color`, value: '#ggg' },
    { family: 'color', path: `${TOKEN}.color`, value: '#000000; background: url(x)' },
    { family: 'color', path: `${TOKEN}.color`, value: ' #000000' },

    // Containers and missing keys (persisted data has no optional keys).
    { family: 'shape', path: 'scenes[0]', value: null },
    { family: 'shape', path: 'scenes[0].layers.tokens', value: {} },
    { family: 'shape', path: 'scenes[0].layerState.tokens', value: undefined },
    { family: 'shape', path: `${TOKEN}.hp`, value: undefined },
    { family: 'shape', path: `${TOKEN}.hp`, value: 'full' },
    { family: 'shape', path: `${TOKEN}.label`, value: undefined },
    { family: 'shape', path: `${TOKEN}.conditions`, value: 'prone' },
    { family: 'shape', path: 'sceneMemory', value: [] },
    { family: 'shape', path: 'library', value: null },
    { family: 'shape', path: 'settings', value: undefined },

    // Strings, ids and length caps.
    { family: 'string', path: 'name', value: 42 },
    { family: 'string', path: `${TOKEN}.badge`, value: 'ABCD' },
    { family: 'string', path: `${TOKEN}.badge`, value: '' },
    { family: 'string', path: 'scenes[0].initiative.entries[0].name', value: null },
    { family: 'id', path: 'id', value: '' },
    { family: 'id', path: 'id', value: longString(MAX_ID_LENGTH + 1) },
    { family: 'id', path: 'scenes[0].layers.map[0].assetId', value: '' },
    { family: 'id', path: 'scenes[0].initiative.entries[0].tokenId', value: 7 },
    { family: 'id', path: 'activeSceneId', value: null },
    { family: 'hash', path: 'library[0].hash', value: 'ab'.repeat(31) },
    { family: 'hash', path: 'library[0].hash', value: 'AB'.repeat(32) },
    { family: 'builtin', path: 'library[0].id', value: 'builtin:map/cave' },

    // Fog shapes.
    { family: 'fog', path: 'scenes[0].fog.manual[1].shape.points', value: [0, 0, 70, 0, 35] },
    { family: 'fog', path: 'scenes[0].fog.manual[1].shape.points', value: [0, 0, 70, 0] },
    { family: 'fog', path: 'scenes[0].fog.manual[2].shape.points', value: [] },
    { family: 'fog', path: 'scenes[0].fog.manual[2].shape.points', value: [10, 10, 50] },
    { family: 'fog', path: 'scenes[0].fog.manual[1].shape.points[2]', value: Number.NaN },

    // Fog chunks: canonical base64 of at most FOG_CHUNK_BYTES bytes.
    { family: 'chunk', path: `${CHUNKS}["0,0"]`, value: '!!!!' },
    { family: 'chunk', path: `${CHUNKS}["0,0"]`, value: 'AAE' },
    { family: 'chunk', path: `${CHUNKS}["0,0"]`, value: 'gA=' },
    { family: 'chunk', path: `${CHUNKS}["0,0"]`, value: 'gA==gA==' },
    { family: 'chunk', path: `${CHUNKS}["0,0"]`, value: 'A'.repeat(684) }, // 513 bytes
    { family: 'chunk', path: `${CHUNKS}["0,0"]`, value: 42 },
    { family: 'chunk', path: `${CHUNKS}["0;0"]`, value: 'gA==' },
    { family: 'chunk', path: `${CHUNKS}["1.5,2"]`, value: 'gA==' },
    { family: 'chunk', path: `${CHUNKS}["1234567,0"]`, value: 'gA==' },
    { family: 'chunk', path: `${CHUNKS}["01,2"]`, value: 'gA==' },
    { family: 'chunk', path: `${CHUNKS}["-0,1"]`, value: 'gA==' },
    { family: 'chunk', path: `${CHUNKS}[" 0,0"]`, value: 'gA==' },
  ]

  it.each(cases)('$family: rejects $path = $value', ({ path, value }) => {
    const error = rejection(sampleWith(path, value))
    expect(error.path).toBe(path)
    expect(error.message).toContain(path)
  })

  it('rejects a campaign without scenes', () => {
    expect(rejection(sampleWith('scenes', [])).path).toBe('scenes')
  })

  it('throws a named Error whose message starts with the path', () => {
    const error = rejection(sampleWith('version', 99))
    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('CampaignValidationError')
    expect(error.message).toMatch(/^Invalid campaign data at version: /)
  })

  describe('duplicate ids', () => {
    it('rejects duplicate scene ids', () => {
      const doc = sample()
      put(doc, 'scenes[1]', structuredClone(at(doc, 'scenes[0]')))
      expect(rejection(doc).path).toBe('scenes[1].id')
    })

    it('rejects an item id used twice within a layer', () => {
      expect(rejection(sampleWith(`${TOKEN}.id`, 'token-2')).path).toBe(
        'scenes[0].layers.tokens[1].id',
      )
    })

    it('rejects an item id used on two layers of a scene', () => {
      const doc = sampleWith('scenes[0].layers.tokens[1].id', 'prop-1')
      expect(rejection(doc).path).toBe('scenes[0].layers.tokens[1].id')
    })

    it('rejects duplicate fog edit ids', () => {
      const doc = sampleWith('scenes[0].fog.manual[2].id', 'fog-1')
      expect(rejection(doc).path).toBe('scenes[0].fog.manual[2].id')
    })

    it('rejects duplicate initiative entry ids', () => {
      const doc = sampleWith('scenes[0].initiative.entries[1].id', 'init-1')
      expect(rejection(doc).path).toBe('scenes[0].initiative.entries[1].id')
    })

    it('rejects duplicate template ids', () => {
      const doc = sample()
      put(doc, 'scenes[0].templates[1]', structuredClone(at(doc, 'scenes[0].templates[0]')))
      expect(rejection(doc).path).toBe('scenes[0].templates[1].id')
    })

    it('rejects duplicate library asset ids', () => {
      const doc = sampleWith('library[2].id', 'asset-map-1')
      expect(rejection(doc).path).toBe('library[2].id')
    })
  })
})

describe('validateCampaign: repairs', () => {
  it('shortens over-long free text instead of refusing the campaign', () => {
    const doc = sample()
    put(doc, 'name', longString(MAX_NAME_LENGTH + 5))
    put(doc, 'scenes[0].name', longString(MAX_NAME_LENGTH + 1))
    put(doc, `${TOKEN}.label`, longString(MAX_NAME_LENGTH + 1))
    put(doc, `${TOKEN}.dmNotes`, longString(MAX_NOTES_LENGTH + 1))
    put(doc, `${TOKEN}.conditions[0]`, longString(MAX_TAG_LENGTH + 1))
    put(doc, 'library[0].tags[0]', longString(MAX_TAG_LENGTH + 1))
    // A surrogate pair straddling the limit is dropped whole.
    put(doc, 'scenes[0].layers.props[0].name', `${'p'.repeat(MAX_NAME_LENGTH - 1)}😀`)
    const { campaign, repairs } = validateCampaign(doc)
    expect(campaign.name).toHaveLength(MAX_NAME_LENGTH)
    expect(campaign.scenes[0]?.layers.props[0]?.name).toBe('p'.repeat(MAX_NAME_LENGTH - 1))
    expect(campaign.scenes[0]?.layers.tokens[0]?.dmNotes).toHaveLength(MAX_NOTES_LENGTH)
    expect(repairs).toContain(
      `name: shortened from ${MAX_NAME_LENGTH + 5} to ${MAX_NAME_LENGTH} characters`,
    )
    expect(repairs).toHaveLength(7)
  })

  it('still rejects text fields that are not strings', () => {
    expect(rejection(sampleWith('name', 42)).path).toBe('name')
  })

  it('normalizes grid offsets into [0, size)', () => {
    const doc = sample()
    put(doc, 'scenes[0].grid.offsetX', 82)
    put(doc, 'scenes[0].grid.offsetY', -66)
    const { campaign, repairs } = validateCampaign(doc)
    expect(campaign.scenes[0]?.grid).toMatchObject({ offsetX: 12, offsetY: 4 })
    expect(repairs).toStrictEqual([
      'scenes[0].grid.offsetX: 82 normalized to 12',
      'scenes[0].grid.offsetY: -66 normalized to 4',
    ])
  })

  it('normalizes rotations into [0, 360)', () => {
    const doc = sample()
    put(doc, 'scenes[0].layers.map[0].rotation', -90)
    put(doc, 'scenes[0].layers.props[0].rotation', 450)
    put(doc, `${TOKEN}.rotation`, 360)
    const { campaign, repairs } = validateCampaign(doc)
    const scene = campaign.scenes[0]
    expect(scene?.layers.map[0]?.rotation).toBe(270)
    expect(scene?.layers.props[0]?.rotation).toBe(90)
    expect(scene?.layers.tokens[0]?.rotation).toBe(0)
    expect(repairs).toStrictEqual([
      'scenes[0].layers.map[0].rotation: -90 normalized to 270',
      'scenes[0].layers.props[0].rotation: 450 normalized to 90',
      'scenes[0].layers.tokens[0].rotation: 360 normalized to 0',
    ])
  })

  it('rewrites token sizes to footprint × grid size, keeping the center', () => {
    const doc = sample()
    put(doc, `${TOKEN}.width`, 100)
    put(doc, 'scenes[0].layers.tokens[1].sizeCategory', 'large')
    const { campaign, repairs } = validateCampaign(doc)
    const [aria, goblin] = campaign.scenes[0]?.layers.tokens ?? []
    expect(aria).toMatchObject({ x: 455, y: 525, width: 70, height: 70 })
    expect(goblin).toMatchObject({ x: 980, y: 700, width: 140, height: 140 })
    expect(repairs).toStrictEqual([
      'scenes[0].layers.tokens[0]: size 100×70 rewritten to 70×70 (medium on a 70 px grid)',
      'scenes[0].layers.tokens[1]: size 70×70 rewritten to 140×140 (large on a 70 px grid)',
    ])
  })

  it('points a dangling activeSceneId at the first scene', () => {
    const { campaign, repairs } = validateCampaign(sampleWith('activeSceneId', 'gone'))
    expect(campaign.activeSceneId).toBe('scene-1')
    expect(repairs).toStrictEqual(['activeSceneId: unknown scene "gone", set to the first scene'])
  })

  it('clears a dangling activeEntryId', () => {
    const doc = sampleWith('scenes[0].initiative.activeEntryId', 'init-9')
    const { campaign, repairs } = validateCampaign(doc)
    expect(campaign.scenes[0]?.initiative.activeEntryId).toBeNull()
    expect(repairs).toStrictEqual([
      'scenes[0].initiative.activeEntryId: unknown entry "init-9", cleared',
    ])
  })

  it('keeps a splashAssetId from the library and clears a dangling one', () => {
    const kept = validateCampaign(sampleWith('presentation.splashAssetId', 'asset-map-1'))
    expect(kept.campaign.presentation.splashAssetId).toBe('asset-map-1')
    expect(kept.repairs).toStrictEqual([])

    const cleared = validateCampaign(sampleWith('presentation.splashAssetId', 'builtin:map/cave'))
    expect(cleared.campaign.presentation.splashAssetId).toBeNull()
    expect(cleared.repairs).toStrictEqual([
      'presentation.splashAssetId: unknown asset "builtin:map/cave", cleared',
    ])
  })

  it('recreates a missing scene memory', () => {
    const { campaign, repairs } = validateCampaign(sampleWith('sceneMemory["scene-1"]', undefined))
    const scene = sampleCampaign.scenes[0]
    if (!scene) throw new Error('sample has no scene')
    expect(campaign.sceneMemory).toStrictEqual({ 'scene-1': createSceneMemory(scene) })
    expect(campaign.sceneMemory['scene-1']?.explored.cellPx).toBe(17.5)
    expect(repairs).toStrictEqual(['sceneMemory["scene-1"]: missing, recreated empty'])
  })

  it('drops the memory of scenes that no longer exist, even if it is malformed', () => {
    const doc = sample()
    put(doc, 'sceneMemory["deleted-scene"]', structuredClone(at(doc, 'sceneMemory["scene-1"]')))
    put(doc, 'sceneMemory["broken"]', 'garbage')
    const { campaign, repairs } = validateCampaign(doc)
    expect(campaign).toStrictEqual(sampleCampaign)
    expect(repairs).toStrictEqual([
      'sceneMemory["deleted-scene"]: dropped memory of a deleted scene',
      'sceneMemory["broken"]: dropped memory of a deleted scene',
    ])
  })

  it('drops empty fog chunks', () => {
    const { campaign, repairs } = validateCampaign(sampleWith(`${CHUNKS}["3,-3"]`, ''))
    expect(campaign).toStrictEqual(sampleCampaign)
    expect(repairs).toStrictEqual([`${CHUNKS}["3,-3"]: dropped an empty chunk`])
  })

  it('removes duplicate token conditions', () => {
    const doc = sampleWith(`${TOKEN}.conditions`, ['prone', 'poisoned', 'prone'])
    const { campaign, repairs } = validateCampaign(doc)
    expect(campaign.scenes[0]?.layers.tokens[0]?.conditions).toStrictEqual(['prone', 'poisoned'])
    expect(repairs).toStrictEqual([`${TOKEN}.conditions: removed duplicate conditions`])
  })
})
