import App from "../models/app.js";

const DIGITAL_CLONE_APP = {
  slug: "digital-clone",
  name: "Digital Clone",
  description:
    "Create and manage an authorized digital version of yourself for AI-generated voice, avatar video, and content workflows.",
  category: "marketing",
  isCore: false,
  standalone: true,
  requiresAIAssistant: true,
  launchUrl: "/dashboard/digital-clone",
  isVisible: false,
  isComingSoon: false,
  allowInstall: false,
  minimumPlan: "starter",
  dependencies: ["ai-assistant"],
  sortOrder: 4,
};

export default async function ensureDigitalCloneRegistry() {
  const existingApp = await App.findOne({ slug: DIGITAL_CLONE_APP.slug }).select("_id");

  if (!existingApp) {
    await App.create(DIGITAL_CLONE_APP);
    console.log("Digital Clone registry created");
    return;
  }

  console.log("Digital Clone registry ready");
}
