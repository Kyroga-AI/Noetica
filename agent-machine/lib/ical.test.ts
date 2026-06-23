import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseICal } from './ical.js'

const SAMPLE = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'BEGIN:VEVENT',
  'UID:abc-123',
  'SUMMARY:Team sync\\, weekly',
  'DTSTART:20260623T140000Z',
  'DTEND:20260623T143000Z',
  'LOCATION:Jitsi',
  'DESCRIPTION:Discuss the\\nroadmap',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:holiday-1',
  'SUMMARY:Midsummer',
  'DTSTART;VALUE=DATE:20260621',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n')

test('parses VEVENTs with timed + all-day forms, escaping, ordering', () => {
  const evs = parseICal(SAMPLE)
  assert.equal(evs.length, 2)
  // sorted by start: 0621 (all-day) before 0623
  assert.equal(evs[0]!.uid, 'holiday-1')
  assert.equal(evs[0]!.allDay, true)
  assert.equal(evs[0]!.start, '2026-06-21')
  const sync = evs[1]!
  assert.equal(sync.summary, 'Team sync, weekly')       // \\, unescaped
  assert.equal(sync.description, 'Discuss the\nroadmap') // \\n unescaped
  assert.equal(sync.start, '2026-06-23T14:00:00Z')
  assert.equal(sync.end, '2026-06-23T14:30:00Z')
  assert.equal(sync.location, 'Jitsi')
  assert.equal(sync.allDay, false)
})

test('unfolds folded lines (RFC 5545 continuation)', () => {
  const folded = ['BEGIN:VEVENT', 'UID:f1', 'SUMMARY:A very long title that the', '  feed folded onto two lines', 'DTSTART:20260101T000000Z', 'END:VEVENT'].join('\r\n')
  const evs = parseICal(folded)
  assert.equal(evs[0]!.summary, 'A very long title that the feed folded onto two lines')
})

test('malformed input never throws → empty list', () => {
  assert.deepEqual(parseICal('not an ical file at all'), [])
  assert.deepEqual(parseICal(''), [])
})
