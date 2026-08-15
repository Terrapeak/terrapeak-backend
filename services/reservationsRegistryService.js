const normalizeBaseUrl = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return null;

  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") return null;
    if (url.hostname !== "reservations.terrapeakgroup.com") return null;
    url.pathname = url.pathname.replace(/\/+$/, "");
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
};

export default async function ensureReservationsRegistry() {
  const serviceUrl = normalizeBaseUrl(process.env.RESERVATION_APP_BASE_URL);

  if (!serviceUrl) {
    console.error(
      "Reservations service URL is invalid: RESERVATION_APP_BASE_URL must be https://reservations.terrapeakgroup.com.",
    );
    return { updated: false, reason: "invalid-service-url" };
  }

  if (process.env.RESERVATION_APP_URL_ACTIVE !== "true") {
    console.log(
      "Reservations service URL is configured but not active; customer management remains dashboard-owned.",
    );
    return {
      updated: false,
      reason: "service-domain-not-active",
      customerRoute: "/dashboard/reservations",
      serviceUrl,
    };
  }

  // Reservations is an internal Dashboard app. The App Registry launch URL is no
  // longer used to host or navigate the customer workspace. This startup check
  // validates the separate service/public-booking host only.
  console.log("Reservations service URL verified for dashboard integration.", {
    customerRoute: "/dashboard/reservations",
    serviceHost: new URL(serviceUrl).hostname,
  });

  return {
    updated: false,
    reason: "service-url-valid",
    customerRoute: "/dashboard/reservations",
    serviceUrl,
  };
}
