import type { Citation } from './types'

export function cannedReply(prompt: string): { text: string; citations: Citation[] } {
  const text = `Here's a grounded read based on Finnovate's last 30 days. ${prompt.trim().replace(/\s+/g, ' ').slice(0, 80)} — blended CAC is ₹412 (down 12%), checkups are up 8.3%, and Meta Retargeting is your most efficient source at ₹341 CAC. I'd shift spend toward it and pause Search · Competitor (₹550 CAC).`
  const citations: Citation[] = [
    { label: 'CAC · 30d', source: 'Analytics · Finnovate' },
    { label: 'FHC · Retargeting', source: 'Campaigns' },
    { label: 'Search · Competitor', source: 'Campaigns' },
  ]
  return { text, citations }
}
