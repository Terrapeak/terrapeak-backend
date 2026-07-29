import APP_REGISTRY_DEFINITIONS from "../appRegistryDefinitions.js";
import App from "../models/app.js";

const CONTENT_STUDIO_APP = APP_REGISTRY_DEFINITIONS.find(
  (app) => app.slug === "content-studio",
);

export default async function ensureContentStudioRegistry() {
  if (!CONTENT_STUDIO_APP) {
    throw new Error("Content Studio registry definition is missing.");
  }

  await App.findOneAndUpdate(
    { slug: CONTENT_STUDIO_APP.slug },
    { $set: CONTENT_STUDIO_APP },
    { upsert: true, new: true, runValidators: true },
  );

  console.log("Content Studio registry ready");
}
