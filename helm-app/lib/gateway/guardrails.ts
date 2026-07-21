import type { GatewayMessage } from './types'

export interface GuardrailVerdict { allowed: boolean; sanitized: string; reasons: string[] }

const INJECTION_PATTERNS = [/ignore (all |any |the )?(previous|prior) instructions/i, /reveal (the )?(system|developer) prompt/i, /override (all )?(guardrails|policy|safety)/i]
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi
const PHONE_PATTERN = /(?<!\d)(?:\+91[\s-]?)?[6-9]\d{9}(?!\d)/g

export function sanitizeMessages(messages: readonly GatewayMessage[]): GatewayMessage[] {
  return messages.map((message) => ({ ...message, content: message.content.replace(EMAIL_PATTERN, '[redacted-email]').replace(PHONE_PATTERN, '[redacted-phone]') }))
}

export function inspectInput(messages: readonly GatewayMessage[]): GuardrailVerdict {
  const content = messages.map((message) => message.content).join('\n')
  const reasons = INJECTION_PATTERNS.filter((pattern) => pattern.test(content)).map(() => 'prompt_injection')
  const sanitized = sanitizeMessages(messages).map((message) => message.content).join('\n')
  return { allowed: reasons.length === 0, sanitized, reasons }
}

export function inspectOutput(output: string): GuardrailVerdict {
  const reasons: string[] = []
  if (/guaranteed (returns?|profit|income)/i.test(output)) reasons.push('sebi_guaranteed_return_claim')
  return { allowed: reasons.length === 0, sanitized: output.replace(EMAIL_PATTERN, '[redacted-email]').replace(PHONE_PATTERN, '[redacted-phone]'), reasons }
}
