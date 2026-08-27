import aiAssistantManifest from "./aiAssistantManifest.js";
import facebookManifest from "./facebookManifest.js";
import reservationsManifest from "./reservationsManifest.js";
import contentStudioManifest from "./contentStudioManifest.js";
import digitalCloneManifest from "./digitalCloneManifest.js";


const manifests = {
  "ai-assistant": aiAssistantManifest,
  facebook: facebookManifest,
  reservations: reservationsManifest,
  "content-studio": contentStudioManifest,
  "digital-clone": digitalCloneManifest,
};

export function getAppManifest(appSlug) {
  return manifests[appSlug] || null;
}

export function getAllAppManifests() {
  return manifests;
}

export default manifests;
