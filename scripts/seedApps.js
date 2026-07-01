import mongoose from "mongoose";
import dotenv from "dotenv";

import App from "../models/app.js";

dotenv.config();

const APPS = [
  {
    slug: "ai-assistant",
    name: "AI Assistant",
    description: "The core Pearlbot AI chatbot, knowledge base, appearance settings, Google Calendar appointments, and chat configuration.",
    category: "core",
    isCore: true,
    standalone: true,
    requiresAIAssistant: false,
    launchUrl: "/chatbot/settings",
    isVisible: true,
    isComingSoon: false,
    sortOrder: 1,
  },
  {
    slug: "reservations",
    name: "Reservations",
    description: "Reservation form, reservation dashboard, booking management, capacity, opening hours, and reservation references.",
    category: "business",
    isCore: false,
    standalone: true,
    requiresAIAssistant: false,
    launchUrl: "/reservations",
    isVisible: true,
    isComingSoon: false,
    sortOrder: 2,
  },
  {
    slug: "crm",
    name: "CRM",
    description: "Manage leads, customers, follow-ups, and sales opportunities.",
    category: "business",
    isCore: false,
    standalone: true,
    requiresAIAssistant: false,
    launchUrl: "/crm",
    isVisible: true,
    isComingSoon: true,
    sortOrder: 3,
  },
  {
    slug: "analytics",
    name: "Analytics",
    description: "Conversation insights, booking metrics, conversion tracking, and business performance.",
    category: "analytics",
    isCore: false,
    standalone: true,
    requiresAIAssistant: false,
    launchUrl: "/analytics",
    isVisible: true,
    isComingSoon: true,
    sortOrder: 4,
  },
  {
    slug: "whatsapp",
    name: "WhatsApp",
    description: "Connect Pearlbot to WhatsApp conversations and customer messaging.",
    category: "communication",
    isCore: false,
    standalone: true,
    requiresAIAssistant: true,
    launchUrl: "/whatsapp",
    isVisible: true,
    isComingSoon: true,
    sortOrder: 5,
  },
  {
    slug: "voice-ai",
    name: "Voice AI",
    description: "AI voice assistant for calls, intake, routing, and customer support.",
    category: "communication",
    isCore: false,
    standalone: true,
    requiresAIAssistant: true,
    launchUrl: "/voice-ai",
    isVisible: true,
    isComingSoon: true,
    sortOrder: 6,
  },
];

async function seedApps() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("MongoDB connected");

    for (const app of APPS) {
      await App.findOneAndUpdate(
        { slug: app.slug },
        app,
        { upsert: true, new: true, runValidators: true }
      );

      console.log(`Seeded app: ${app.name}`);
    }

    console.log("App registry seeded successfully");
    process.exit(0);
  } catch (error) {
    console.error("Failed to seed apps:", error);
    process.exit(1);
  }
}

seedApps();