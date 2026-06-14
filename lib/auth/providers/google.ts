import type { ConnectorAuthState } from '../types'
import { makePkceParams } from '../pkce'

export const GOOGLE_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/calendar.readonly',
].join(' ')

const PENDING_KEY = 'noetica-oauth-pending-google'

export async function initiateGoogleOAuth(clientId: string, redirectUri: string): Promise<void> {
  const { codeVerifier, codeChallenge, state } = await makePkceParams()
  // Persist PKCE verifier + state for token exchange after redirect
  sessionStorage.setItem(PENDING_KEY, JSON.stringify({ codeVerifier, state }))

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: GOOGLE_SCOPES,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    access_type: 'offline',
    prompt: 'consent',
  })
  window.open(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`, '_blank', 'width=520,height=620')
}

export async function exchangeGoogleCode(
  code: string,
  clientId: string,
  redirectUri: string
): Promise<ConnectorAuthState> {
  const pending = sessionStorage.getItem(PENDING_KEY)
  if (!pending) throw new Error('No pending Google OAuth session')
  const { codeVerifier } = JSON.parse(pending) as { codeVerifier: string; state: string }
  sessionStorage.removeItem(PENDING_KEY)

  const body = new URLSearchParams({
    code,
    client_id: clientId,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
    code_verifier: codeVerifier,
  })

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Google token exchange failed: ${err}`)
  }

  const data = await res.json() as {
    access_token: string
    refresh_token?: string
    expires_in: number
    scope: string
    id_token?: string
  }

  // Fetch user info
  const userRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${data.access_token}` },
  })
  const userInfo = userRes.ok ? await userRes.json() as { name?: string; email?: string; picture?: string } : {}

  return {
    status: 'connected',
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000,
    scope: data.scope,
    connectedAt: new Date().toISOString(),
    userInfo: {
      name: userInfo.name,
      email: userInfo.email,
      avatar: userInfo.picture,
    },
  }
}

export async function refreshGoogleToken(
  refreshToken: string,
  clientId: string
): Promise<Partial<ConnectorAuthState>> {
  const body = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: clientId,
    grant_type: 'refresh_token',
  })

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })

  if (!res.ok) throw new Error('Google token refresh failed')

  const data = await res.json() as { access_token: string; expires_in: number }
  return {
    accessToken: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  }
}
