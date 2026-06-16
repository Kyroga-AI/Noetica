import type { ConnectorAuthState } from '../types'
import { makePkceParams } from '../pkce'

// ─── Slack API types ──────────────────────────────────────────────────────────

export type SlackChannel = {
  id: string
  name: string
  isMember: boolean
  isPrivate: boolean
  numMembers: number
  topic?: string
  purpose?: string
  unreadCount?: number
}

export type SlackMessage = {
  ts: string
  userId: string
  userName?: string
  text: string
  reactions?: Array<{ name: string; count: number }>
}

// ─── Slack API helpers ────────────────────────────────────────────────────────

async function slackGet<T>(path: string, token: string, params?: Record<string, string>): Promise<T> {
  const url = new URL(`https://slack.com/api/${path}`)
  if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v))
  const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) throw new Error(`Slack API ${path} ${res.status}`)
  const data = await res.json() as { ok: boolean; error?: string } & T
  if (!data.ok) throw new Error(`Slack error on ${path}: ${data.error ?? 'unknown'}`)
  return data
}

export async function fetchSlackChannels(token: string): Promise<SlackChannel[]> {
  const data = await slackGet<{
    channels: Array<{
      id: string; name: string; is_member: boolean; is_private: boolean
      num_members: number; topic?: { value: string }; purpose?: { value: string }
      unread_count?: number
    }>
  }>('conversations.list', token, { limit: '100', exclude_archived: 'true', types: 'public_channel,private_channel' })

  return data.channels.map((c) => ({
    id: c.id,
    name: c.name,
    isMember: c.is_member,
    isPrivate: c.is_private,
    numMembers: c.num_members,
    topic: c.topic?.value || undefined,
    purpose: c.purpose?.value || undefined,
    unreadCount: c.unread_count,
  }))
}

export async function fetchSlackChannelHistory(token: string, channelId: string, limit = 30): Promise<SlackMessage[]> {
  const data = await slackGet<{
    messages: Array<{
      ts: string; user?: string; text: string; bot_id?: string; username?: string
      reactions?: Array<{ name: string; count: number }>
    }>
  }>('conversations.history', token, { channel: channelId, limit: String(limit) })

  return data.messages.map((m) => ({
    ts: m.ts,
    userId: m.user ?? m.bot_id ?? 'unknown',
    userName: m.username,
    text: m.text,
    reactions: m.reactions,
  }))
}

export async function fetchSlackUserNames(token: string, userIds: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  await Promise.allSettled(
    [...new Set(userIds)].filter((id) => id !== 'unknown').map(async (id) => {
      try {
        const data = await slackGet<{ user: { real_name?: string; name: string } }>('users.info', token, { user: id })
        map.set(id, data.user.real_name ?? data.user.name)
      } catch { /* skip */ }
    })
  )
  return map
}

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
