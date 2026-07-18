'use client'
import { createContext, useContext, useState, ReactNode } from 'react'

const Ctx = createContext<{ pending: number; setPending: (n: number) => void }>({ pending: 3, setPending: () => {} })
export const useApprovals = () => useContext(Ctx)

export function ApprovalsProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState(3)
  return <Ctx.Provider value={{ pending, setPending }}>{children}</Ctx.Provider>
}
