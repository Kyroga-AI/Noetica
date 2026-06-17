import type { Metadata } from 'next'
import { SettingsProvider } from '@/lib/settings/context'
import { ThemeProvider } from '@/contexts/ThemeContext'
import { ConnectorAuthProvider } from '@/lib/auth/context'
import '@/styles/globals.css'

export const metadata: Metadata = {
  title: 'Noetica',
  description: 'Governed chat surface for the SocioProphet / SourceOS stack'
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" data-theme="claude" suppressHydrationWarning>
      <head>
        {/* Override data-theme from localStorage if user has saved a preference */}
        <script dangerouslySetInnerHTML={{ __html: `(function(){try{var t=localStorage.getItem('noetica-theme');if(t&&['claude','navy','light'].includes(t))document.documentElement.setAttribute('data-theme',t)}catch(e){}})()` }} />
      </head>
      <body>
        <ThemeProvider>
          <SettingsProvider>
            <ConnectorAuthProvider>{children}</ConnectorAuthProvider>
          </SettingsProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
