import type { Direction } from './types'

export function compact(n: number): string {
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B'
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M'
  if (n >= 1e3) return Math.round(n / 1e3) + 'K'
  return String(n)
}
export function inr(n: number): string {
  if (n >= 1e7) return '₹' + (n / 1e7).toFixed(2) + 'Cr'
  if (n >= 1e5) return '₹' + (n / 1e5).toFixed(2) + 'L'
  if (n >= 1e3) return '₹' + Math.round(n / 1e3) + 'K'
  return '₹' + n
}
export function pct(n: number, digits = 2): string { return n.toFixed(digits) + '%' }
export function deltaDirection(current: number, prior: number, lowerIsBetter = false): Direction {
  if (current === prior) return 'flat'
  const improved = lowerIsBetter ? current < prior : current > prior
  return improved ? 'up' : 'down'
}
