import test from 'node:test'
import assert from 'node:assert/strict'
import { localDateTimeCandidates, mapLegacyReservationStatus, planLegacyReservationMigration } from '../utils/reservationMigration.js'

test('legacy statuses map explicitly and unknown values are rejected', () => {
  assert.equal(mapLegacyReservationStatus('canceled'), 'cancelled')
  assert.equal(mapLegacyReservationStatus('confirmed'), 'confirmed')
  assert.equal(mapLegacyReservationStatus('mystery'), null)
})

test('timezone conversion preserves KL, Singapore and Amsterdam DST local time', () => {
  assert.equal(localDateTimeCandidates('2026-01-15', '10:30:00', 'Asia/Kuala_Lumpur').length, 1)
  assert.equal(localDateTimeCandidates('2026-01-15', '10:30:00', 'Asia/Singapore').length, 1)
  assert.equal(localDateTimeCandidates('2026-07-15', '10:30:00', 'Europe/Amsterdam').length, 1)
  assert.equal(localDateTimeCandidates('2026-03-29', '02:30:00', 'Europe/Amsterdam').length, 0)
})

test('migration planning is read-only and classifies unresolved records', () => {
  const result = planLegacyReservationMigration({
    legacyRows: [{ id: 'a', business_id: 1, reservation_date: '2026-01-15', reservation_time: '10:00:00', customer_name: 'A', phone: '1', status: 'confirmed' }, { id: 'b', business_id: 1, reservation_date: '2026-01-15', reservation_time: '10:00:00', customer_name: '', phone: '', status: 'unknown' }],
    businesses: [{ id: 1 }], settingsByBusiness: new Map([[1, { timezone: 'Asia/Singapore' }]]), servicesByBusiness: new Map([[1, { id: 9 }]]), mappings: new Map([['a', { booking_id: 'x' }]]),
  })
  assert.equal(result.alreadyMapped, 1)
  assert.equal(result.unresolved[0].reason, 'unknown-status')
  assert.equal(result.eligible.length, 0)
})

test('migration planning detects canonical rows without a complete identity map', () => {
  const args = { legacyRows: [{ id: 'a', business_id: 1, reservation_date: '2026-01-15', reservation_time: '10:00:00', customer_name: 'A', phone: '1', status: 'confirmed' }], businesses: [{ id: 1 }], settingsByBusiness: new Map([[1, { timezone: 'Asia/Singapore' }]]), servicesByBusiness: new Map([[1, { id: 9 }]]) }
  assert.equal(planLegacyReservationMigration({ ...args, canonicalByLegacyId: new Map([['a', 'booking-a']]), bookingIds: new Set(['booking-a']) }).unresolved[0].reason, 'mapping-missing')
  assert.equal(planLegacyReservationMigration({ ...args, mappings: new Map([['a', { booking_id: 'missing' }]]), bookingIds: new Set(['booking-a']) }).unresolved[0].reason, 'mapping-booking-missing')
})
