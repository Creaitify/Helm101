import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { AdPlatformRouter } from '@/lib/server/ad-platforms'
import { MetaAdsGateway } from '@/lib/server/ad-platforms/meta-ads'
import { GoogleAdsGateway } from '@/lib/server/ad-platforms/google-ads'

describe('AdPlatformRouter', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv }
    delete process.env.META_ACCESS_TOKEN
    delete process.env.GOOGLE_ADS_DEVELOPER_TOKEN
  })

  afterEach(() => {
    process.env = originalEnv
    vi.restoreAllMocks()
  })

  describe('executeApprovedShifts', () => {
    it('executes in sandbox mode when live credentials are absent with success: true', async () => {
      const router = new AdPlatformRouter()
      const shifts = [
        {
          campaign_id: 'fhc-meta-retargeting',
          current_budget: 40000,
          proposed_budget: 50000,
          reason: 'Scale high ROAS',
        },
        {
          campaign_id: 'search-competitor',
          current_budget: 30000,
          proposed_budget: 20000,
          reason: 'Trim fatigued CAC',
        },
      ]

      const results = await router.executeApprovedShifts(shifts)

      expect(results).toHaveLength(2)
      expect(results[0]).toEqual({
        campaignId: 'fhc-meta-retargeting',
        platform: 'meta',
        action: expect.stringContaining('sandbox mode'),
        success: true,
      })
      expect(results[1]).toEqual({
        campaignId: 'search-competitor',
        platform: 'google',
        action: expect.stringContaining('sandbox mode'),
        success: true,
      })
    })

    it('routes Meta shifts converting Rupees to minor units (paise: * 100) when credentials present', async () => {
      process.env.META_ACCESS_TOKEN = 'mock-meta-token'
      const applyBudgetShiftSpy = vi
        .spyOn(MetaAdsGateway.prototype, 'applyBudgetShift')
        .mockResolvedValue({ ok: true, campaignId: 'fhc-meta-retargeting' })

      const router = new AdPlatformRouter()
      const shifts = [
        {
          campaign_id: 'fhc-meta-retargeting',
          current_budget: 40000,
          proposed_budget: 50000,
          reason: 'Scale high ROAS',
        },
      ]

      const results = await router.executeApprovedShifts(shifts)

      expect(applyBudgetShiftSpy).toHaveBeenCalledWith({
        campaignId: 'fhc-meta-retargeting',
        newDailyBudget: 5000000, // 50,000 * 100 paise
        currency: 'INR',
      })
      expect(results[0].success).toBe(true)
      expect(results[0].action).toContain('live mode')
    })

    it('routes Google shifts converting Rupees to micros (* 1,000,000) when credentials present', async () => {
      process.env.GOOGLE_ADS_DEVELOPER_TOKEN = 'mock-google-token'
      const applyBudgetShiftSpy = vi
        .spyOn(GoogleAdsGateway.prototype, 'applyBudgetShift')
        .mockResolvedValue({ ok: true, campaignId: 'search-brand' })

      const router = new AdPlatformRouter()
      const shifts = [
        {
          campaign_id: 'search-brand',
          current_budget: 25000,
          proposed_budget: 30000,
          reason: 'Brand scale',
        },
      ]

      const results = await router.executeApprovedShifts(shifts)

      expect(applyBudgetShiftSpy).toHaveBeenCalledWith({
        campaignId: 'search-brand',
        campaignBudgetId: 'budget-search-brand',
        newDailyBudget: 30000000000, // 30,000 * 1,000,000 micros
        currency: 'INR',
      })
      expect(results[0].success).toBe(true)
      expect(results[0].action).toContain('live mode')
    })

    it('handles gateway exceptions without inverting logic', async () => {
      process.env.META_ACCESS_TOKEN = 'mock-meta-token'
      vi.spyOn(MetaAdsGateway.prototype, 'applyBudgetShift').mockRejectedValue(
        new Error('Meta Graph API rate limit exceeded')
      )

      const router = new AdPlatformRouter()
      const shifts = [
        {
          campaign_id: 'fhc-meta-retargeting',
          current_budget: 40000,
          proposed_budget: 50000,
          reason: 'Scale high ROAS',
        },
      ]

      const results = await router.executeApprovedShifts(shifts)

      expect(results[0].success).toBe(false)
      expect(results[0].error).toBe('Meta Graph API rate limit exceeded')
    })
  })

  describe('deployCreatives', () => {
    it('meets Google RSA minimum requirement of >= 3 headlines and >= 2 descriptions', async () => {
      process.env.GOOGLE_ADS_DEVELOPER_TOKEN = 'mock-google-token'
      const rsaSpy = vi
        .spyOn(GoogleAdsGateway.prototype, 'createResponsiveSearchAd')
        .mockResolvedValue({ ok: true, adId: 'mock-ad-1' })

      const router = new AdPlatformRouter()
      const variants = [
        {
          headline: 'Fee-Only 360 Portfolio Review',
          body: 'Get comprehensive SEBI portfolio review with zero hidden commissions.',
        },
      ]

      const results = await router.deployCreatives(variants, ['search-brand'])

      expect(rsaSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          headlines: expect.arrayContaining([
            expect.any(String),
            expect.any(String),
            expect.any(String),
          ]),
          descriptions: expect.arrayContaining([
            expect.any(String),
            expect.any(String),
          ]),
        })
      )

      const callArgs = rsaSpy.mock.calls[0][0]
      expect(callArgs.headlines.length).toBeGreaterThanOrEqual(3)
      expect(callArgs.descriptions.length).toBeGreaterThanOrEqual(2)
      expect(results[0].success).toBe(true)
    })
  })
})
