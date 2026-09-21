const SAFE_KEYS = new Set([
  "companyId", "chatbotId", "businessId", "journeyType", "attemptId",
  "outcome", "errorCode", "flowStatus", "latencyMs",
]);

export function logAiReservationEvent(event, fields = {}, logger = console) {
  const metadata = Object.fromEntries(
    Object.entries(fields)
      .filter(([key, value]) => SAFE_KEYS.has(key) && value !== undefined && value !== null)
      .map(([key, value]) => [key, String(value).slice(0, 200)]),
  );
  logger.info(JSON.stringify({
    component: "ai-reservations",
    event,
    occurredAt: new Date().toISOString(),
    ...metadata,
  }));
}
