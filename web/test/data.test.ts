import { describe, it, expect } from 'vitest'
import * as data from '@/lib/data'

describe('mock data', () => {
  it('channel checkups sum to the funnel checkups stage', async () => {
    const channels = await data.getChannels()
    const funnel = await data.getFunnel()
    const channelTotal = channels.reduce((s, c) => s + c.checkups, 0)
    const checkupStage = funnel.find(f => f.label === 'Checkups')!
    expect(channelTotal).toBe(checkupStage.value)
  })
  it('exposes the implemented worker capabilities', async () => {
    expect((await data.getAgents()).map((agent) => agent.name)).toEqual(['Governor', 'Media Buyer', 'Analyst', 'Creative'])
  })
})
