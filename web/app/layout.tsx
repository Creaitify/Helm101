import './globals.css'
import { Open_Sans } from 'next/font/google'
import { ThemeProvider } from '@/lib/theme'

const openSans = Open_Sans({ subsets: ['latin'], weight: ['400','500','600','700','800'], variable: '--font-sans' })

export const metadata = { title: 'HELM — Control Plane' }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark" className={openSans.variable}>
      <body><ThemeProvider>{children}</ThemeProvider></body>
    </html>
  )
}
