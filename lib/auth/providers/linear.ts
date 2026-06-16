import type { ConnectorAuthState } from '../types'
import { makePkceParams } from '../pkce'

// ─── OAuth ────────────────────────────────────────────────────────────────────

const PENDING_KEY = 'noetica-oauth-pending-linear'
const LINEAR_SCOPES = 'read'

export async function initiateLinearOAuth(clientId: string, redirectUri: string): Promise<void> {
  const { codeVerifier, codeChallenge, state } = await makePkceParams()
  sessionStorage.setItem(PENDING_KEY, JSON.stringify({ codeVerifier, state }))

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: LINEAR_SCOPES,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  })
  window.open(`https://linear.app/oauth/authorize?${params.toString()}`, '_blank', 'width=520,height=680')
}

export async function exchangeLinearCode(
  code: string,
  clientId: string,
  redirectUri: string
): Promise<ConnectorAuthState> {
  const pending = sessionStorage.getItem(PENDING_KEY)
  if (!pending) throw new Error('No pending Linear OAuth session')
  const { codeVerifier } = JSON.parse(pending) as { codeVerifier: string; state: string }
  sessionStorage.removeItem(PENDING_KEY)

  const body = new URLSearchParams({
    client_id: clientId,
    code,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
    code_verifier: codeVerifier,
  })

  const res = await fetch('/api/oauth/linear/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })

  if (!res.ok) throw new Error(`Linear token exchange failed: ${await res.text()}`)

  const data = await res.json() as {
    access_token: string
    token_type: string
    scope: string
    expires_in?: number
    error?: string
  }

  if (data.error) throw new Error(`Linear error: ${data.error}`)

  const viewer = await fetchLinearViewer(data.access_token)

  return {
    status: 'connected',
    accessToken: data.access_token,
    scope: data.scope,
    expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : undefined,
    connectedAt: new Date().toISOString(),
    userInfo: {
      name: viewer.name,
      email: viewer.email,
      login: viewer.displayName,
    },
  }
}

// ─── GraphQL helper ───────────────────────────────────────────────────────────

async function linearGql<T>(token: string, query: string, variables?: Record<string, unknown>): Promise<T> {
  const res = await fetch('https://api.linear.app/graphql', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  })
  if (!res.ok) throw new Error(`Linear API ${res.status}`)
  const json = await res.json() as { data?: T; errors?: Array<{ message: string }> }
  if (json.errors?.length) throw new Error(json.errors[0].message)
  if (!json.data) throw new Error('No data returned from Linear')
  return json.data
}

// ─── API types ────────────────────────────────────────────────────────────────

export type LinearViewer = {
  id: string
  name: string
  displayName: string
  email: string
}

export type LinearIssue = {
  id: string
  identifier: string
  title: string
  description?: string
  priority: number
  priorityLabel: string
  state: { name: string; color: string; type: string }
  project?: { id: string; name: string; color?: string }
  team: { id: string; name: string; key: string }
  dueDate?: string
  updatedAt: string
  url: string
}

export type LinearTeam = {
  id: string
  name: string
  key: string
  issueCount: number
}

// ─── API queries ──────────────────────────────────────────────────────────────

async function fetchLinearViewer(token: string): Promise<LinearViewer> {
  const data = await linearGql<{ viewer: LinearViewer }>(token, `
    query { viewer { id name displayName email } }
  `)
  return data.viewer
}

export async function fetchLinearMyIssues(token: string): Promise<LinearIssue[]> {
  const data = await linearGql<{ viewer: { assignedIssues: { nodes: LinearIssue[] } } }>(token, `
    query {
      viewer {
        assignedIssues(
          filter: { state: { type: { nin: ["completed", "cancelled"] } } }
          orderBy: updatedAt
          first: 50
        ) {
          nodes {
            id identifier title description priority priorityLabel
            updatedAt url dueDate
            state { name color type }
            project { id name color }
            team { id name key }
          }
        }
      }
    }
  `)
  return data.viewer.assignedIssues.nodes
}

export async function fetchLinearTeams(token: string): Promise<LinearTeam[]> {
  const data = await linearGql<{ teams: { nodes: LinearTeam[] } }>(token, `
    query {
      teams(first: 20) {
        nodes { id name key issueCount }
      }
    }
  `)
  return data.teams.nodes
}

export async function fetchLinearTeamIssues(token: string, teamId: string): Promise<LinearIssue[]> {
  const data = await linearGql<{ team: { issues: { nodes: LinearIssue[] } } }>(token, `
    query($teamId: String!) {
      team(id: $teamId) {
        issues(
          filter: { state: { type: { nin: ["completed", "cancelled"] } } }
          orderBy: updatedAt
          first: 50
        ) {
          nodes {
            id identifier title description priority priorityLabel
            updatedAt url dueDate
            state { name color type }
            project { id name color }
            team { id name key }
          }
        }
      }
    }
  `, { teamId })
  return data.team.issues.nodes
}
