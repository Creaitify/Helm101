import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TenantProvider, useTenant } from '@/lib/tenant'

function Probe() {
  const { tenant, role } = useTenant()
  return <span data-testid="probe">{tenant.name}:{role}</span>
}

describe('TenantProvider', () => {
  it('falls back to Finnovate when no value is supplied', () => {
    render(<TenantProvider><Probe /></TenantProvider>)
    expect(screen.getByTestId('probe')).toHaveTextContent('Finnovate:master')
  })

  it('uses a server-supplied tenant and role', () => {
    const value = {
      tenant: { id: 'acme', name: 'Acme', region: 'ap-south-1', env: 'prod' },
      role: 'analyst' as const,
    }
    render(<TenantProvider value={value}><Probe /></TenantProvider>)
    expect(screen.getByTestId('probe')).toHaveTextContent('Acme:analyst')
  })
})
