import { createClient } from "@supabase/supabase-js";
import { DateTime } from "luxon";
import { normalizeCustomerForm } from "../utils/aiReservationCustomerForm.js";
import { measureAiReservationStage } from "../utils/aiReservationLogger.js";

const serviceFields = [
  "id", "business_id", "name", "slug", "description", "booking_type",
  "duration_minutes", "slot_interval_minutes", "buffer_before_minutes",
  "buffer_after_minutes", "capacity", "price", "currency", "scheduling_mode",
  "price_session_count", "package_validity_days", "enrollment_mode",
  "cohort_start_date", "cohort_end_date", "schedule_open_ended",
  "enrollment_closed", "subject", "is_internal",
].join(",");

const providerFields = "id,display_name,slug,bio,photo_url,timezone,is_active,is_published";
export const SCHEDULED_SESSION_HORIZON_DAYS = 60;

const isValidCalendarDate = (value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return false;
  const [year, month, day] = String(value).split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
};

const formatUtcDate = (date) => date.toISOString().slice(0, 10);

export const buildScheduledSessionDateWindow = ({
  fromDate,
  toDate,
  now = new Date(),
  horizonDays = SCHEDULED_SESSION_HORIZON_DAYS,
} = {}) => {
  const defaultFromDate = formatUtcDate(now);
  const normalizedFromDate = fromDate ?? defaultFromDate;
  if (!isValidCalendarDate(normalizedFromDate)) {
    throw new Error("Scheduled session start date must be a valid YYYY-MM-DD date.");
  }

  const defaultToDate = formatUtcDate(new Date(Date.UTC(
    Number(normalizedFromDate.slice(0, 4)),
    Number(normalizedFromDate.slice(5, 7)) - 1,
    Number(normalizedFromDate.slice(8, 10)) + horizonDays,
  )));
  const normalizedToDate = toDate ?? defaultToDate;
  if (!isValidCalendarDate(normalizedToDate) || normalizedToDate < normalizedFromDate) {
    throw new Error("Scheduled session end date must be a valid date on or after the start date.");
  }

  return { fromDate: normalizedFromDate, toDate: normalizedToDate };
};

const getClient = () => {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Reservations read adapter is not configured.");
  }
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
};

const resultOrThrow = async (operation, promise) => {
  const { data, error } = await promise;
  if (error) {
    const wrapped = new Error(`Reservations ${operation} could not be loaded.`);
    if (error.code) wrapped.code = String(error.code).slice(0, 80);
    throw wrapped;
  }
  return data || [];
};

const normalizeService = (service) => ({
  id: service.id,
  businessId: service.business_id,
  slug: service.slug,
  name: service.name,
  description: service.description || "",
  bookingType: service.booking_type || null,
  durationMinutes: Number(service.duration_minutes || 0),
  price: service.price === null || service.price === undefined ? null : Number(service.price),
  currency: service.currency || null,
  schedulingMode: service.scheduling_mode || "generated",
  capacity: service.capacity === null || service.capacity === undefined ? null : Number(service.capacity),
  packageSessionCount: service.price_session_count || null,
  packageValidityDays: service.package_validity_days || null,
  enrollmentMode: service.enrollment_mode || null,
});

const normalizeProvider = (provider, assignment = {}) => ({
  id: provider.id,
  businessId: provider.business_id,
  slug: provider.slug,
  displayName: provider.display_name,
  bio: provider.bio || "",
  photoUrl: provider.photo_url || null,
  timezone: provider.timezone || null,
  customDurationMinutes: assignment.custom_duration_minutes ?? null,
  customPrice: assignment.custom_price ?? null,
});

const normalizeSlot = (slot, context, selection) => ({
  startsAt: slot.starts_at,
  endsAt: slot.ends_at,
  localTime: slot.local_time || null,
  timezone: slot.timezone || selection.timezone || null,
  businessId: context.reservationBusinessId,
  serviceId: selection.serviceId,
  providerId: selection.providerId || null,
});

export const reservationReadStore = {
  async getConfiguration(businessSlug) {
    return getClient().rpc("get_public_reservations_configuration", {
      p_business_slug: businessSlug,
    });
  },
  async listServices(businessId) {
    return getClient().from("services").select(serviceFields)
      .eq("business_id", businessId).eq("is_active", true)
      .eq("is_published", true).eq("is_internal", false).order("name");
  },
  async listProviderAssignments(businessId, serviceId) {
    return getClient().from("staff_services")
      .select("staff_id,service_id,custom_duration_minutes,custom_price,is_active")
      .eq("service_id", serviceId).eq("is_active", true);
  },
  async listProviders(businessId, providerIds) {
    return getClient().from("staff_members").select(providerFields)
      .eq("business_id", businessId).eq("is_active", true)
      .eq("is_published", true).in("id", providerIds).order("display_name");
  },
  async getAvailableSlots(args) {
    return getClient().rpc("get_available_slots", args);
  },
  async getScheduledSessions(args) {
    return getClient().rpc("get_public_scheduled_sessions", args);
  },
  async getRestaurantSlots(args) {
    return getClient().rpc("get_public_restaurant_slots", args);
  },
  async getRestaurantSettings(businessId) {
    return getClient().from("restaurant_settings")
      .select("timezone,max_guests_per_slot,default_duration_minutes,opening_time,closing_time")
      .eq("business_id", businessId)
      .maybeSingle();
  },
  async getCustomerForm(businessSlug) {
    return getClient().rpc("get_public_booking_custom_fields", {
      p_business_slug: businessSlug,
    });
  },
};

export function createReservationReadAdapter(store = reservationReadStore, { now = () => new Date() } = {}) {
  return {
    async getConfiguration(context) {
      const rows = await measureAiReservationStage({ context, stage: "configuration_read", operation: "supabase_configuration" }, () => resultOrThrow("configuration", store.getConfiguration(context.reservationBusinessSlug)));
      const configuration = Array.isArray(rows) ? rows[0] : rows;
      if (!configuration) throw new Error("Reservations configuration is not ready.");
      return configuration;
    },

    async listBookableServices(context) {
      const rows = await measureAiReservationStage({ context, stage: "services_read", operation: "supabase_services" }, () => resultOrThrow("services", store.listServices(context.reservationBusinessId)));
      return rows.map(normalizeService);
    },

    async listBookableProviders(context, service) {
      if (!service?.id) return [];
      const assignments = await measureAiReservationStage({ context, stage: "provider_assignments_read", operation: "supabase_provider_assignments" }, () => resultOrThrow("provider assignments", store.listProviderAssignments(context.reservationBusinessId, service.id)));
      const ids = assignments.map((item) => item.staff_id).filter(Boolean);
      if (!ids.length) return [];
      const providers = await measureAiReservationStage({ context, stage: "providers_read", operation: "supabase_providers" }, () => resultOrThrow("providers", store.listProviders(context.reservationBusinessId, ids)));
      const byId = new Map(assignments.map((item) => [String(item.staff_id), item]));
      return providers.map((provider) => normalizeProvider(provider, byId.get(String(provider.id))));
    },

    async listAppointmentAvailability(context, { serviceId, serviceSlug, providerId, providerSlug, localDate, timezone } = {}) {
      if (!serviceSlug || !localDate) throw new Error("A service and valid date are required.");
      const slots = await measureAiReservationStage({ context, stage: "availability_read", operation: "supabase_availability" }, () => resultOrThrow("availability", store.getAvailableSlots({
          p_business_slug: context.reservationBusinessSlug,
          p_service_slug: serviceSlug,
          p_staff_slug: providerSlug,
          p_local_date: localDate,
        })));
      return slots.map((slot) => normalizeSlot(slot, context, {
        serviceId: serviceId || serviceSlug,
        providerId: providerId || providerSlug,
        timezone,
      }));
    },

    async listScheduledSessions(context, { serviceSlug, fromDate, toDate } = {}) {
      const dateWindow = buildScheduledSessionDateWindow({ fromDate, toDate, now: now() });
      const rows = await resultOrThrow("scheduled sessions", store.getScheduledSessions({
        p_business_slug: context.reservationBusinessSlug,
        p_service_slug: serviceSlug,
        p_from_date: dateWindow.fromDate,
        p_to_date: dateWindow.toDate,
      }));
      return rows.map((row) => ({
        id: row.session_id || row.id,
        serviceId: row.service_id,
        startsAt: row.starts_at,
        endsAt: row.ends_at,
        timezone: row.staff_timezone || null,
        remainingCapacity: Number(row.remaining_capacity ?? 0),
        staffName: row.staff_name || null,
      }));
    },

    async getRestaurantSettings(context) {
      const result = await store.getRestaurantSettings(context.reservationBusinessId);
      if (result?.error) throw new Error("Reservations restaurant settings could not be loaded.");
      const settings = result?.data || result;
      if (!settings) throw new Error("Restaurant settings are not configured.");
      return {
        timezone: settings.timezone || null,
        maxGuests: Number(settings.max_guests_per_slot || settings.maxGuests || 0) || null,
        durationMinutes: Number(settings.default_duration_minutes || settings.durationMinutes || 0) || null,
        openingTime: settings.opening_time || settings.openingTime || null,
        closingTime: settings.closing_time || settings.closingTime || null,
      };
    },

    async listRestaurantAvailability(context, localDate, quantity = 1) {
      const rows = await resultOrThrow("restaurant availability", store.getRestaurantSlots({
        p_business_slug: context.reservationBusinessSlug,
        p_local_date: localDate,
      }));
      return rows
        .map((row) => {
          const localTime = String(row.reservation_time || "").slice(0, 8);
          const timezone = row.timezone || context.configuration?.restaurantSettings?.timezone || null;
          const startsAt = timezone && localTime
            ? DateTime.fromISO(`${localDate}T${localTime}`, { zone: timezone }).toUTC().toISO()
            : null;
          return {
            localTime,
            startsAt,
            remainingCapacity: Number(row.remaining_capacity ?? 0),
            timezone,
            businessId: context.reservationBusinessId,
          };
        })
        .filter((slot) => slot.remainingCapacity >= Number(quantity));
    },

    async getCustomerForm(context) {
      const rows = await measureAiReservationStage({ context, stage: "customer_form_read", operation: "supabase_customer_form" }, () => resultOrThrow("customer form", store.getCustomerForm(context.reservationBusinessSlug)));
      return normalizeCustomerForm(rows);
    },
  };
}

export const reservationsReadAdapter = createReservationReadAdapter();
