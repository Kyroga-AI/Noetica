'use client'

/**
 * micStream — one shared microphone MediaStream for the whole app.
 *
 * WKWebView (unlike Chrome) does not persist per-stream mic grants, so every
 * `getUserMedia({audio:true})` re-fires the OS microphone gate. The voice code
 * used to acquire a fresh stream per utterance and stop all tracks when done,
 * which re-prompted the user constantly. This module acquires the stream ONCE,
 * holds it at module scope, and hands the SAME stream to every consumer. Tracks
 * are stopped only on real app teardown (releaseMicStream / pagehide), never
 * after an individual utterance — so the OS prompt appears at most once per launch.
 */

export type MicPermissionState = 'granted' | 'prompt' | 'denied' | 'unknown'

/** Thrown when the mic grant is already denied, so callers can show a clear message. */
export class MicPermissionDeniedError extends Error {
  constructor() {
    super('Microphone access denied — enable it in System Settings › Privacy & Security › Microphone.')
    this.name = 'MicPermissionDeniedError'
  }
}

let sharedStream: MediaStream | null = null
let acquiring: Promise<MediaStream> | null = null
let teardownBound = false

function streamIsLive(s: MediaStream | null): s is MediaStream {
  return !!s && s.getAudioTracks().some((t) => t.readyState === 'live')
}

/** Query the mic permission without triggering a prompt. 'unknown' if unsupported. */
export async function queryMicPermission(): Promise<MicPermissionState> {
  try {
    const perms = typeof navigator !== 'undefined' ? navigator.permissions : undefined
    if (!perms?.query) return 'unknown'
    // 'microphone' is a valid PermissionName at runtime but missing from the TS union.
    const status = await perms.query({ name: 'microphone' as PermissionName })
    return status.state as MicPermissionState
  } catch {
    return 'unknown'
  }
}

function bindTeardownOnce() {
  if (teardownBound || typeof window === 'undefined') return
  teardownBound = true
  window.addEventListener('pagehide', releaseMicStream)
  window.addEventListener('beforeunload', releaseMicStream)
}

/**
 * Get the shared mic stream, acquiring it once. Reuses the held stream if live.
 * Gates on the permission state first: reuses when granted, prompts once when
 * 'prompt', throws MicPermissionDeniedError when already denied.
 */
export async function getMicStream(constraints: MediaStreamConstraints = { audio: true }): Promise<MediaStream> {
  if (streamIsLive(sharedStream)) return sharedStream
  // Set the in-flight guard SYNCHRONOUSLY (before any await) so concurrent callers
  // share one acquisition instead of each firing getUserMedia (and each prompting).
  if (acquiring) return acquiring

  acquiring = (async () => {
    if ((await queryMicPermission()) === 'denied') throw new MicPermissionDeniedError()
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      throw new Error('Microphone is not available in this environment.')
    }
    const stream = await navigator.mediaDevices.getUserMedia(constraints)
    sharedStream = stream
    bindTeardownOnce()
    // If the OS/user revokes the grant mid-session (track 'ended'), drop the cached
    // ref so the next request re-acquires instead of handing out a dead stream.
    stream.getAudioTracks().forEach((t) =>
      t.addEventListener('ended', () => { if (sharedStream === stream) sharedStream = null })
    )
    return stream
  })()

  try {
    return await acquiring
  } finally {
    acquiring = null
  }
}

/** True if a live shared stream is currently held. */
export function hasLiveMicStream(): boolean {
  return streamIsLive(sharedStream)
}

/** Stop and drop the shared stream. Call only on real app teardown / voice-off. */
export function releaseMicStream(): void {
  if (sharedStream) {
    sharedStream.getTracks().forEach((t) => t.stop())
    sharedStream = null
  }
}
