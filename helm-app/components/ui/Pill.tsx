export function Pill({ variant, children }: { variant?: 'v' | 'e' | 'r'; children: React.ReactNode }) {
  return <span className={`pill${variant ? ` ${variant}` : ''}`}>{children}</span>
}
