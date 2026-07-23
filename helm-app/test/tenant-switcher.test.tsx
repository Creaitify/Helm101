import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const refresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))

import { TenantSwitcher } from '@/components/shell/TenantSwitcher'
import type { SwitchableTenant } from '@/lib/types'

const tenants: SwitchableTenant[] = [
  { tenantId: '11111111-1111-1111-1111-111111111111', slug: 'finnovate', name: 'Finnovate' },
  { tenantId: '22222222-2222-2222-2222-222222222222', slug: 'zephyr', name: 'Zephyr' },
]

describe('TenantSwitcher', () => {
  beforeEach(() => {
    refresh.mockClear()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))
  })

  it('POSTs the selected tenant UUID, not the slug', async () => {
    render(<TenantSwitcher tenants={tenants} activeId={tenants[0].tenantId} />)
    fireEvent.change(screen.getByRole('combobox', { name: /active workspace/i }), {
      target: { value: tenants[1].tenantId },
    })
    await waitFor(() => expect(refresh).toHaveBeenCalled())
    expect(fetch).toHaveBeenCalledWith(
      '/api/tenant/switch',
      expect.objectContaining({
        body: JSON.stringify({ tenantId: tenants[1].tenantId }),
      }),
    )
  })

  it('renders option values as UUIDs, not slugs (mutation guard)', () => {
    render(<TenantSwitcher tenants={tenants} activeId={tenants[0].tenantId} />)
    const options = screen.getAllByRole('option') as HTMLOptionElement[]
    expect(options.map((o) => o.value)).toEqual(tenants.map((t) => t.tenantId))
  })
})
