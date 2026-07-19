'use client'

import { useEffect, useState } from 'react'
import { useConnectorAuth } from '@/lib/auth/context'
import { fetchMatrixRooms, type MatrixRoom } from '@/lib/auth/providers/matrix'
import type { MatrixAuthState } from '@/lib/auth/types'

export function MatrixPanel() {
  const { store } = useConnectorAuth()
  const matrixAuth = store.matrix as MatrixAuthState | undefined
  const isConnected = matrixAuth?.status === 'connected' && !!matrixAuth.accessToken

  const [rooms, setRooms] = useState<MatrixRoom[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!isConnected || !matrixAuth?.accessToken || !matrixAuth.homeserver) {
      setRooms([])
      return
    }
    setLoading(true)
    fetchMatrixRooms(matrixAuth.homeserver, matrixAuth.accessToken)
      .then((r) => { setRooms(r); setError('') })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed'))
      .finally(() => setLoading(false))
  }, [isConnected, matrixAuth?.accessToken, matrixAuth?.homeserver])

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-[var(--color-border-secondary)] px-4 py-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[#1d4ed8]">Matrix</div>
            <div className="mt-0.5 text-xs text-[var(--color-text-secondary)]">Workspace rooms / ChatOps</div>
          </div>
          {isConnected && (
            <span className="rounded-full bg-[var(--color-accent-bg)] px-2 py-0.5 text-[9px] font-semibold text-[var(--color-accent)]">Live</span>
          )}
        </div>
        {isConnected && matrixAuth?.userInfo?.login && (
          <div className="mt-1 text-[10px] text-[var(--color-text-tertiary)] truncate">{matrixAuth.userInfo.login}</div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {!isConnected ? (
          <div className="rounded-xl border border-dashed border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] px-3 py-4 text-center text-xs text-[var(--color-text-tertiary)]">
            Connect Matrix homeserver in Settings → Connections.
          </div>
        ) : loading ? (
          <div className="space-y-2">
            {[1,2,3].map((i) => <div key={i} className="h-10 animate-pulse rounded-xl bg-[var(--color-background-secondary)]" />)}
          </div>
        ) : error ? (
          <div className="rounded-xl border border-[#fecaca] bg-[#fef2f2] px-3 py-2 text-xs text-[#dc2626]">{error}</div>
        ) : rooms.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] px-3 py-3 text-center text-xs text-[var(--color-text-tertiary)]">
            No joined rooms.
          </div>
        ) : (
          <>
            <div className="text-xs font-semibold text-[var(--color-text-secondary)]">
              Rooms · {rooms.length}
            </div>
            {rooms.map((room) => (
              <div key={room.roomId} className="flex items-center justify-between rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-semibold text-[var(--color-text-primary)]">{room.name}</div>
                  {room.topic && (
                    <div className="truncate text-[10px] text-[var(--color-text-tertiary)]">{room.topic}</div>
                  )}
                </div>
                {(room.unreadCount ?? 0) > 0 && (
                  <span className="ml-2 shrink-0 rounded-full bg-[#1d4ed8] px-1.5 py-0.5 text-[9px] font-bold text-white">
                    {room.unreadCount}
                  </span>
                )}
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  )
}
