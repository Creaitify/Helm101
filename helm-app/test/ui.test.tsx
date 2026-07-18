import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Button } from '@/components/ui/Button'
import { StatusPill } from '@/components/ui/StatusPill'

describe('ui primitives', () => {
  it('Button renders children and is a button', () => {
    render(<Button>New Campaign</Button>)
    expect(screen.getByRole('button', { name: 'New Campaign' })).toBeInTheDocument()
  })
  it('StatusPill shows status text', () => {
    render(<StatusPill status="healthy" />)
    expect(screen.getByText('healthy')).toBeInTheDocument()
  })
})
