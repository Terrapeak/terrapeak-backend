const REFERENCE_PATTERN = /\bBK-[A-Z0-9]+\b/i;

export function extractReservationReference(message = "") {
  return String(message).match(REFERENCE_PATTERN)?.[0]?.toUpperCase() || null;
}

export function isReservationLookupMessage(message = "") {
  const text = String(message).toLowerCase();
  if (extractReservationReference(message)) return true;

  const lookupIntent = ["find", "lookup", "look up", "show", "retrieve", "check"]
    .some((word) => text.includes(word));
  const reservationSubject = ["reservation", "booking", "table"]
    .some((word) => text.includes(word));

  return lookupIntent && reservationSubject;
}

export function isBareRescheduleMessage(message = "") {
  return ["reschedule", "change booking", "move booking"]
    .includes(String(message).trim().toLowerCase());
}
