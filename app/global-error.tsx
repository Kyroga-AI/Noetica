'use client'

/**
 * Root error boundary — catches errors in the root layout itself (where app/error.tsx can't reach). Must
 * render its own <html>/<body>. Last line of defense against a full white-screen.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'Inter, system-ui, sans-serif', display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center', margin: 0, background: '#0b0f17', color: '#e5e7eb' }}>
        <div style={{ maxWidth: 420, textAlign: 'center', padding: 24 }}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>Noetica hit a fatal error</div>
          <p style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>{error?.message?.slice(0, 200) ?? 'Unknown error'}</p>
          <button onClick={reset} style={{ marginTop: 16, background: '#1d4ed8', color: '#fff', border: 'none', borderRadius: 12, padding: '8px 16px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Reload</button>
        </div>
      </body>
    </html>
  )
}
