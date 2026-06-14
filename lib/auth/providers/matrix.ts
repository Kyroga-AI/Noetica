import type { MatrixAuthState } from '../types'

export async function loginMatrix(
  homeserver: string,
  username: string,
  password: string
): Promise<MatrixAuthState> {
  const base = homeserver.replace(/\/$/, '')
  const res = await fetch(`${base}/_matrix/client/v3/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'm.login.password',
      identifier: { type: 'm.id.user', user: username },
      password,
      device_id: 'Noetica',
      initial_device_display_name: 'Noetica Desktop',
    }),
  })

  if (!res.ok) {
    const err = await res.json() as { errcode?: string; error?: string }
    throw new Error(err.error ?? `Matrix login failed (${res.status})`)
  }

  const data = await res.json() as {
    access_token: string
    device_id: string
    user_id: string
    home_server: string
  }

  return {
    status: 'connected',
    accessToken: data.access_token,
    homeserver: base,
    userId: data.user_id,
    deviceId: data.device_id,
    connectedAt: new Date().toISOString(),
    userInfo: {
      login: data.user_id,
      name: username,
    },
  }
}

export async function logoutMatrix(homeserver: string, accessToken: string): Promise<void> {
  const base = homeserver.replace(/\/$/, '')
  await fetch(`${base}/_matrix/client/v3/logout`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: '{}',
  })
}

export type MatrixRoom = {
  roomId: string
  name: string
  topic?: string
  unreadCount?: number
}

export async function fetchMatrixRooms(homeserver: string, accessToken: string): Promise<MatrixRoom[]> {
  const base = homeserver.replace(/\/$/, '')
  const res = await fetch(`${base}/_matrix/client/v3/joined_rooms`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) throw new Error('Failed to fetch Matrix rooms')

  const data = await res.json() as { joined_rooms: string[] }

  const rooms: MatrixRoom[] = await Promise.all(
    data.joined_rooms.slice(0, 20).map(async (roomId) => {
      const stateRes = await fetch(
        `${base}/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/state/m.room.name`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      )
      const nameData = stateRes.ok ? await stateRes.json() as { name?: string } : {}
      return { roomId, name: nameData.name ?? roomId }
    })
  )

  return rooms
}
