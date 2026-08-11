'use client'
import { createContext, useContext, useState, useCallback, ReactNode } from 'react'

const Ctx = createContext<{ toast: (msg: string) => void }>({ toast: () => {} })
export const useToast = () => useContext(Ctx)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<{ id: number; msg: string }[]>([])
  const toast = useCallback((msg: string) => {
    const id = items.length + Math.floor(performance.now())
    setItems((xs) => [...xs, { id, msg }])
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), 2600)
  }, [items.length])
  return (
    <Ctx.Provider value={{ toast }}>
      {children}
      <div className="toast-stack">
        {items.map((i) => <div key={i.id} className="toast">{i.msg}</div>)}
      </div>
    </Ctx.Provider>
  )
}
