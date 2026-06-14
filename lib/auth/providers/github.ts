import type { ConnectorAuthState } from '../types'
import { makePkceParams } from '../pkce'

export const GITHUB_SCOPES = 'read:user user:email repo'

const PENDING_KEY = 'noetica-oauth-pending-github'

export async function initiateGithubOAuth(clientId: string, redirectUri: string): Promise<void> {
  const { codeVerifier, codeChallenge, state } = await makePkceParams()
  sessionStorage.setItem(PENDING_KEY, JSON.stringify({ codeVerifier, state }))

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: GITHUB_SCOPES,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  })
  window.open(`https://github.com/login/oauth/authorize?${params.toString()}`, '_blank', 'width=520,height=620')
}

export async function exchangeGithubCode(
  code: string,
  clientId: string,
  redirectUri: string
): Promise<ConnectorAuthState> {
  const pending = sessionStorage.getItem(PENDING_KEY)
  if (!pending) throw new Error('No pending GitHub OAuth session')
  const { codeVerifier } = JSON.parse(pending) as { codeVerifier: string; state: string }
  sessionStorage.removeItem(PENDING_KEY)

  // GitHub token exchange must go through a server-side proxy to avoid CORS.
  // In Tauri mode this works directly; in browser mode use a local Next.js route.
  const body = new URLSearchParams({
    client_id: clientId,
    code,
    redirect_uri: redirectUri,
    code_verifier: codeVerifier,
  })

  const proxyUrl = '/api/oauth/github/token'
  const res = await fetch(proxyUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })

  if (!res.ok) throw new Error(`GitHub token exchange failed: ${await res.text()}`)

  const data = await res.json() as { access_token: string; scope: string; token_type: string }

  const userRes = await fetch('https://api.github.com/user', {
    headers: { Authorization: `Bearer ${data.access_token}`, Accept: 'application/vnd.github+json' },
  })
  const user = userRes.ok ? await userRes.json() as { name?: string; email?: string; avatar_url?: string; login?: string } : {}

  return {
    status: 'connected',
    accessToken: data.access_token,
    scope: data.scope,
    connectedAt: new Date().toISOString(),
    userInfo: {
      name: user.name ?? user.login,
      email: user.email ?? undefined,
      avatar: user.avatar_url,
      login: user.login,
    },
  }
}
