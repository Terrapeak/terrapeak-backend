const LEGACY_STATUS_MAP = Object.freeze({
  pending: 'pending', confirmed: 'confirmed', completed: 'completed',
  cancelled: 'cancelled', canceled: 'cancelled', no_show: 'no_show', archived: 'cancelled',
})

export const mapLegacyReservationStatus = status => {
  const normalized = String(status || '').trim().toLowerCase()
  return LEGACY_STATUS_MAP[normalized] || null
}

const partsFor = (instant, timezone) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', timeZoneName: 'longOffset',
  }).formatToParts(instant)
  return Object.fromEntries(parts.map(part => [part.type, part.value]))
}

const offsetMillis = value => {
  const match = String(value || '').match(/GMT([+-])(\d{2})(?::?(\d{2}))?/) || String(value || '').match(/GMT([+-])(\d{1,2})(?::?(\d{2}))?/)
  if (!match) return 0
  return (match[1] === '-' ? -1 : 1) * ((Number(match[2]) * 60 + Number(match[3] || 0)) * 60 * 1000)
}

export function localDateTimeCandidates(date, time, timezone) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date)) || !/^\d{2}:\d{2}(:\d{2})?$/.test(String(time))) return []
  const [year, month, day] = String(date).split('-').map(Number)
  const [hour, minute, second = 0] = String(time).split(':').map(Number)
  const wall = Date.UTC(year, month - 1, day, hour, minute, second)
  const offsets = new Set()
  for (const delta of [-86400000, -43200000, 0, 43200000, 86400000]) offsets.add(offsetMillis(partsFor(new Date(wall + delta), timezone).timeZoneName))
  return [...offsets].map(offset => new Date(wall - offset)).filter(candidate => {
    const parts = partsFor(candidate, timezone)
    return Number(parts.year) === year && Number(parts.month) === month && Number(parts.day) === day && Number(parts.hour) === hour && Number(parts.minute) === minute && Number(parts.second) === second
  }).sort((a, b) => a - b)
}

export function planLegacyReservationMigration({ legacyRows = [], businesses = [], settingsByBusiness = new Map(), servicesByBusiness = new Map(), mappings = new Map(), canonicalByLegacyId = new Map(), bookingIds = new Set() } = {}) {
  const businessMap = new Map(businesses.map(business => [Number(business.id), business]))
  const plan = { total: legacyRows.length, alreadyMapped: 0, eligible: [], unresolved: [], counts: {} }
  for (const row of legacyRows) {
    const key = String(row.id)
    if (mappings.has(key)) {
      if (bookingIds.size && !bookingIds.has(String(mappings.get(key).booking_id))) {
        plan.unresolved.push({ id: key, business_id: row.business_id, reference: row.reservation_reference || null, reason: 'mapping-booking-missing' })
        plan.counts['mapping-booking-missing'] = (plan.counts['mapping-booking-missing'] || 0) + 1
      } else plan.alreadyMapped += 1
      continue
    }
    if (canonicalByLegacyId.has(key)) {
      plan.unresolved.push({ id: key, business_id: row.business_id, reference: row.reservation_reference || null, reason: 'mapping-missing' })
      plan.counts['mapping-missing'] = (plan.counts['mapping-missing'] || 0) + 1
      continue
    }
    const business = businessMap.get(Number(row.business_id))
    const reason = !business ? 'missing-business' : !settingsByBusiness.get(Number(row.business_id)) ? 'missing-timezone' : !servicesByBusiness.get(Number(row.business_id)) ? 'missing-canonical-service' : !mapLegacyReservationStatus(row.status || 'confirmed') ? 'unknown-status' : !String(row.customer_name || '').trim() || !String(row.phone || '').trim() ? 'missing-customer-identity' : !localDateTimeCandidates(row.reservation_date, row.reservation_time, settingsByBusiness.get(Number(row.business_id)).timezone).length ? 'invalid-date-time' : null
    if (reason) { plan.unresolved.push({ id: key, business_id: row.business_id, reference: row.reservation_reference || null, reason }); plan.counts[reason] = (plan.counts[reason] || 0) + 1; continue }
    plan.eligible.push({ id: key, business_id: row.business_id, reference: row.reservation_reference || null, status: mapLegacyReservationStatus(row.status || 'confirmed') })
  }
  return plan
}
