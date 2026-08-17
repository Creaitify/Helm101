/**
 * Google Ads Gateway Skeleton
 * 
 * Stub implementation for Google Ads API integration.
 * All methods throw NotImplementedError with clear TODO instructions.
 * 
 * Required env vars (when implemented):
 *   GOOGLE_ADS_DEVELOPER_TOKEN, GOOGLE_ADS_CLIENT_ID, GOOGLE_ADS_CLIENT_SECRET,
 *   GOOGLE_ADS_REFRESH_TOKEN, GOOGLE_ADS_CUSTOMER_ID
 * 
 * API Reference: https://developers.google.com/google-ads/api/docs/start
 */

export interface GoogleBudgetUpdate {
  campaignId: string
  campaignBudgetId: string
  newDailyBudget: number  // in micros (₹25,000 = 25000_000000)
  currency: string
}

export interface GoogleRsaInput {
  customerId: string
  adGroupId: string
  headlines: string[]  // min 3, up to 15, max 30 chars each (Google RSA requirement)
  descriptions: string[]  // min 2, up to 4, max 90 chars each (Google RSA requirement)
  finalUrl: string
}

export interface GoogleCampaignMetrics {
  campaignId: string
  cost: number
  impressions: number
  clicks: number
  conversions: number
  averageCpc: number
  conversionRate: number
  dateRange: { start: string; end: string }
}

export class GoogleAdsGateway {
  private developerToken: string
  private customerId: string

  constructor(config?: { developerToken?: string; customerId?: string }) {
    this.developerToken = config?.developerToken || process.env.GOOGLE_ADS_DEVELOPER_TOKEN || ''
    this.customerId = config?.customerId || process.env.GOOGLE_ADS_CUSTOMER_ID || ''
  }

  /**
   * Update daily budget for a Google Ads campaign.
   * Maps to: CampaignBudgetService.MutateCampaignBudgets
   */
  async applyBudgetShift(update: GoogleBudgetUpdate): Promise<{ ok: boolean; campaignId: string }> {
    // TODO: Implement Google Ads API call
    // Use google-ads-api client: customer.campaignBudgets.update({ ... })
    // Resource name: customers/{customerId}/campaignBudgets/{budgetId}
    throw new Error(
      `[GoogleAdsGateway] applyBudgetShift not implemented. ` +
      `Would update campaign ${update.campaignId} budget ${update.campaignBudgetId} ` +
      `to ₹${update.newDailyBudget / 1_000_000} daily. ` +
      `Implement with CampaignBudgetService.MutateCampaignBudgets.`
    )
  }

  /**
   * Create a Responsive Search Ad.
   * Maps to: AdGroupAdService.MutateAdGroupAds
   */
  async createResponsiveSearchAd(input: GoogleRsaInput): Promise<{ ok: boolean; adId: string }> {
    // TODO: Implement Google Ads API call
    // Use google-ads-api client: customer.adGroupAds.create({ ... })
    // Ad type: RESPONSIVE_SEARCH_AD with headlines[] and descriptions[]
    throw new Error(
      `[GoogleAdsGateway] createResponsiveSearchAd not implemented. ` +
      `Would create RSA in ad group ${input.adGroupId} with ${input.headlines.length} headlines. ` +
      `Implement with AdGroupAdService.MutateAdGroupAds.`
    )
  }

  /**
   * Fetch campaign performance metrics.
   * Maps to: GoogleAdsService.SearchStream with GAQL query
   */
  async getCampaignMetrics(
    campaignId: string,
    dateRange: { start: string; end: string },
  ): Promise<GoogleCampaignMetrics> {
    // TODO: Implement Google Ads API call
    // GAQL: SELECT campaign.id, metrics.cost_micros, metrics.impressions, ...
    //       FROM campaign WHERE campaign.id = {campaignId}
    //       AND segments.date BETWEEN '{start}' AND '{end}'
    throw new Error(
      `[GoogleAdsGateway] getCampaignMetrics not implemented. ` +
      `Would fetch metrics for campaign ${campaignId}. ` +
      `Implement with GoogleAdsService.SearchStream GAQL query.`
    )
  }

  /** Pause a Google Ads campaign. Maps to: CampaignService.MutateCampaigns { status: PAUSED } */
  async pauseCampaign(campaignId: string): Promise<{ ok: boolean }> {
    throw new Error(
      `[GoogleAdsGateway] pauseCampaign not implemented. ` +
      `Would pause campaign ${campaignId}. Implement with CampaignService.MutateCampaigns.`
    )
  }

  /** Resume a Google Ads campaign. Maps to: CampaignService.MutateCampaigns { status: ENABLED } */
  async resumeCampaign(campaignId: string): Promise<{ ok: boolean }> {
    throw new Error(
      `[GoogleAdsGateway] resumeCampaign not implemented. ` +
      `Would resume campaign ${campaignId}. Implement with CampaignService.MutateCampaigns.`
    )
  }
}
