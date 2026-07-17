import type { Metadata } from 'next'
import { Manrope, IBM_Plex_Mono, Source_Serif_4 } from 'next/font/google'
import { SettingsProvider } from '@/lib/settings/context'
import { ThemeProvider } from '@/contexts/ThemeContext'
import { ConnectorAuthProvider } from '@/lib/auth/context'
import '@/styles/globals.css'

const manrope = Manrope({ subsets: ['latin'], weight: ['400', '500', '600', '700', '800'], variable: '--font-manrope' })
const plexMono = IBM_Plex_Mono({ subsets: ['latin'], weight: ['500', '600'], variable: '--font-plex-mono' })
const sourceSerif = Source_Serif_4({ subsets: ['latin'], weight: ['600', '700'], style: ['italic'], variable: '--font-source-serif' })

export const metadata: Metadata = {
  title: 'Noetica',
  description: 'Governed chat surface for the SocioProphet / SourceOS stack'
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning className={`${manrope.variable} ${plexMono.variable} ${sourceSerif.variable}`}>
      <head>
        {/* Override data-theme from localStorage if user has saved a preference */}
        <script dangerouslySetInnerHTML={{ __html: `(function(){try{var t=localStorage.getItem('noetica-theme');if(t&&['light','dark'].includes(t))document.documentElement.setAttribute('data-theme',t)}catch(e){}})()` }} />
        {/* Sidecar API shim: the packaged desktop app loads this static bundle from tauri://localhost, so a
            relative fetch('/api/...') resolves to tauri://localhost/api/... which doesn't exist. The agent-
            machine sidecar serves every /api route on 127.0.0.1:8080. In Tauri ONLY, rewrite relative /api/*
            to the sidecar so the graph panel, OAuth token exchange, and all relative-/api callers reach the
            backend. Browser dev (localhost:3737) is untouched — Next serves /api there. Runs before any fetch. */}
        <script dangerouslySetInnerHTML={{ __html: `(function(){try{var isT=location.protocol==='tauri:'||location.hostname==='tauri.localhost'||!!window.__TAURI__||!!window.__TAURI_INTERNALS__;if(!isT||window.__noeticaApiShim)return;window.__noeticaApiShim=1;var AM='http://127.0.0.1:8080';var orig=window.fetch.bind(window);window.fetch=function(input,init){try{if(typeof input==='string'){if(input.indexOf('/api/')===0)input=AM+input;}else if(input&&typeof input.url==='string'){var u=input.url;var i=u.indexOf('/api/');if(i>-1&&(u.indexOf('tauri:')===0||u.indexOf('http://tauri.localhost')===0)){input=new Request(AM+u.slice(i),input);}}}catch(e){}return orig(input,init);};}catch(e){}})()` }} />
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
