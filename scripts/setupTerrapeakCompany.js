import mongoose from "mongoose";
import dotenv from "dotenv";

import Company from "../models/company.js";
import CompanyMembership from "../models/companyMembership.js";
import CompanyAppInstallation from "../models/companyAppInstallation.js";
import User from "../models/user.js";
import ChatbotSettings from "../models/chatbotSettings.js";
import { provisionCompany } from "../services/companyProvisioningService.js";
import { applyPlatformAccessMutation } from "../utils/platformAccessGuard.js";

dotenv.config();

const TERRAPEAK_COMPANY = {
  name: "Terrapeak",
  displayName: "Terrapeak",
  slug: "terrapeak",
  referencePrefix: "TP",
  reservationBusinessSlug: "terrapeak",
  plan: "enterprise",
  maxUsers: 10,
  isActive: true,
  isPlatformWorkspace: true,
};

const PLATFORM_OWNER_ROLES = ["platform-owner", "platform-admin"];

async function findTerrapeakOwner() {
  if (process.env.TERRAPEAK_OWNER_EMAIL) {
    const configuredOwner = await User.findOne({
      email: process.env.TERRAPEAK_OWNER_EMAIL,
    });

    if (!configuredOwner) {
      throw new Error(
        `No user found for TERRAPEAK_OWNER_EMAIL=${process.env.TERRAPEAK_OWNER_EMAIL}`
      );
    }

    return configuredOwner;
  }

  return User.findOne({
    platformRole: { $in: PLATFORM_OWNER_ROLES },
  }).sort({ platformRole: 1, createdAt: 1 });
}

async function linkSafeTerrapeakChatbot({ company, owner }) {
  const alreadyLinked = await ChatbotSettings.findOne({
    companyId: company._id,
  });

  if (alreadyLinked) {
    return {
      linked: false,
      reason: "Terrapeak company already has linked chatbot settings.",
      chatbotId: alreadyLinked._id.toString(),
    };
  }

  const chatbot = await ChatbotSettings.findOne({
    companyId: null,
    userId: owner._id,
    $or: [
      { brandName: /^Terrapeak$/i },
      { botName: /^Terrapeak/i },
    ],
  });

  if (!chatbot) {
    return {
      linked: false,
      reason: "No unlinked Terrapeak chatbot settings found for owner.",
    };
  }

  chatbot.companyId = company._id;
  chatbot.brandName = chatbot.brandName || "Terrapeak";
  chatbot.botName = chatbot.botName || "Terrapeak Assistant";
  chatbot.reservationBusinessSlug =
    chatbot.reservationBusinessSlug || company.reservationBusinessSlug;

  await chatbot.save();

  return {
    linked: true,
    chatbotId: chatbot._id.toString(),
  };
}

async function setupTerrapeakCompany() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("MongoDB connected");

    const owner = await findTerrapeakOwner();

    if (!owner) {
      throw new Error(
        "No platform-owner or platform-admin user found. Set TERRAPEAK_OWNER_EMAIL to an existing platform admin user email and rerun."
      );
    }

    if (owner.platformRole !== "platform-owner") {
      await applyPlatformAccessMutation({
        user: owner,
        updates: {
          platformRole: "platform-owner",
          isAdmin: true,
          role: "admin",
        },
      });
      await owner.save();
    }

    const existingCompany = await Company.findOne({
      slug: TERRAPEAK_COMPANY.slug,
    });

    const company = await Company.findOneAndUpdate(
      { slug: TERRAPEAK_COMPANY.slug },
      {
        ...TERRAPEAK_COMPANY,
        ownerUserId: existingCompany?.ownerUserId || owner._id,
        installedApps: existingCompany?.installedApps || [],
      },
      {
        upsert: true,
        new: true,
        runValidators: true,
        setDefaultsOnInsert: true,
      }
    );

    const membership = await CompanyMembership.findOneAndUpdate(
      {
        companyId: company._id,
        userId: owner._id,
      },
      {
        companyId: company._id,
        userId: owner._id,
        role: "owner",
        status: "active",
      },
      {
        upsert: true,
        new: true,
        runValidators: true,
      }
    );

    const chatbotLink = await linkSafeTerrapeakChatbot({
      company,
      owner,
    });

    const provisioning = await provisionCompany({
      companyId: company._id,
      ownerUserId: owner._id,
      mode: "platform-workspace",
    });
    const installation = await CompanyAppInstallation.findOne({
      companyId: company._id,
      appSlug: "ai-assistant",
    });

    console.log("Terrapeak company setup complete");
    console.log(
      JSON.stringify(
        {
          companyId: company._id.toString(),
          slug: company.slug,
          ownerUserId: owner._id.toString(),
          ownerEmail: owner.email,
          membershipId: membership._id.toString(),
          aiAssistantInstallationId: installation?._id?.toString() || null,
          chatbotLink,
          provisioning,
        },
        null,
        2
      )
    );

    process.exit(0);
  } catch (error) {
    console.error("Terrapeak company setup failed:", error.message);
    process.exit(1);
  }
}

setupTerrapeakCompany();
