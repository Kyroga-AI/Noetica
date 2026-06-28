/**
 * ical.ts — a dependency-free iCalendar (RFC 5545) parser for the sovereign Calendar. Subscribe to any .ics
 * feed (CalDAV export, Google/Apple public calendar, holidays, a team feed) and read its events — no Google
 * Calendar, no account, just the open standard over HTTP. Handles line unfolding, escaping, and the common
 * VEVENT fields; enough to render an agenda. Full CalDAV write is a later layer on top of this read foundation.
 */

export interface CalEvent {
  uid: string
  summary: string
  start: string        // ISO 8601 (UTC where the source gives a Z/zoned time; date-only kept as YYYY-MM-DD)
  end?: string
  location?: string
  description?: string
  allDay: boolean
}

/** Unfold folded lines (RFC 5545 §3.1: a CRLF + space/tab continues the previous line). */
function unfold(text: string): string[] {
  return text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').split('\n')
}

/** Decode the TEXT escaping (\\n \\, \\; \\,). */
function unescapeText(v: string): string {
  return v.replace(/\\n/gi, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\')
}

/** Parse an iCalendar DATE or DATE-TIME value into an ISO string + whether it's an all-day (date-only) value. */
function parseDate(raw: string, params: string): { iso: string; allDay: boolean } {
  const v = raw.trim()
  // DATE form: 20260623 (VALUE=DATE or 8 digits, no T)
  if (/^\d{8}$/.test(v) || /VALUE=DATE(?!-TIME)/i.test(params)) {
    return { iso: `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`, allDay: true }
  }
  // DATE-TIME: 20260623T140000Z (UTC) or local
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/.exec(v)
  if (m) {
    const [, y, mo, d, h, mi, s, z] = m
    return { iso: `${y}-${mo}-${d}T${h}:${mi}:${s}${z ? 'Z' : ''}`, allDay: false }
  }
  return { iso: v, allDay: false }
}

/** Parse an iCalendar document into events. Never throws — malformed events are skipped. */
export function parseICal(text: string): CalEvent[] {
  const lines = unfold(text)
  const events: CalEvent[] = []
  let cur: Partial<CalEvent> | null = null
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { cur = { allDay: false }; continue }
    if (line === 'END:VEVENT') {
      if (cur && (cur.summary || cur.uid)) {
        events.push({ uid: cur.uid || `ev-${events.length}`, summary: cur.summary || '(no title)', start: cur.start || '', end: cur.end, location: cur.location, description: cur.description, allDay: !!cur.allDay })
      }
      cur = null; continue
    }
    if (!cur) continue
    const ci = line.indexOf(':')
    if (ci < 0) continue
    const head = line.slice(0, ci)
    const value = line.slice(ci + 1)
    const name = head.split(';')[0]!.toUpperCase()
    const params = head.slice(name.length)
    switch (name) {
      case 'UID': cur.uid = value.trim(); break
      case 'SUMMARY': cur.summary = unescapeText(value); break
      case 'LOCATION': cur.location = unescapeText(value); break
      case 'DESCRIPTION': cur.description = unescapeText(value); break
      case 'DTSTART': { const p = parseDate(value, params); cur.start = p.iso; cur.allDay = p.allDay; break }
      case 'DTEND': { cur.end = parseDate(value, params).iso; break }
      default: break
    }
  }
  // Chronological by start.
  return events.sort((a, b) => a.start.localeCompare(b.start))
}
