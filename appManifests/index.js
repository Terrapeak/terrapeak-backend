import aiAssistantManifest from "./aiAssistantManifest.js";
import reservationsManifest from "./reservationsManifest.js";

const manifests = {
  "ai-assistant": aiAssistantManifest,
  reservations: reservationsManifest,
};

export function getAppManifest(appSlug) {
  return manifests[appSlug] || null;
}

export function getAllAppManifests() {
  return manifests;
}

export default manifests;