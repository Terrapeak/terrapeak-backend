import aiAssistantManifest from "./aiAssistantManifest.js";
import facebookManifest from "./facebookManifest.js";
import reservationsManifest from "./reservationsManifest.js";

const manifests = {
  "ai-assistant": aiAssistantManifest,
  facebook: facebookManifest,
  reservations: reservationsManifest,
};

export function getAppManifest(appSlug) {
  return manifests[appSlug] || null;
}

export function getAllAppManifests() {
  return manifests;
}

export default manifests;
