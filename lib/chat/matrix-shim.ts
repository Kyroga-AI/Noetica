/**
 * matrix-shim.ts — substrate-agnostic chat events so the same messages/commands flow to the local chat AND
 * to Matrix Workrooms. Crucially, our IRC commands map DIRECTLY onto Matrix message types — Matrix natively
 * models `/me` as the `m.emote` msgtype — so the IRC layer is already Matrix-shaped. This is the seam a
 * lightweight homeserver (Conduit) plugs into. See docs/MATRIX-integration.md for the rollout plan.
 */
export type MatrixMsgType = 'm.text' | 'm.emote' | 'm.notice'

export interface MatrixMessageEvent {
  type: 'm.room.message'
  content: { msgtype: MatrixMsgType; body: string; format?: 'org.matrix.custom.html'; formatted_body?: string }
}

/** IRC/slash command → Matrix msgtype: /me → emote, system/bot replies → notice, else text. */
export function msgTypeFor(opts: { irc?: string; system?: boolean }): MatrixMsgType {
  if (opts.irc === 'me' || opts.irc === 'shrug' || opts.irc === 'nick') return 'm.emote'
  if (opts.system) return 'm.notice'
  return 'm.text'
}

/** Build a Matrix room message event from a chat message (markdown → optional HTML body). */
export function toMatrixEvent(body: string, opts: { msgtype?: MatrixMsgType; html?: string } = {}): MatrixMessageEvent {
  const content: MatrixMessageEvent['content'] = { msgtype: opts.msgtype ?? 'm.text', body }
  if (opts.html) { content.format = 'org.matrix.custom.html'; content.formatted_body = opts.html }
  return { type: 'm.room.message', content }
}

// ── Homeserver options (lightweight, sovereign-friendly) ──
export interface HomeserverOption { name: string; lang: string; footprint: string; why: string }
export const HOMESERVER_OPTIONS: HomeserverOption[] = [
  { name: 'Conduit', lang: 'Rust', footprint: 'single binary, RocksDB/SQLite, ~tens of MB', why: 'matches our sidecar pattern (noetica-embed); embeddable, low-resource, sovereign — RECOMMENDED' },
  { name: 'conduwuit', lang: 'Rust', footprint: 'single binary (Conduit fork, active)', why: 'more actively maintained Conduit fork; same embeddable profile' },
  { name: 'Dendrite', lang: 'Go', footprint: 'single binary, Postgres/SQLite', why: 'official lightweight server; heavier than Conduit but more complete' },
  { name: 'Synapse', lang: 'Python', footprint: 'heavy (Postgres, workers)', why: 'reference impl — too heavy for an embedded/desktop substrate; AVOID for the shim' },
]

/** A connection target for the workroom substrate (bundled sidecar OR external container). */
export interface MatrixTarget { homeserver: string; deploy: 'sidecar' | 'container'; userId?: string }
export const DEFAULT_TARGET: MatrixTarget = { homeserver: 'http://127.0.0.1:6167', deploy: 'sidecar' }   // Conduit default port
