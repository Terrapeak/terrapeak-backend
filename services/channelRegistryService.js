import App from "../models/app.js";

const CHANNEL_APPS = [
  {
    slug: "whatsapp",
    name: "WhatsApp",
    description:
      "Connect the AI Assistant to WhatsApp conversations and customer messaging.",
    category: "communication",
    isCore: false,
    standalone: false,
    requiresAIAssistant: true,
    launchUrl: "",
    isVisible: true,
    isComingSoon: false,
    allowInstall: true,
    minimumPlan: "starter",
    dependencies: ["ai-assistant"],
    icon: "MessageSquare",
    sortOrder: 50,
  },
  {
    slug: "facebook",
    name: "Facebook",
    description:
      "Connect the AI Assistant to Facebook Messenger conversations and customer messaging.",
    category: "communication",
    isCore: false,
    standalone: false,
    requiresAIAssistant: true,
    launchUrl: "",
    isVisible: true,
    isComingSoon: false,
    allowInstall: true,
    minimumPlan: "starter",
    dependencies: ["ai-assistant"],
    icon: "Users",
    sortOrder: 51,
  },
];

export default async function ensureChannelRegistry() {
  for (const channel of CHANNEL_APPS) {
    await App.findOneAndUpdate(
      { slug: channel.slug },
      { $set: channel },
      { upsert: true, new: true, runValidators: true }
    );
  }

  console.log("Channel registry ready");
}
