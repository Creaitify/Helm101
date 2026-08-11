export function Button({ variant = 'ghost', children, ...p }: { variant?: 'primary' | 'ghost' } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button className={`btn${variant === 'primary' ? ' primary' : ''}`} {...p}>{children}</button>
}
