import { test } from 'node:test'
import assert from 'node:assert/strict'
import { characterize, parseDelimited } from './characterization.js'

test('parseDelimited handles a header + quoted fields', () => {
  const t = parseDelimited('a,b,c\n1,"x,y",3\n4,z,6')
  assert.deepEqual(t.header, ['a', 'b', 'c'])
  assert.equal(t.rows.length, 2)
  assert.equal(t.rows[0]![1], 'x,y')
})

test('infers column types (integer / float / date / string)', () => {
  const t = parseDelimited('id,price,when,name\n1,9.99,2020-01-02,alice\n2,3.50,2021-06-15,bob\n3,12.0,2019-12-31,carol')
  const c = characterize(t)
  const byName = Object.fromEntries(c.columns.map((x) => [x.name, x.type]))
  assert.equal(byName['id'], 'integer')
  assert.equal(byName['price'], 'float')
  assert.equal(byName['when'], 'date')
  assert.equal(byName['name'], 'string')
})

test('completeness + quality reflect missing cells', () => {
  const t = parseDelimited('a,b\n1,x\n2,\n3,z')   // b has one missing
  const c = characterize(t)
  const b = c.columns.find((x) => x.name === 'b')!
  assert.equal(b.missing, 1)
  assert.ok(Math.abs(b.completeness - 0.667) < 0.01)
  assert.ok(c.quality > 0 && c.quality <= 1)
})

test('sensitive scan flags PII via redact detectors (SSN, email)', () => {
  const t = parseDelimited('name,ssn,email\nalice,123-45-6789,a@x.com\nbob,987-65-4321,b@y.com')
  const c = characterize(t)
  assert.equal(c.sensitive.hasPII, true)
  assert.ok(c.sensitive.kinds['SSN']! >= 2)
  assert.ok(c.sensitive.columns.includes('ssn'))
  assert.ok(c.sensitive.columns.includes('email'))
})

test('clean data → no PII flagged', () => {
  const t = parseDelimited('make,model,year\nFord,F150,2020\nBMW,X5,2021')
  assert.equal(characterize(t).sensitive.hasPII, false)
})

test('geospatial: lat/lon columns detected + geocodable pct', () => {
  const t = parseDelimited('city,lat,lon\nAustin,30.27,-97.74\nDallas,32.78,-96.80\nElPaso,,')
  const c = characterize(t)
  assert.equal(c.geospatial.hasGeo, true)
  assert.equal(c.geospatial.latCol, 'lat')
  assert.equal(c.geospatial.lonCol, 'lon')
  assert.ok(Math.abs(c.geospatial.geocodablePct - 0.667) < 0.01)   // 2 of 3 rows have coords
})

test('geospatial: location-hint columns (address/zip) count even without lat/lon', () => {
  const t = parseDelimited('name,address,zip\nx,123 Main St,78701\ny,,78702')
  const c = characterize(t)
  assert.equal(c.geospatial.hasGeo, true)
  assert.ok(c.geospatial.locationCols.includes('address') && c.geospatial.locationCols.includes('zip'))
})

test('temporal: date columns detected with a range', () => {
  const t = parseDelimited('event,date\na,2001-03-04\nb,2014-11-20\nc,2008-06-01')
  const c = characterize(t)
  assert.equal(c.temporal.hasTemporal, true)
  assert.deepEqual(c.temporal.columns, ['date'])
  assert.deepEqual(c.temporal.range, ['2001-03-04', '2014-11-20'])
})

test('row/col counts match the table', () => {
  const c = characterize(parseDelimited('a,b,c\n1,2,3\n4,5,6'))
  assert.equal(c.rows, 2)
  assert.equal(c.cols, 3)
})

test('empty table → zeros, no throw', () => {
  const c = characterize({ header: [], rows: [] })
  assert.equal(c.rows, 0)
  assert.equal(c.quality, 0)
  assert.equal(c.sensitive.hasPII, false)
})
