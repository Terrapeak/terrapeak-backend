import mongoose from "mongoose";
import dotenv from "dotenv";

import App from "../models/app.js";
import APP_REGISTRY_DEFINITIONS from "../appRegistryDefinitions.js";

dotenv.config();

async function seedApps() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("MongoDB connected");

    for (const app of APP_REGISTRY_DEFINITIONS) {
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
