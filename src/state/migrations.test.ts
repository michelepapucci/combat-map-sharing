import { describe, expect, it } from 'vitest'
import {
  CURRENT_SCHEMA_VERSION,
  MIGRATIONS,
  migrateToCurrent,
  SchemaVersionError,
  type Migration,
} from './migrations'
import { sampleCampaign } from './fixtures/sampleCampaign'

describe('migrateToCurrent', () => {
  it('passes a current-version document through unchanged, as a copy', () => {
    const doc = { version: CURRENT_SCHEMA_VERSION, scenes: [{ id: 's1' }] }
    const migrated = migrateToCurrent(doc)
    expect(migrated).toStrictEqual(doc)
    expect(migrated).not.toBe(doc)
    expect(migrated['scenes']).not.toBe(doc.scenes)
  })

  it.each([null, undefined, 42, 'campaign', [], [{ version: 1 }]])(
    'rejects non-objects (%j)',
    (raw) => {
      expect(() => migrateToCurrent(raw)).toThrow(SchemaVersionError)
    },
  )

  it.each([{}, { version: '1' }, { version: 0 }, { version: 1.5 }, { version: -3 }])(
    'rejects documents without a valid version (%j)',
    (raw) => {
      expect(() => migrateToCurrent(raw)).toThrow(/no valid schema version/)
    },
  )

  it('rejects documents from a newer app version with an actionable message', () => {
    expect(() => migrateToCurrent({ version: CURRENT_SCHEMA_VERSION + 1 })).toThrow(
      /newer version of the app/,
    )
  })

  it('applies migrations in order, one version at a time, without mutating the input', () => {
    const steps: Record<number, Migration> = {
      1: (doc) => ({ ...doc, log: [...((doc['log'] as string[]) ?? []), '1->2'] }),
      2: (doc) => ({ ...doc, log: [...(doc['log'] as string[]), '2->3'] }),
    }
    const input = { version: 1, name: 'Keep' }
    const migrated = migrateToCurrent(input, steps, 3)
    expect(migrated).toEqual({ version: 3, name: 'Keep', log: ['1->2', '2->3'] })
    expect(input).toEqual({ version: 1, name: 'Keep' })
  })

  it('fails loudly when a migration step is missing', () => {
    expect(() => migrateToCurrent({ version: 1 }, {}, 2)).toThrow(/No migration from schema v1/)
  })

  it('has a contiguous migration chain up to the current version', () => {
    for (let v = 1; v < CURRENT_SCHEMA_VERSION; v++) {
      expect(MIGRATIONS[v], `missing MIGRATIONS[${v}]`).toBeTypeOf('function')
    }
    expect(MIGRATIONS[CURRENT_SCHEMA_VERSION]).toBeUndefined()
  })
})

describe('MIGRATIONS[1]: v1 to v2', () => {
  it('adds metric units and keeps the other settings', () => {
    const migrated = migrateToCurrent({
      version: 1,
      settings: { diagonalRule: 'five', snapEnabled: false },
    })
    expect(migrated).toStrictEqual({
      version: 2,
      settings: { diagonalRule: 'five', snapEnabled: false, units: 'metric' },
    })
  })

  it('leaves documents without settings for the validator to reject', () => {
    expect(migrateToCurrent({ version: 1 }, MIGRATIONS, 2)).toStrictEqual({ version: 2 })
  })
})

describe('saved campaign fixtures', () => {
  // Every frozen fixture saved by any schema version must migrate to the current sample.
  const fixtures = import.meta.glob<unknown>('./fixtures/campaign.v*.json', {
    eager: true,
    import: 'default',
  })

  it('includes a fixture for the current schema version', () => {
    expect(Object.keys(fixtures)).toContain(`./fixtures/campaign.v${CURRENT_SCHEMA_VERSION}.json`)
  })

  it.each(Object.entries(fixtures))('%s migrates to the current sample campaign', (_, fixture) => {
    expect(migrateToCurrent(fixture)).toStrictEqual(sampleCampaign)
  })
})
