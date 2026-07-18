'use client'
import { createContext, useContext, ReactNode } from 'react'
import type { Tenant, Role } from './types'

const CURRENT: { tenant: Tenant; role: Role } = {
  tenant: { id: 'finnovate', name: 'Finnovate', region: 'ap-south-1', env: 'prod' },
  role: 'master',
}
const Ctx = createContext(CURRENT)
export function TenantProvider({ children }: { children: ReactNode }) { return <Ctx.Provider value={CURRENT}>{children}</Ctx.Provider> }
export const useTenant = () => useContext(Ctx)
