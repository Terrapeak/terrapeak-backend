import App from "../models/app.js";

const DIGITAL_CLONE_APP = {
  slug: "digital-clone",
  name: "Digital Clone",
  description:
    "Create and manage an authorized digital version of yourself for AI-generated voice, avatar video, and content workflows.",
  category: "business",
  isCore: false,
  standalone: true,
  requiresAIAssistant: true,
  launchUrl: "/dashboard/digital-clone",
  isVisible: true,
  isComingSoon: false,
  allowInstall: true,
  minimumPlan: "starter",
  dependencies: ["ai-assistant"],
  sortOrder: 4,
};

export default async function ensureDigitalCloneRegistry() {
  await App.findOneAndUpdate(
    { slug: DIGITAL_CLONE_APP.slug },
    { $set: DIGITAL_CLONE_APP },
    { upsert: true, new: true, runValidators: true },
  );

  console.log("Digital Clone registry ready");
}
