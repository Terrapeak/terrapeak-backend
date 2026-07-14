import mongoose from "mongoose";
import dotenv from "dotenv";

import Company from "../models/company.js";
import ChatbotSettings from "../models/chatbotSettings.js";

dotenv.config();

async function linkTerrapeakLiveChatbot() {
  try {
    const apiKey = process.env.TERRAPEAK_CHATBOT_API_KEY;

    if (!apiKey) {
      throw new Error(
        "TERRAPEAK_CHATBOT_API_KEY is required."
      );
    }

    await mongoose.connect(process.env.MONGO_URI);
    console.log("MongoDB connected");

    const company = await Company.findOne({
      slug: "terrapeak",
    });

    if (!company) {
      throw new Error(
        'Terrapeak Company record with slug "terrapeak" was not found.'
      );
    }

    const settings = await ChatbotSettings.findOne({
      apiKey,
    });

    if (!settings) {
      throw new Error(
        "No ChatbotSettings record was found for that API key."
      );
    }

    const previousCompanyId =
      settings.companyId?.toString() || null;

    settings.companyId = company._id;
    settings.brandName =
      settings.brandName || "Terrapeak";

    await settings.save();

    console.log("Terrapeak live chatbot linked successfully");
    console.log({
      chatbotId: settings._id.toString(),
      previousCompanyId,
      companyId: company._id.toString(),
      companySlug: company.slug,
      brandName: settings.brandName,
    });

    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error(
      "Terrapeak chatbot linking failed:",
      error.message
    );

    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  }
}

linkTerrapeakLiveChatbot();