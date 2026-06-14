import type { ConnectorAuthState } from '../types'
import { makePkceParams } from '../pkce'

export const SLACK_SCOPES = 'channels:read,channels:history,im:read,im:history,users:read,users.profile:read'
export const SLACK_USER_SCOPES = 'channels:read,channels:history,im:read,users.profile:read'

const PENDING_KEY = 'noetica-oauth-pending-slack'

export async function initiateSlackOAuth(clientId: string, redirectUri: string): Promise<void> {
  const { codeVerifier, codeChallenge, state } = await makePkceParams()
  sessionStorage.setItem(PENDING_KEY, JSON.stringify({ codeVerifier, state }))

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: SLACK_SCOPES,
    user_scope: SLACK_USER_SCOPES,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  })
  window.open(`https://slack.com/oauth/v2/authorize?${params.toString()}`, '_blank', 'width=520,height=680')
}

export async function exchangeSlackCode(
  code: string,
  clientId: string,
  redirectUri: string
): Promise<ConnectorAuthState> {
  const pending = sessionStorage.getItem(PENDING_KEY)
  if (!pending) throw new Error('No pending Slack OAuth session')
  const { codeVerifier } = JSON.parse(pending) as { codeVerifier: string; state: string }
  sessionStorage.removeItem(PENDING_KEY)

  const body = new URLSearchParams({
    client_id: clientId,
    code,
    redirect_uri: redirectUri,
    code_verifier: codeVerifier,
  })

  // Slack token exchange needs proxy (CORS)
  const res = await fetch('/api/oauth/slack/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })

  if (!res.ok) throw new Error(`Slack token exchange failed: ${await res.text()}`)

  const data = await res.json() as {
    ok: boolean
    access_token: string
    scope: string
    authed_user?: { id: string; access_token?: string }
    team?: { name?: string; id: string }
    error?: string
  }

  if (!data.ok) throw new Error(`Slack error: ${data.error ?? 'unknown'}`)

  const identityRes = await fetch('https://slack.com/api/openid.connect.userInfo', {
    headers: { Authorization: `Bearer ${data.access_token}` },
  })
  const identity = identityRes.ok
    ? await identityRes.json() as { name?: string; email?: string; picture?: string }
    : {}

  return {
    status: 'connected',
    accessToken: data.access_token,
    scope: data.scope,
    connectedAt: new Date().toISOString(),
    userInfo: {
      name: identity.name,
      email: identity.email,
      avatar: identity.picture,
    },
  }
}
