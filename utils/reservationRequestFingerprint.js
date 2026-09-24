import { createHash } from "node:crypto";

const normalizeText = (value) => String(value ?? "").trim();

const normalizeRestaurantLocalTime = (value) => {
  const normalized = normalizeText(value);
  const match = /^(2[0-3]|[01]\d):([0-5]\d)(?::([0-5]\d))?$/.exec(normalized);
  if (!match) return normalized;
  return `${match[1]}:${match[2]}:${match[3] || "00"}`;
};

const normalizeCustomData = (value) => {
  if (Array.isArray(value)) return value.map(normalizeCustomData);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, normalizeCustomData(value[key])]),
    );
  }
  if (typeof value === "string") return normalizeText(value);
  return value ?? null;
};

export const buildCanonicalReservationBookingPayload = ({
  reservationBusinessSlug,
  serviceSlug,
  providerSlug,
  startsAt,
  customerName,
  customerEmail,
  customerPhone,
  notes,
  customData,
}) => ({
  business: normalizeText(reservationBusinessSlug).toLowerCase(),
  service: normalizeText(serviceSlug).toLowerCase(),
  provider: normalizeText(providerSlug).toLowerCase(),
  startsAt: startsAt instanceof Date
    ? startsAt.toISOString()
    : new Date(startsAt).toISOString(),
  customerName: normalizeText(customerName),
  customerEmail: normalizeText(customerEmail).toLowerCase() || null,
  customerPhone: normalizeText(customerPhone).replace(/\D/g, "") || null,
  notes: normalizeText(notes) || null,
  customData: normalizeCustomData(customData || {}),
});

export const fingerprintCanonicalReservationBooking = (payload) =>
  createHash("sha256").update(JSON.stringify(payload)).digest("hex");

export const fingerprintReservationBookingRequest = (request) => {
  const payload = buildCanonicalReservationBookingPayload(request);
  return {
    payload,
    fingerprint: fingerprintCanonicalReservationBooking(payload),
  };
};

export const buildCanonicalRestaurantBookingPayload = ({
  reservationBusinessId,
  reservationBusinessSlug,
  localDate,
  localTime,
  quantity,
  customerName,
  customerEmail,
  customerPhone,
  notes,
  customData,
}) => ({
  journeyType: "restaurant",
  businessId: normalizeText(reservationBusinessId),
  business: normalizeText(reservationBusinessSlug).toLowerCase(),
  localDate: normalizeText(localDate),
  localTime: normalizeRestaurantLocalTime(localTime),
  quantity: Number(quantity),
  customerName: normalizeText(customerName),
  customerEmail: normalizeText(customerEmail).toLowerCase() || null,
  customerPhone: normalizeText(customerPhone).replace(/\D/g, "") || null,
  notes: normalizeText(notes) || null,
  customData: normalizeCustomData(customData || {}),
});

export const fingerprintRestaurantBookingRequest = (request) => {
  const payload = buildCanonicalRestaurantBookingPayload(request);
  return {
    payload,
    fingerprint: createHash("sha256").update(JSON.stringify(payload)).digest("hex"),
  };
};

export const fingerprintLegacyReservationRequest = (value) => {
  const stableSerialize = (item) => {
    if (Array.isArray(item)) return `[${item.map(stableSerialize).join(",")}]`;
    if (item instanceof Date) return JSON.stringify(item.toISOString());
    if (item && typeof item === "object") {
      return `{${Object.keys(item).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(item[key])}`).join(",")}}`;
    }
    return JSON.stringify(item === undefined ? null : item);
  };
  return createHash("sha256").update(stableSerialize(value || {})).digest("hex");
};
