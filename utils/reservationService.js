import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { DateTime } from "luxon";
import { randomUUID } from "node:crypto";
import { logReservationsOperation } from "./reservationsOperationalLog.js";
import {
  getReservationTemplateConfigurationDrift,
  normalizeReservationsTemplateKey,
  resolveReservationsConfiguration,
} from "./reservationConfiguration.js";
import { getReservationTemplateServiceDefaults } from "./reservationTemplateDefaults.js";

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const isMissingValue = (value) =>
  value === undefined || value === null || value === "";

export const getMissingReservationFieldValues = (existing, defaults) =>
  Object.fromEntries(
    Object.entries(defaults).filter(
      ([key, value]) => key !== "business_id" && isMissingValue(existing?.[key]) && !isMissingValue(value)
    )
  );

export async function getReservationCallbackNotificationSettings(businessId) {
  const numericBusinessId = Number(businessId);
  if (!Number.isFinite(numericBusinessId) || numericBusinessId <= 0) return null;

  const { data, error } = await supabase
    .from("reservation_business_settings")
    .select("callback_notifications")
    .eq("business_id", numericBusinessId)
    .maybeSingle();

  if (error) {
    throw new Error("Could not load callback notification settings");
  }

  return data?.callback_notifications || null;
}

const findByBusinessId = async (table, businessId) => {
  const { data, error } = await supabase
    .from(table)
    .select("*")
    .eq("business_id", businessId)
    .maybeSingle();

  if (error) {
    throw new Error(`Could not load ${table}`);
  }

  return data || null;
};

export async function findReservationBusinessBySlug(businessSlug) {
  if (!businessSlug) return null;

  const { data, error } = await supabase
    .from("businesses")
    .select("*")
    .eq("business_slug", businessSlug)
    .maybeSingle();

  if (error) {
    throw new Error("Could not load reservation business");
  }

  return data || null;
}

export async function findReservationBusinessById(businessId) {
  const numericBusinessId = Number(businessId);
  if (!Number.isFinite(numericBusinessId) || numericBusinessId <= 0) return null;

  const { data, error } = await supabase
    .from("businesses")
    .select("id, business_slug")
    .eq("id", numericBusinessId)
    .maybeSingle();

  if (error) throw new Error("Could not load reservation business");
  return data || null;
}

export async function getReservationProvisioningRecords(businessId, { templateKey = "restaurant" } = {}) {
  if (!businessId) {
    return { profile: null, settings: null, branding: null, service: null };
  }

  const [profile, settings, branding, serviceResult, reservationSettings] = await Promise.all([
    findByBusinessId("business_profile", businessId),
    findByBusinessId("restaurant_settings", businessId),
    findByBusinessId("restaurant_branding", businessId),
    supabase
      .from("services")
      .select("*")
      .eq("business_id", businessId)
      .eq("slug", getReservationTemplateServiceDefaults(templateKey).slug)
      .eq("is_internal", templateKey === "restaurant")
      .eq("is_active", true)
      .eq("is_published", true)
      .order("id", { ascending: true })
      .limit(1)
      .maybeSingle(),
    findByBusinessId("reservation_business_settings", businessId),
  ]);

  if (serviceResult.error) {
    throw new Error("Could not load canonical restaurant service");
  }

  return {
    profile,
    settings,
    branding,
    service: serviceResult.data || null,
    reservationSettings,
  };
}

export async function getCanonicalReservationsReadiness(
  businessId,
  { reservationTemplate, store = null } = {},
) {
  const numericBusinessId = Number(businessId);
  if (!Number.isFinite(numericBusinessId) || numericBusinessId <= 0) {
    return { ready: false, reason: "missing-business-mapping" };
  }

  const findBusiness = store?.findReservationBusinessById || (async (id) => {
    const { data, error } = await supabase
      .from("businesses")
      .select("id, booking_model_version")
      .eq("id", id)
      .maybeSingle();
    return { data, error };
  });
  const getRecords =
    store?.getReservationProvisioningRecords || getReservationProvisioningRecords;
  const [{ data: business, error: businessError }, records] = await Promise.all([
    findBusiness(numericBusinessId),
    getRecords(numericBusinessId, {
      templateKey:
        reservationTemplate === undefined
          ? "restaurant"
          : normalizeReservationsTemplateKey(reservationTemplate),
    }),
  ]);

  if (businessError) {
    throw new Error("Could not verify canonical Reservations readiness");
  }

  if (!business) return { ready: false, reason: "business-not-found" };
  if (Number(business.booking_model_version || 1) < 2) {
    return { ready: false, reason: "canonical-model-not-active" };
  }

  const templateKey =
    reservationTemplate === undefined
      ? "restaurant"
      : normalizeReservationsTemplateKey(reservationTemplate);
  const legacyRestaurant = reservationTemplate === undefined;
  const canonicalTemplateReady = Boolean(
    records.reservationSettings?.template_key === templateKey &&
      Object.keys(records.reservationSettings?.capabilities || {}).length &&
      Object.keys(records.reservationSettings?.terminology || {}).length,
  );
  const templateReady =
    (templateKey === "restaurant" && !records.settings?.timezone
      ? false
      : true) &&
    (legacyRestaurant ? true : canonicalTemplateReady);

  if (!legacyRestaurant) {
    const actual = records.reservationSettings;
    if (
      actual &&
      getReservationTemplateConfigurationDrift({ templateKey, settings: actual }).drift
    ) {
      return { ready: false, reason: "template-configuration-drift" };
    }
  }

  if (!records.profile || !templateReady || !records.branding) {
    return { ready: false, reason: "provisioning-incomplete" };
  }
  return { ready: true, reason: null };
}

export async function getBusinessBySlug(businessSlug) {
  const { data, error } = await supabase
    .from("businesses")
    .select("*")
    .eq("business_slug", businessSlug)
    .single();

  if (error) {
    throw new Error("Business not found");
  }

  return data;
}

export async function checkReservationAvailability({
  businessId,
  reservationDate,
  reservationTime,
  partySize,
  excludeReservationId = null,
}) {
  const { data, error } = await supabase.rpc(
    "check_canonical_restaurant_availability",
    {
      p_business_id: businessId,
      p_local_date: reservationDate,
      p_local_time: reservationTime,
      p_quantity: Number(partySize),
      p_exclude_booking_id: excludeReservationId || null,
    },
  );

  if (error) {
    console.error("Canonical reservation availability error:", error);
    throw new Error("Could not check reservation availability");
  }

  return data === true;
}

export async function generateReservationReference({
  businessId: _businessId,
  reservationDate: _reservationDate,
}) {
  return `BK-${randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase()}`;
}

const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

const formatReservationMoney = (amount, currency = "PHP") => {
  if (amount === undefined || amount === null || amount === "") return null;
  const numericAmount = Number(amount);
  if (!Number.isFinite(numericAmount)) return null;

  try {
    return new Intl.NumberFormat("en", {
      style: "currency",
      currency: currency || "PHP",
      maximumFractionDigits: numericAmount % 1 === 0 ? 0 : 2,
    }).format(numericAmount);
  } catch {
    return `${currency || "PHP"} ${numericAmount}`;
  }
};

const formatReservationDateTime = (isoValue, timezone = "UTC") => {
  if (!isoValue) return null;
  const dateTime = DateTime.fromISO(isoValue, { setZone: true }).setZone(
    timezone || "UTC",
  );
  if (!dateTime.isValid) return null;
  return dateTime.toFormat("ccc, LLL d, h:mm a");
};

const compactReservationText = (value, maxLength = 220) => {
  if (!value) return null;
  const text = String(value).replace(/\s+/g, " ").trim();
  if (!text) return null;
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
};

const groupReservationRows = (rows, key) =>
  rows.reduce((groups, row) => {
    const groupKey = row?.[key];
    if (!groupKey) return groups;
    if (!groups.has(groupKey)) groups.set(groupKey, []);
    groups.get(groupKey).push(row);
    return groups;
  }, new Map());

export async function getReservationConciergeContext({
  businessId,
  businessSlug,
  bookingUrl,
} = {}) {
  const numericBusinessId = Number(businessId);
  if (!Number.isFinite(numericBusinessId) || numericBusinessId <= 0) return "";

  try {
    const nowIso = new Date().toISOString();
    const [
      servicesResult,
      staffResult,
      enrollmentsResult,
      sessionsResult,
      patternsResult,
    ] = await Promise.all([
      supabase
        .from("services")
        .select(
          "id, name, slug, description, booking_type, duration_minutes, capacity, price, currency, price_session_count, package_validity_days, subject, enrollment_mode, scheduling_mode, is_active, is_published, is_internal",
        )
        .eq("business_id", numericBusinessId)
        .eq("is_active", true)
        .eq("is_published", true)
        .eq("is_internal", false)
        .order("name")
        .limit(30),
      supabase
        .from("staff_members")
        .select("id, display_name, timezone, bio, is_published")
        .eq("business_id", numericBusinessId)
        .eq("is_active", true)
        .eq("is_published", true)
        .order("display_name")
        .limit(30),
      supabase
        .from("class_enrollments")
        .select("service_id, quantity, status")
        .eq("business_id", numericBusinessId)
        .in("status", ["pending", "confirmed"])
        .limit(500),
      supabase
        .from("scheduled_sessions")
        .select(
          "id, service_id, staff_id, starts_at, ends_at, capacity, status, is_published",
        )
        .eq("business_id", numericBusinessId)
        .eq("is_published", true)
        .gte("ends_at", nowIso)
        .order("starts_at")
        .limit(80),
      supabase
        .from("service_schedule_patterns")
        .select("id, service_id, staff_id, day_of_week, starts_at, ends_at")
        .eq("business_id", numericBusinessId)
        .eq("is_active", true)
        .order("day_of_week")
        .limit(120),
    ]);

    const queryErrors = [
      servicesResult.error,
      staffResult.error,
      enrollmentsResult.error,
      sessionsResult.error,
      patternsResult.error,
    ].filter(Boolean);

    if (queryErrors.length) {
      console.error("Reservation concierge context query error:", queryErrors[0]);
      return "";
    }

    const services = servicesResult.data || [];
    if (!services.length) return "";

    const staff = staffResult.data || [];
    const serviceIds = services.map((service) => service.id);
    const staffIds = staff.map((person) => person.id);

    const [assignmentsResult, subjectsResult] = await Promise.all([
      serviceIds.length && staffIds.length
        ? supabase
            .from("staff_services")
            .select(
              "staff_id, service_id, custom_duration_minutes, custom_price, is_active",
            )
            .eq("is_active", true)
            .in("service_id", serviceIds)
            .in("staff_id", staffIds)
            .limit(200)
        : Promise.resolve({ data: [], error: null }),
      staffIds.length
        ? supabase
            .from("staff_subjects")
            .select("staff_id, subject")
            .eq("business_id", numericBusinessId)
            .in("staff_id", staffIds)
            .limit(200)
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (assignmentsResult.error || subjectsResult.error) {
      console.error("Reservation concierge context staff query error:", {
        assignmentsError: assignmentsResult.error,
        subjectsError: subjectsResult.error,
      });
      return "";
    }

    const staffById = new Map(staff.map((person) => [person.id, person]));
    const assignmentsByService = groupReservationRows(
      assignmentsResult.data || [],
      "service_id",
    );
    const subjectsByStaff = groupReservationRows(
      subjectsResult.data || [],
      "staff_id",
    );
    const enrollmentsByService = groupReservationRows(
      enrollmentsResult.data || [],
      "service_id",
    );
    const sessionsByService = groupReservationRows(
      sessionsResult.data || [],
      "service_id",
    );
    const patternsByService = groupReservationRows(
      patternsResult.data || [],
      "service_id",
    );

    const serviceLines = services.slice(0, 12).map((service, index) => {
      const price = formatReservationMoney(service.price, service.currency);
      const priceParts = [];
      if (price) priceParts.push(price);
      if (service.price_session_count) {
        priceParts.push(`for ${service.price_session_count} session(s)`);
      }
      if (service.package_validity_days) {
        priceParts.push(`valid ${service.package_validity_days} day(s)`);
      }

      const enrolled = (enrollmentsByService.get(service.id) || []).reduce(
        (total, item) => total + Number(item.quantity || 1),
        0,
      );
      const capacity = Number(service.capacity || 0);
      const places =
        capacity > 0 ? Math.max(capacity - enrolled, 0) : null;

      const servicePatterns = (patternsByService.get(service.id) || [])
        .slice(0, 8)
        .map((pattern) => {
          const teacher = staffById.get(pattern.staff_id)?.display_name;
          const dayName =
            DAY_NAMES[Number(pattern.day_of_week)] || `Day ${pattern.day_of_week}`;
          return `${dayName} ${String(pattern.starts_at || "").slice(0, 5)}-${String(
            pattern.ends_at || "",
          ).slice(0, 5)}${teacher ? ` with ${teacher}` : ""}`;
        });

      const serviceSessions = (sessionsByService.get(service.id) || [])
        .slice(0, 5)
        .map((session) => {
          const teacher = staffById.get(session.staff_id);
          const label = formatReservationDateTime(
            session.starts_at,
            teacher?.timezone,
          );
          return label
            ? `${label}${teacher?.display_name ? ` with ${teacher.display_name}` : ""}`
            : null;
        })
        .filter(Boolean);

      const assignedStaff = (assignmentsByService.get(service.id) || [])
        .slice(0, 6)
        .map((assignment) => {
          const person = staffById.get(assignment.staff_id);
          if (!person) return null;
          const subjects = (subjectsByStaff.get(person.id) || [])
            .map((item) => item.subject)
            .filter(Boolean)
            .slice(0, 4);
          const bio = compactReservationText(person.bio, 120);
          const details = [
            subjects.length ? `subjects: ${subjects.join(", ")}` : null,
            bio ? `background: ${bio}` : null,
          ].filter(Boolean);
          return `${person.display_name}${
            details.length ? ` (${details.join("; ")})` : ""
          }`;
        })
        .filter(Boolean);

      return [
        `${index + 1}. ${service.name}`,
        service.booking_type ? `type: ${service.booking_type}` : null,
        service.subject ? `subject: ${service.subject}` : null,
        service.duration_minutes
          ? `duration: ${service.duration_minutes} minutes`
          : null,
        priceParts.length ? `price: ${priceParts.join(" ")}` : null,
        capacity > 0
          ? `capacity: ${capacity}; active enrolments/bookings: ${enrolled}; approximate places left: ${places}`
          : null,
        compactReservationText(service.description)
          ? `description: ${compactReservationText(service.description)}`
          : null,
        servicePatterns.length
          ? `weekly timetable: ${servicePatterns.join("; ")}`
          : "weekly timetable: not published in the service catalogue context",
        serviceSessions.length
          ? `upcoming published sessions: ${serviceSessions.join("; ")}`
          : "upcoming published sessions: none listed in the service catalogue context",
        assignedStaff.length ? `staff: ${assignedStaff.join("; ")}` : null,
      ]
        .filter(Boolean)
        .join("; ");
    });

    return `
--- LIVE RESERVATIONS SERVICE CATALOGUE ---
This is read-only Reservations data for the current business${
      businessSlug ? ` (${businessSlug})` : ""
    }. Use it when customers ask about services, courses, classes, programmes, prices, dates, times, capacity, staff, teachers, or enrolment advice. Do not mention draft, unpublished, archived, or internal services because they are intentionally excluded here. This context is read-only: do not invent availability or confirmations, and let the typed Reservations flow handle eligible new booking starts in chat. Businesses using request-based confirmation may still require the Reservations form${
      bookingUrl ? `: ${bookingUrl}` : ""
    }.
${serviceLines.join("\n")}
`;
  } catch (error) {
    console.error("Reservation concierge context error:", error);
    return "";
  }
}

const getCanonicalRestaurantContext = async (businessId) => {
  const [
    { data: business, error: businessError },
    { data: settings, error: settingsError },
    { data: service, error: serviceError },
  ] = await Promise.all([
      supabase
        .from("businesses")
        .select("id, business_slug, booking_model_version")
        .eq("id", businessId)
        .eq("booking_model_version", 2)
        .maybeSingle(),
      supabase
        .from("restaurant_settings")
        .select("timezone")
        .eq("business_id", businessId)
        .maybeSingle(),
      supabase
        .from("services")
        .select("id")
        .eq("business_id", businessId)
        .eq("booking_type", "restaurant")
        .eq("is_internal", true)
        .eq("is_active", true)
        .eq("is_published", true)
        .order("id", { ascending: true })
        .limit(1)
        .maybeSingle(),
    ]);

  if (businessError || settingsError || serviceError) {
    console.error("Canonical restaurant context error:", {
      businessError,
      settingsError,
      serviceError,
    });
    throw new Error("Could not load reservation configuration");
  }

  if (!business || !settings?.timezone || !service) {
    throw new Error("Reservations are not configured for this business.");
  }

  return { ...business, timezone: settings.timezone, serviceId: service.id };
};

export const normalizeCanonicalRestaurantBooking = (booking, timezone) => {
  if (!booking) return null;

  const localStart = DateTime.fromISO(booking.starts_at, { setZone: true }).setZone(
    timezone,
  );

  if (!localStart.isValid) {
    throw new Error("Booking has an invalid start timestamp");
  }

  return {
    ...booking,
    reservation_reference: booking.reference,
    phone: booking.customer_phone,
    reservation_date: localStart.toISODate(),
    reservation_time: localStart.toFormat("HH:mm:ss"),
    party_size: Number(booking.quantity),
    special_request: booking.notes || "",
    is_archived: false,
  };
};

export async function createReservation({
  businessId,
  customerName,
  phone,
  email = null,
  reservationDate,
  reservationTime,
  partySize,
  specialRequest = "",
  customData = {},
}) {
  const context = await getCanonicalRestaurantContext(businessId);
  const { data, error } = await supabase.rpc(
    "create_canonical_restaurant_booking",
    {
      p_business_id: businessId,
      p_customer_name: customerName,
      p_customer_phone: phone,
      p_local_date: reservationDate,
      p_local_time: reservationTime,
      p_quantity: Number(partySize),
      p_notes: specialRequest || null,
      p_custom_data: customData || {},
      p_customer_email: email || null,
    },
  );

  if (error) {
    console.error("Canonical reservation creation error:", error);
    throw new Error("Could not create reservation");
  }

  logReservationsOperation("booking.created", {
    businessId,
    bookingId: data?.id,
    reference: data?.reference,
    serviceId: data?.service_id,
    source: "ai_or_backend",
  });

  return normalizeCanonicalRestaurantBooking(data, context.timezone);
}

export async function findActiveReservationsByReference({
  businessId,
  reservationReference,
}) {
  const context = await getCanonicalRestaurantContext(businessId);
  const { data, error } = await supabase
    .from("bookings")
    .select("*")
    .eq("business_id", businessId)
    .eq("service_id", context.serviceId)
    .eq("reference", reservationReference)
    .in("status", ["pending", "confirmed"])
    .order("starts_at", { ascending: true });

  if (error) {
    throw new Error("Could not search reservation by reference");
  }

  return (data || []).map((booking) =>
    normalizeCanonicalRestaurantBooking(booking, context.timezone),
  );
}

export async function findActiveReservationsByPhone({
  businessId,
  phone,
}) {
  const context = await getCanonicalRestaurantContext(businessId);
  const { data, error } = await supabase
    .from("bookings")
    .select("*")
    .eq("business_id", businessId)
    .eq("service_id", context.serviceId)
    .eq("customer_phone", phone)
    .in("status", ["pending", "confirmed"])
    .order("starts_at", { ascending: true });

  if (error) {
    throw new Error("Could not search reservations by phone");
  }

  return (data || []).map((booking) =>
    normalizeCanonicalRestaurantBooking(booking, context.timezone),
  );
}

export async function cancelReservationById({
  businessId,
  reservationId,
}) {
  const context = await getCanonicalRestaurantContext(businessId);
  const { data, error } = await supabase
    .from("bookings")
    .update({ status: "cancelled" })
    .eq("business_id", businessId)
    .eq("service_id", context.serviceId)
    .eq("id", reservationId)
    .in("status", ["pending", "confirmed"])
    .select()
    .single();

  if (error) {
    throw new Error("Could not cancel reservation");
  }

  return normalizeCanonicalRestaurantBooking(data, context.timezone);
}

export async function updateReservationById({
  businessId,
  reservationId,
  reservationDate,
  reservationTime,
  partySize,
  specialRequest,
  customData = {},
}) {
  const context = await getCanonicalRestaurantContext(businessId);
  const { data, error } = await supabase.rpc(
    "update_canonical_restaurant_booking",
    {
      p_business_id: businessId,
      p_booking_id: reservationId,
      p_local_date: reservationDate,
      p_local_time: reservationTime,
      p_quantity: Number(partySize),
      p_notes: specialRequest || null,
      p_custom_data: customData || {},
    },
  );

  if (error) {
    throw new Error("Could not update reservation");
  }

  return normalizeCanonicalRestaurantBooking(data, context.timezone);
}

export async function createOrGetReservationBusiness({
  businessName,
  businessSlug,
  businessType = "general",
}) {
  const existingBusiness = await findReservationBusinessBySlug(businessSlug);

  if (existingBusiness) {
    const missingValues = getMissingReservationFieldValues(existingBusiness, {
      business_name: businessName,
      business_type: businessType,
    });

    if (Object.keys(missingValues).length) {
      const { data, error } = await supabase
        .from("businesses")
        .update(missingValues)
        .eq("id", existingBusiness.id)
        .select()
        .single();

      if (error) throw new Error("Could not repair reservation business");
      return data;
    }

    return existingBusiness;
  }

  const { data, error } = await supabase
    .from("businesses")
    .insert([
      {
        business_name: businessName,
        business_slug: businessSlug,
        business_type: businessType,
      },
    ])
    .select()
    .single();

  if (error) {
    console.error("Create reservation business error:", error);
    throw new Error("Could not create reservation business");
  }

  return data;
}

export async function createOrUpdateBusinessProfile({
  businessId,
  businessName,
  businessType = "general",
  terminology = {},
  templateKey,
  referencePrefix = "BOT",
}) {
  const profileData = {
    business_id: businessId,
    business_name: businessName,
    business_type: businessType,
    booking_label: terminology.bookingSingular || "Booking",
    customer_label: terminology.customerSingular || "Customer",
    capacity_label: terminology.guestPlural || "Guests",
    industry_template: templateKey || businessType,
    uses_capacity: businessType === "restaurant",
    reference_prefix: referencePrefix,
  };

  const existingProfile = await findByBusinessId("business_profile", businessId);

  if (existingProfile) {
    const missingValues = getMissingReservationFieldValues(
      existingProfile,
      profileData
    );
    if (!Object.keys(missingValues).length) return existingProfile;

    const { data, error } = await supabase
      .from("business_profile")
      .update(missingValues)
      .eq("business_id", businessId)
      .select()
      .single();

    if (error) {
      console.error("Update business profile error:", error);
      throw new Error("Could not update business profile");
    }

    return data;
  }

  const { data, error } = await supabase
    .from("business_profile")
    .insert([profileData])
    .select()
    .single();

  if (error) {
    console.error("Create business profile error:", error);
    throw new Error("Could not create business profile");
  }

  return data;
}

export async function createOrUpdateRestaurantSettings({ businessId }) {
  const settingsData = {
  business_id: businessId,
  opening_time: "11:00:00",
  closing_time: "22:00:00",
  max_guests_per_slot: 20,
  default_duration_minutes: 90,
};

  const existingSettings = await findByBusinessId(
    "restaurant_settings",
    businessId
  );

  if (existingSettings) {
    const missingValues = getMissingReservationFieldValues(
      existingSettings,
      settingsData
    );
    if (!Object.keys(missingValues).length) return existingSettings;

    const { data, error } = await supabase
      .from("restaurant_settings")
      .update(missingValues)
      .eq("business_id", businessId)
      .select()
      .single();

    if (error) {
      console.error("Update restaurant settings error:", error);
      throw new Error("Could not update restaurant settings");
    }

    return data;
  }

  const { data, error } = await supabase
    .from("restaurant_settings")
    .insert([settingsData])
    .select()
    .single();

  if (error) {
    console.error("Create restaurant settings error:", error);
    throw new Error("Could not create restaurant settings");
  }

  return data;
}

export async function createOrUpdateReservationBusinessSettings({
  businessId,
  templateKey,
  capabilities,
  terminology,
  platformAuthoritative = false,
}) {
  const existingSettings = await findByBusinessId(
    "reservation_business_settings",
    businessId,
  );
  const resolved = resolveReservationsConfiguration({
    templateKey,
    capabilities,
    terminology,
    bookingBehavior: existingSettings || {},
    platformAuthoritative,
  });
  const settingsData = {
    business_id: businessId,
    template_key: resolved.templateKey,
    capabilities: resolved.capabilities,
    terminology: resolved.terminology,
  };

  if (existingSettings) {
    const patch = buildReservationBusinessSettingsPatch({
      existingSettings,
      settingsData,
      platformAuthoritative,
    });
    if (!Object.keys(patch).length) return existingSettings;
    const { data, error } = await supabase
      .from("reservation_business_settings")
      .update(patch)
      .eq("business_id", businessId)
      .select()
      .single();
    if (error) throw new Error("Could not update Reservations configuration");
    return data;
  }

  const { data, error } = await supabase
    .from("reservation_business_settings")
    .insert([settingsData])
    .select()
    .single();
  if (error) throw new Error("Could not create Reservations configuration");
  return data;
}

export const buildReservationBusinessSettingsPatch = ({
  existingSettings,
  settingsData,
  platformAuthoritative = false,
} = {}) => {
  if (!existingSettings) return settingsData;
  if (platformAuthoritative) {
    return {
      template_key: settingsData.template_key,
      capabilities: settingsData.capabilities,
      terminology: settingsData.terminology,
    };
  }
  const patch = getMissingReservationFieldValues(existingSettings, settingsData);
  if (!existingSettings.template_key) patch.template_key = settingsData.template_key;
  if (!existingSettings.capabilities || Object.keys(existingSettings.capabilities).length === 0) {
    patch.capabilities = settingsData.capabilities;
  }
  if (!existingSettings.terminology || Object.keys(existingSettings.terminology).length === 0) {
    patch.terminology = settingsData.terminology;
  }
  return patch;
};

export async function createOrUpdateCanonicalRestaurantService({ businessId, templateKey = "restaurant" }) {
  const serviceDefaults = {
    general: { name: "Appointment", slug: "appointment", description: "Book an appointment.", bookingType: "appointment", duration: 60, capacity: 1 },
    physiotherapy: { name: "Physiotherapy Appointment", slug: "physiotherapy-appointment", description: "Book a physiotherapy appointment.", bookingType: "appointment", duration: 60, capacity: 1 },
    dental: { name: "Dental Appointment", slug: "dental-appointment", description: "Book a dental appointment.", bookingType: "appointment", duration: 60, capacity: 1 },
    salon: { name: "Salon Appointment", slug: "salon-appointment", description: "Book a salon or beauty appointment.", bookingType: "appointment", duration: 60, capacity: 1 },
    learning_centre: { name: "Learning Session", slug: "learning-session", description: "Book a learning session.", bookingType: "class", duration: 60, capacity: 10 },
    restaurant: { name: "Restaurant Reservation", slug: "restaurant-reservation", description: "Customer-facing restaurant reservations.", bookingType: "restaurant", duration: 90, capacity: 20 },
  }[templateKey] || { name: "Appointment", slug: "appointment", description: "Book an appointment.", bookingType: "appointment", duration: 60, capacity: 1 };
  const settings = templateKey === "restaurant"
    ? await findByBusinessId("restaurant_settings", businessId)
    : null;
  if (templateKey === "restaurant" && !settings) {
    throw new Error("Restaurant settings must exist before the booking service");
  }

  const serviceData = {
    business_id: businessId,
    name: serviceDefaults.name,
    slug: serviceDefaults.slug,
    description: serviceDefaults.description,
    booking_type: serviceDefaults.bookingType,
    duration_minutes: templateKey === "restaurant" ? Number(settings.default_duration_minutes) : serviceDefaults.duration,
    slot_interval_minutes: 30,
    capacity: templateKey === "restaurant" ? Number(settings.max_guests_per_slot) : serviceDefaults.capacity,
    is_active: true,
    is_published: true,
    is_internal: templateKey === "restaurant",
  };

  const { data: existing, error: findError } = await supabase
    .from("services")
    .select("*")
    .eq("business_id", businessId)
    .eq("slug", serviceData.slug)
    .maybeSingle();

  if (findError) {
    throw new Error("Could not load canonical restaurant service");
  }

  if (existing) {
    const missingValues = getMissingReservationFieldValues(existing, serviceData);
    // Publication is an availability invariant for the canonical restaurant
    // RPCs. Visibility is controlled by is_internal, never by unpublishing.
    if (templateKey === "restaurant") {
      if (existing.is_internal !== true) missingValues.is_internal = true;
      if (existing.is_active !== true) missingValues.is_active = true;
      if (existing.is_published !== true) missingValues.is_published = true;
    } else if (existing.is_internal !== false) {
      missingValues.is_internal = false;
    }
    if (!Object.keys(missingValues).length) return existing;

    const { data, error } = await supabase
      .from("services")
      .update(missingValues)
      .eq("id", existing.id)
      .eq("business_id", businessId)
      .select()
      .single();

    if (error) {
      throw new Error("Could not repair canonical restaurant service");
    }

    return data;
  }

  const { data, error } = await supabase
    .from("services")
    .insert([serviceData])
    .select()
    .single();

  if (error) {
    throw new Error("Could not create canonical restaurant service");
  }

  return data;
}

export async function activateCanonicalBookingModelIfEmpty({ businessId }) {
  const { count, error: countError } = await supabase
    .from("reservations")
    .select("id", { count: "exact", head: true })
    .eq("business_id", businessId);

  if (countError) {
    throw new Error("Could not verify legacy reservation history");
  }

  if (Number(count || 0) > 0) {
    return { activated: false, reason: "legacy-history-requires-migration" };
  }

  const { data, error } = await supabase.rpc("migrate_reservations_to_canonical_v2", {
    p_business_id: businessId,
    p_apply: true,
  });

  if (error) {
    throw new Error("Could not activate the canonical booking model");
  }

  return { activated: true, reason: "empty-tenant-reconciled", business: data };
}

export async function createOrUpdateRestaurantBranding({
  businessId,
  restaurantName,
}) {
  const brandingData = {
    business_id: businessId,
    restaurant_name: restaurantName,
    primary_color: "#2563eb",
    background_start: "#eff6ff",
    background_end: "#dbeafe",
    logo_url: "",
  };

  const existing = await findByBusinessId("restaurant_branding", businessId);

  if (existing) {
    const missingValues = getMissingReservationFieldValues(
      existing,
      brandingData
    );
    if (!Object.keys(missingValues).length) return existing;

    const { data, error } = await supabase
      .from("restaurant_branding")
      .update(missingValues)
      .eq("business_id", businessId)
      .select()
      .single();

    if (error) throw error;

    return data;
  }

  const { data, error } = await supabase
    .from("restaurant_branding")
    .insert([brandingData])
    .select()
    .single();

  if (error) throw error;

  return data;
}

