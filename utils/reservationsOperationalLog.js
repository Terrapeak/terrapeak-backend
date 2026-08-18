const sanitize = (value) => {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "string") return value.slice(0, 200);
  if (typeof value === "number" || typeof value === "boolean") return value;
  return String(value).slice(0, 200);
};

export function logReservationsOperation(event, fields = {}) {
  const safeFields = Object.fromEntries(
    Object.entries(fields)
      .map(([key, value]) => [key, sanitize(value)])
      .filter(([, value]) => value !== undefined),
  );

  console.info(JSON.stringify({
    component: "reservations",
    event,
    occurredAt: new Date().toISOString(),
    ...safeFields,
  }));
}
