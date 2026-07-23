'use client'
import { createContext, useContext, ReactNode } from 'react'
import type { Tenant, Role } from './types'

export interface TenantValue { tenant: Tenant; role: Role }

/** Fallback for tests and for local development without a database. */
const FALLBACK: TenantValue = {
  tenant: { id: 'finnovate', name: 'Finnovate', region: 'ap-south-1', env: 'prod' },
  role: 'master',
}

const Ctx = createContext<TenantValue>(FALLBACK)

export function TenantProvider({ value, children }: { value?: TenantValue; children: ReactNode }) {
  return <Ctx.Provider value={value ?? FALLBACK}>{children}</Ctx.Provider>
}

export const useTenant = () => useContext(Ctx)
