import { strToU8, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { sampleCampaign } from '../state/fixtures/sampleCampaign'
import type { CampaignState } from '../state/types'
import { BackupError, backupFileName, buildBackup, MAX_BACKUP_BYTES, readBackup } from './backup'

function campaignWithAssets(): CampaignState {
  const campaign = structuredClone(sampleCampaign)
  const template = campaign.library[0]
  if (!template) throw new Error('sample has no library')
  campaign.library = [
    { ...template, id: 'map-1', mime: 'image/webp' },
    { ...template, id: 'tok-2', mime: 'image/png' },
    { ...template, id: 'gone-3', mime: 'image/jpeg' },
  ]
  return campaign
}

const blobs: Record<string, Blob> = {
  'map-1': new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/webp' }),
  'tok-2': new Blob([new Uint8Array(1000).fill(7)], { type: 'image/png' }),
}

describe('backup zip', () => {
  it('round-trips the campaign and its stored images; missing ones are reported', async () => {
    const campaign = campaignWithAssets()
    const { zip, missing } = await buildBackup(campaign, async (id) => blobs[id])
    expect(missing).toStrictEqual(['gone-3'])
    const contents = readBackup(zip)
    expect(contents.campaign).toStrictEqual(JSON.parse(JSON.stringify(campaign)))
    expect([...contents.assets.keys()].toSorted()).toStrictEqual(['map-1', 'tok-2'])
    expect([...(contents.assets.get('map-1') ?? [])]).toStrictEqual([1, 2, 3, 4])
    expect(contents.assets.get('tok-2')?.length).toBe(1000)
  })

  it('never contains device data such as a token', async () => {
    const campaign = campaignWithAssets()
    const { zip } = await buildBackup(campaign, async (id) => blobs[id])
    const text = new TextDecoder('latin1').decode(zip)
    expect(text).not.toMatch(/ghp_|github_pat_|token/i)
  })

  it('refuses what is not a campaign backup', () => {
    expect(() => readBackup(new Uint8Array([1, 2, 3]))).toThrow(BackupError)
    expect(() => readBackup(zipSync({ 'notes.txt': strToU8('hi') }))).toThrow(/no campaign.json/)
    expect(() => readBackup(zipSync({ 'campaign.json': strToU8('{oops') }))).toThrow(/damaged/)
  })

  it('ignores unexpected entries (no path tricks) and refuses zip bombs before inflating', () => {
    const zip = zipSync({
      'campaign.json': strToU8('{}'),
      'assets/../evil.png': new Uint8Array([1]),
      'assets/ok.png': new Uint8Array([2]),
      'other/x.png': new Uint8Array([3]),
    })
    expect([...readBackup(zip).assets.keys()]).toStrictEqual(['ok'])
    // A zip claiming a huge uncompressed size: patch the declared size in the central directory.
    const bomb = zipSync({ 'campaign.json': strToU8('{}') })
    const view = new DataView(bomb.buffer)
    for (let k = 0; k + 4 <= bomb.length; k++) {
      if (view.getUint32(k, true) === 0x02014b50) view.setUint32(k + 24, MAX_BACKUP_BYTES + 1, true)
    }
    expect(() => readBackup(bomb)).toThrow(/too large/)
  })

  it('names files after the campaign and the date', () => {
    expect(backupFileName('Lost Mine: Act 1/2', new Date('2026-11-05T10:00:00Z'))).toBe(
      'Lost Mine Act 12 2026-11-05.vtt.zip',
    )
    expect(backupFileName('???', new Date('2026-01-02T00:00:00Z'))).toBe(
      'Campaign 2026-01-02.vtt.zip',
    )
  })
})
