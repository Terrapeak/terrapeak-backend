import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('backend migration orchestration calls only the new RPC', async () => {
  const source = await readFile('scripts/migrateReservationsBookingModel.js', 'utf8')
  assert.match(source, /migrate_reservations_to_canonical_v2/)
  assert.doesNotMatch(source, /migrate_legacy_reservations_business/)
})

test('normal backend activation delegates version transition to the migration RPC', async () => {
  const source = await readFile('utils/reservationService.js', 'utf8')
  assert.match(source, /supabase\.rpc\("migrate_reservations_to_canonical_v2"/)
  assert.doesNotMatch(source, /\.update\(\{ booking_model_version: 2 \}\)/)
})

test('canonical restaurant provisioning keeps internal services published', async () => {
  const source = await readFile(new URL('../utils/reservationService.js', import.meta.url), 'utf8')
  assert.match(source, /is_published: true/)
  assert.match(source, /is_internal: templateKey === "restaurant"/)
  assert.match(source, /existing\.is_internal !== true/)
  assert.match(source, /existing\.is_published !== true/)
  assert.doesNotMatch(source, /[A-Za-z]:[\\/\\\\]/)
})
