'use client'

import { useEffect } from 'react'
import { useSearchParams } from 'next/navigation'

/**
 * OAuth redirect capture page.
 * After a provider redirects here, we store the code/state in sessionStorage
 * and notify the opener window via postMessage, then close.
 */
export default function OAuthCallbackPage() {
  const searchParams = useSearchParams()

  useEffect(() => {
    const code  = searchParams.get('code')
    const state = searchParams.get('state')
    const error = searchParams.get('error')

    const payload = { type: 'oauth_callback', code, state, error }

    // Notify opener if popup flow
    if (window.opener) {
      window.opener.postMessage(payload, window.location.origin)
      window.close()
      return
    }

    // Fallback: store in sessionStorage for the same-tab redirect flow
    sessionStorage.setItem('noetica-oauth-callback', JSON.stringify(payload))
    // Redirect back to the app
    window.location.replace('/')
  }, [searchParams])

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0f172a]">
      <div className="text-center">
        <div className="mb-4 text-sm font-semibold text-[#94a3b8]">Completing sign-in…</div>
        <div className="h-1.5 w-32 overflow-hidden rounded-full bg-[#1e293b]">
          <div className="h-full w-1/2 animate-pulse rounded-full bg-[#3b82f6]" />
        </div>
      </div>
    </div>
  )
}
