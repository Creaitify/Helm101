import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import AgentsPage from '@/app/(app)/agents/page'
import RbacPage from '@/app/(app)/rbac/page'

describe('master console', () => {
  it('agents page renders the kill switch and 8 agents', async () => {
    render(await AgentsPage())
    expect(await screen.findByText('Global Kill Switch')).toBeInTheDocument()
    expect(screen.getByText('Governor')).toBeInTheDocument()
  })
  it('rbac page renders the permission matrix', async () => {
    render(await RbacPage())
    expect(await screen.findByText('Permission Matrix')).toBeInTheDocument()
  })
})
