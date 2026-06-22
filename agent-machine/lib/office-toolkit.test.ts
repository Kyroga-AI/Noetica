/** Tests for the office toolkit (LibreOffice) — viewability, target routing, convert-arg construction. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { canView, viewTargetFor, convertArgs, SOFFICE_PATHS, VIEWABLE_EXT } from './office-toolkit.js'

test('canView recognizes office formats, rejects others', () => {
  for (const f of ['report.docx', 'budget.xlsx', 'deck.pptx', 'notes.odt', 'data.csv']) assert.equal(canView(f), true, f)
  assert.equal(canView('image.png'), false)
  assert.equal(canView('code.ts'), false)
})

test('viewTargetFor routes spreadsheets→html, docs/slides→pdf', () => {
  assert.equal(viewTargetFor('budget.xlsx'), 'html')
  assert.equal(viewTargetFor('data.csv'), 'html')
  assert.equal(viewTargetFor('report.docx'), 'pdf')
  assert.equal(viewTargetFor('deck.pptx'), 'pdf')
})

test('convertArgs builds the LibreOffice headless command', () => {
  assert.deepEqual(convertArgs('/in/report.docx', 'pdf', '/out'),
    ['--headless', '--norestore', '--nologo', '--convert-to', 'pdf', '--outdir', '/out', '/in/report.docx'])
})

test('soffice candidate paths cover macOS/Linux/Windows', () => {
  assert.ok(SOFFICE_PATHS.some((p) => p.includes('LibreOffice.app')), 'macOS')
  assert.ok(SOFFICE_PATHS.some((p) => p.includes('/usr/bin/')), 'Linux')
  assert.ok(SOFFICE_PATHS.some((p) => p.includes('Program Files')), 'Windows')
  assert.ok(VIEWABLE_EXT.includes('xlsx') && VIEWABLE_EXT.includes('pptx'))
})
