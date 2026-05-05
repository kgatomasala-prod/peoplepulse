import type { Metadata } from 'next'
import { Inter, Clash_Display } from 'next/font/google'
import './globals.css'

const inter = Inter({ subsets: ['latin'], variable: '--font-sans' })
const clash = Clash_Display({ subsets: ['latin'], variable: '--font-display' })

export const metadata: Metadata = {
  title: 'PeoplePulse',
  description: 'Smart HR. Botswana Built.',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className={`${inter.variable} ${clash.variable} antialiased`}>
        {children}
      </body>
    </html>
  )
}
