import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SlideOver } from '@/components/ui/SlideOver'
import { Tabs } from '@/components/ui/Tabs'
import { StatusPill } from '@/components/ui/StatusPill'

describe('operate ui', () => {
  it('SlideOver shows title when open and hides when closed', () => {
    const { rerender } = render(<SlideOver open title="Detail" onClose={() => {}}>body</SlideOver>)
    expect(screen.getByText('Detail')).toBeInTheDocument()
    rerender(<SlideOver open={false} title="Detail" onClose={() => {}}>body</SlideOver>)
    expect(screen.queryByText('Detail')).not.toBeInTheDocument()
  })
  it('Tabs calls onChange with the clicked tab id', async () => {
    const onChange = vi.fn()
    render(<Tabs tabs={[{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }]} active="a" onChange={onChange} />)
    await userEvent.click(screen.getByText('B'))
    expect(onChange).toHaveBeenCalledWith('b')
  })
  it('StatusPill accepts disconnected', () => {
    render(<StatusPill status="disconnected" />)
    expect(screen.getByText('disconnected')).toBeInTheDocument()
  })
})
