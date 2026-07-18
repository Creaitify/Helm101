import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider, useTheme } from '@/lib/theme'

function Probe() {
  const { theme, toggle } = useTheme()
  return <button onClick={toggle}>theme:{theme}</button>
}

describe('theme', () => {
  it('defaults to dark and toggles', async () => {
    render(<ThemeProvider><Probe /></ThemeProvider>)
    expect(screen.getByRole('button').textContent).toBe('theme:dark')
    await userEvent.click(screen.getByRole('button'))
    expect(screen.getByRole('button').textContent).toBe('theme:light')
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
  })
})
