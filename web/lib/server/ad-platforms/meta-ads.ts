/**
 * Meta Ads Gateway Skeleton
 * 
 * Stub implementation for Meta Marketing API integration.
 * All methods throw NotImplementedError with clear TODO instructions.
 * 
 * Required env vars (when implemented):
 *   META_APP_ID, META_APP_SECRET, META_ACCESS_TOKEN, META_AD_ACCOUNT_ID
 * 
 * API Reference: https://developers.facebook.com/docs/marketing-apis
 */

export interface MetaBudgetUpdate {
  campaignId: string
  newDailyBudget: number  // in micros (₹40,000 = 40000_00)
  currency: string
}

export interface MetaCreativeInput {
  adAccountId: string
  name: string
  headline: string
  body: string
  linkUrl?: string
  imageHash?: string
}

export interface MetaInsightsResult {
  campaignId: string
  spend: number
  impressions: number
  clicks: number
  conversions: number
  cpc: number
  cpm: number
  dateRange: { start: string; end: string }
}

export class MetaAdsGateway {
  private accessToken: string
  private adAccountId: string
  private apiVersion: string

  constructor(config?: { accessToken?: string; adAccountId?: string; apiVersion?: string }) {
    this.accessToken = config?.accessToken || process.env.META_ACCESS_TOKEN || ''
    this.adAccountId = config?.adAccountId || process.env.META_AD_ACCOUNT_ID || ''
    this.apiVersion = config?.apiVersion || 'v20.0'
  }

  /**
   * Update daily budget for a Meta campaign.
   * Maps to: POST /{campaign-id} { daily_budget: amount_in_micros }
   */
  async applyBudgetShift(update: MetaBudgetUpdate): Promise<{ ok: boolean; campaignId: string }> {
    // TODO: Implement Meta Marketing API call
    // POST https://graph.facebook.com/{apiVersion}/{campaignId}
    // Body: { daily_budget: newDailyBudget, access_token: this.accessToken }
    throw new Error(
      `[MetaAdsGateway] applyBudgetShift not implemented. ` +
      `Would update campaign ${update.campaignId} to ₹${update.newDailyBudget / 100} daily budget. ` +
      `Implement with Meta Marketing API POST /${update.campaignId}.`
    )
  }

  /**
   * Create an ad creative on Meta.
   * Maps to: POST /act_{ad-account-id}/adcreatives
   */
  async createAdCreative(input: MetaCreativeInput): Promise<{ ok: boolean; creativeId: string }> {
    // TODO: Implement Meta Marketing API call
    // POST https://graph.facebook.com/{apiVersion}/act_{adAccountId}/adcreatives
    // Body: { name, object_story_spec: { ... }, access_token }
    throw new Error(
      `[MetaAdsGateway] createAdCreative not implemented. ` +
      `Would create creative "${input.name}" in account ${input.adAccountId}. ` +
      `Implement with Meta Marketing API POST /act_{adAccountId}/adcreatives.`
    )
  }

  /**
   * Fetch campaign performance insights.
   * Maps to: GET /{campaign-id}/insights
   */
  async getInsights(
    campaignId: string,
    dateRange: { start: string; end: string },
  ): Promise<MetaInsightsResult> {
    // TODO: Implement Meta Marketing API call
    // GET https://graph.facebook.com/{apiVersion}/{campaignId}/insights
    // Params: { fields: 'spend,impressions,clicks,...', time_range: { since, until } }
    throw new Error(
      `[MetaAdsGateway] getInsights not implemented. ` +
      `Would fetch insights for campaign ${campaignId} from ${dateRange.start} to ${dateRange.end}. ` +
      `Implement with Meta Marketing API GET /{campaignId}/insights.`
    )
  }

  /** Pause a Meta campaign. Maps to: POST /{campaign-id} { status: 'PAUSED' } */
  async pauseCampaign(campaignId: string): Promise<{ ok: boolean }> {
    throw new Error(
      `[MetaAdsGateway] pauseCampaign not implemented. ` +
      `Would pause campaign ${campaignId}. Implement with POST /{campaignId} { status: 'PAUSED' }.`
    )
  }

  /** Resume a Meta campaign. Maps to: POST /{campaign-id} { status: 'ACTIVE' } */
  async resumeCampaign(campaignId: string): Promise<{ ok: boolean }> {
    throw new Error(
      `[MetaAdsGateway] resumeCampaign not implemented. ` +
      `Would resume campaign ${campaignId}. Implement with POST /{campaignId} { status: 'ACTIVE' }.`
    )
  }
}
