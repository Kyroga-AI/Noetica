import type { Metadata } from 'next'
import { SettingsProvider } from '@/lib/settings/context'
import '@/styles/globals.css'

export const metadata: Metadata = {
  title: 'Noetica',
  description: 'Governed chat surface for the SocioProphet / SourceOS stack'
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <SettingsProvider>{children}</SettingsProvider>
      </body>
    </html>
  )
}
