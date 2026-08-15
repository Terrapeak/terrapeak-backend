import App from "../models/app.js";

const normalizeBaseUrl = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return null;

  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") return null;
    if (!url.hostname.endsWith("terrapeakgroup.com")) return null;
    url.pathname = url.pathname.replace(/\/+$/, "");
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
};

export default async function ensureReservationsRegistry() {
  if (process.env.RESERVATION_APP_URL_ACTIVE !== "true") {
    console.log(
      "Reservations registry reconciliation is paused until the canonical domain is verified live.",
    );
    return { updated: false, reason: "canonical-domain-not-active" };
  }

  const canonicalUrl = normalizeBaseUrl(process.env.RESERVATION_APP_BASE_URL);

  if (!canonicalUrl) {
    console.error(
      "Reservations registry not reconciled: RESERVATION_APP_BASE_URL must be an https://*.terrapeakgroup.com URL.",
    );
    return { updated: false, reason: "invalid-canonical-url" };
  }

  const app = await App.findOne({ slug: "reservations" });
  if (!app) {
    console.error("Reservations registry not reconciled: reservations app is missing.");
    return { updated: false, reason: "app-not-found" };
  }

  if (app.launchUrl === canonicalUrl) {
    return { updated: false, reason: "already-canonical", launchUrl: canonicalUrl };
  }

  const previousLaunchUrl = app.launchUrl || "";
  app.launchUrl = canonicalUrl;
  await app.save();

  console.log("Reservations launch URL reconciled to canonical TerraPeak domain.", {
    previousHost: (() => {
      try {
        return previousLaunchUrl ? new URL(previousLaunchUrl).hostname : "";
      } catch {
        return "invalid";
      }
    })(),
    canonicalHost: new URL(canonicalUrl).hostname,
  });

  return { updated: true, launchUrl: canonicalUrl };
}
