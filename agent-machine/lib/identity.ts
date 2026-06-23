/**
 * identity — the ONE source of the current user's identity.
 *
 * The product was hardcoded to a single developer ('Michael Heller' / michael@socioprophet.ai) in the
 * GAIA twin, the superconscious system prompt, and the UI — so EVERY install shipped as that person's
 * digital twin, and a friend's install "came with all my info." This resolves identity per-machine from
 * ~/.noetica/identity.json (or env), defaulting to a NEUTRAL, non-personal identity on a fresh install.
 * Nothing personal is baked into source; each user is themselves.
 */
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

export interface UserIdentity { displayName: string; email: string; slug: string }

const IDENTITY_PATH = path.join(os.homedir(), '.noetica', 'identity.json')

// A fresh install is NOT anyone in particular until the user sets their profile.
const DEFAULT_IDENTITY: UserIdentity = { displayName: 'You', email: '', slug: 'user' }

function slugify(name: string): string {
  const s = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
  return s || 'user'
}

let _cache: UserIdentity | null = null

/** The current user's identity. Precedence: env (NOETICA_USER_NAME/EMAIL) > ~/.noetica/identity.json > neutral default. */
export function getUserIdentity(): UserIdentity {
  if (_cache) return _cache
  let id: UserIdentity = { ...DEFAULT_IDENTITY }
  try {
    const raw = JSON.parse(fs.readFileSync(IDENTITY_PATH, 'utf8')) as Partial<UserIdentity>
    id = {
      displayName: raw.displayName?.trim() || DEFAULT_IDENTITY.displayName,
      email: raw.email?.trim() || '',
      slug: raw.slug?.trim() || (raw.displayName ? slugify(raw.displayName) : DEFAULT_IDENTITY.slug),
    }
  } catch { /* no identity file yet — neutral default */ }
  const envName = process.env['NOETICA_USER_NAME']?.trim()
  const envEmail = process.env['NOETICA_USER_EMAIL']?.trim()
  if (envName) { id.displayName = envName; id.slug = slugify(envName) }
  if (envEmail) id.email = envEmail
  _cache = id
  return id
}

/** Persist (part of) the user's identity to ~/.noetica/identity.json and refresh the cache. */
export function setUserIdentity(partial: Partial<UserIdentity>): UserIdentity {
  const cur = getUserIdentity()
  const displayName = partial.displayName?.trim() || cur.displayName
  const next: UserIdentity = {
    displayName,
    email: (partial.email ?? cur.email).trim(),
    slug: partial.slug?.trim() || slugify(displayName),
  }
  try {
    fs.mkdirSync(path.dirname(IDENTITY_PATH), { recursive: true })
    fs.writeFileSync(IDENTITY_PATH, JSON.stringify(next, null, 2))
  } catch { /* best-effort */ }
  _cache = next
  return next
}

/** True while the identity is still the neutral default (no real user has set up a profile). */
export function isDefaultIdentity(): boolean {
  const id = getUserIdentity()
  return id.displayName === DEFAULT_IDENTITY.displayName && !id.email
}

/** GAIA twin / subject URNs derived from the identity slug (was hardcoded to ':michael:'). */
export function userTwinId(): string { return `urn:gaia:twin:${getUserIdentity().slug}:0001` }
export function userSubjectId(): string { return `urn:gaia:subject:${getUserIdentity().slug}:0001` }

/** For prompts: the user's name, or a neutral 'the user' when no real profile is set. */
export function promptUserName(): string {
  return isDefaultIdentity() ? 'the user' : getUserIdentity().displayName
}

/** Test seam: drop the cache so a test can change env/file and re-read. */
export function _resetIdentityCache(): void { _cache = null }
