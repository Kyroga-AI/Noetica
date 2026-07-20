// Sidebar customization — user prefs for the command-center rail: reorder + hide. Persisted to
// localStorage; a change fires `noetica:navprefs-changed` so the rail re-reads live. Frontend-only.

const KEY = 'noetica:navprefs'

export type NavPrefs = { order: string[]; hidden: string[] }

export function loadNavPrefs(): NavPrefs {
  if (typeof window === 'undefined') return { order: [], hidden: [] }
  try {
    const p = JSON.parse(localStorage.getItem(KEY) || '{}') as Partial<NavPrefs>
    return { order: Array.isArray(p.order) ? p.order : [], hidden: Array.isArray(p.hidden) ? p.hidden : [] }
  } catch { return { order: [], hidden: [] } }
}

export function saveNavPrefs(p: NavPrefs): void {
  try { localStorage.setItem(KEY, JSON.stringify(p)) } catch { /* private mode — session-only */ }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('noetica:navprefs-changed'))
}

// Apply order + hidden to a list of {id}. Ordered items first (in the user's order), then any not
// mentioned (original order), then hidden ones filtered out.
export function applyCenterPrefs<T extends { id: string }>(all: T[], prefs: NavPrefs): T[] {
  const seen = new Set<string>()
  const out: T[] = []
  for (const id of prefs.order) {
    const c = all.find((x) => x.id === id)
    if (c && !seen.has(id)) { out.push(c); seen.add(id) }
  }
  for (const c of all) if (!seen.has(c.id)) { out.push(c); seen.add(c.id) }
  return out.filter((c) => !prefs.hidden.includes(c.id))
}
