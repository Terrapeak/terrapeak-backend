import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import { planLegacyReservationMigration } from '../utils/reservationMigration.js'

dotenv.config()
const args = process.argv.slice(2)
const requestedBusiness = args.includes('--business-id') ? Number(args[args.indexOf('--business-id') + 1]) : null
const url = String(process.env.SUPABASE_URL || '').trim()
const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
if (!url || !key) throw new Error('Supabase admin credentials are required.')
const supabase = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })

const load = async (table, query = builder => builder) => {
  const result = await query(supabase.from(table).select('*'))
  if (result.error) throw new Error(`Could not read ${table}`)
  return result.data || []
}

const businesses = await load('businesses', query => requestedBusiness ? query.eq('id', requestedBusiness) : query)
const businessIds = businesses.map(row => row.id)
const [legacy, settings, services, mappings, bookings] = await Promise.all([
  load('reservations', query => businessIds.length ? query.in('business_id', businessIds) : query.eq('id', '00000000-0000-0000-0000-000000000000')),
  load('restaurant_settings', query => businessIds.length ? query.in('business_id', businessIds) : query.eq('business_id', -1)),
  load('services', query => businessIds.length ? query.in('business_id', businessIds).eq('is_internal', true).eq('is_active', true) : query.eq('business_id', -1)),
  load('reservation_booking_migrations', query => businessIds.length ? query.in('business_id', businessIds) : query.eq('business_id', -1)),
  load('bookings', query => businessIds.length ? query.in('business_id', businessIds) : query.eq('business_id', -1)),
])
const settingsByBusiness = new Map(settings.map(row => [Number(row.business_id), row]))
const servicesByBusiness = new Map(services.map(row => [Number(row.business_id), row]))
const mappingsByLegacyId = new Map(mappings.map(row => [String(row.legacy_reservation_id), row]))
const canonicalByLegacyId = new Map()
for (const booking of bookings) {
  const sourceId = booking.custom_data?.migration?.source_id
  if (sourceId) canonicalByLegacyId.set(String(sourceId), booking.id)
}
const result = planLegacyReservationMigration({ legacyRows: legacy, businesses, settingsByBusiness, servicesByBusiness, mappings: mappingsByLegacyId, canonicalByLegacyId, bookingIds: new Set(bookings.map(booking => String(booking.id))) })
console.log(JSON.stringify({ mode: 'dry-run', total: result.total, alreadyMapped: result.alreadyMapped, eligible: result.eligible.length, unresolved: result.unresolved.length, reasons: result.counts, records: result.unresolved }, null, 2))
