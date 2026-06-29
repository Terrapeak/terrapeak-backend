import mongoose from "mongoose";
import dotenv from "dotenv";

import ChatbotSettings from "../models/chatbotSettings.js";
import Company from "../models/company.js";

dotenv.config();

const LINK_MAP = [
  {
    userId: "6a322f9aef613bd314b7187b", // Tim
    companySlug: "dim-sum-dragon",
  },
  {
    userId: "6a328d88ccae702e020f1f99", // Cherry
    companySlug: "ambergris-cafe",
  },
];

async function linkChatbotsToCompanies() {
  try {
    await mongoose.connect(process.env.MONGO_URI);

    console.log("MongoDB connected");

    for (const link of LINK_MAP) {
      const chatbot = await ChatbotSettings.findOne({
  userId: new mongoose.Types.ObjectId(link.userId),
});

      if (!chatbot) {
        console.log(`No chatbot found for apiKey: ${link.apiKey}`);
        continue;
      }

      const company = await Company.findOne({
        slug: link.companySlug,
      });

      if (!company) {
        console.log(`No company found for slug: ${link.companySlug}`);
        continue;
      }

      chatbot.companyId = company._id;
      chatbot.reservationBusinessSlug = company.reservationBusinessSlug;

      await chatbot.save();

      console.log(
  `Linked userId ${link.userId} to company ${company.name}`
);
    }

    console.log("Done linking selected chatbots to companies");
    process.exit(0);
  } catch (error) {
    console.error("Migration failed:", error);
    process.exit(1);
  }
}

linkChatbotsToCompanies();