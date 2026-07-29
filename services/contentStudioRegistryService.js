import App from "../models/app.js";

const CONTENT_STUDIO_APP = {
  slug: "content-studio",
  name: "Content Studio",
  description: "Create branded business content using AI.",
  category: "business",
  isCore: false,
  standalone: false,
  requiresAIAssistant: true,
  launchUrl: "/dashboard/content-studio",
  isVisible: true,
  isComingSoon: false,
  allowInstall: true,
  minimumPlan: "business",
  dependencies: ["ai-assistant"],
  icon: "FilePenLine",
  sortOrder: 30,
};

export default async function ensureContentStudioRegistry() {
  await App.findOneAndUpdate(
    { slug: CONTENT_STUDIO_APP.slug },
    { $set: CONTENT_STUDIO_APP },
    { upsert: true, new: true, runValidators: true },
  );

  console.log("Content Studio registry ready");
}
