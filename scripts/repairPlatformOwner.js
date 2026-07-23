import dotenv from "dotenv";
import mongoose from "mongoose";

import User from "../models/user.js";

dotenv.config();

const TARGET_EMAIL = "timharmsen@gmail.com";
const TARGET_NAME = "Tim Harmsen";
const CONFIRMATION = process.env.REPAIR_PLATFORM_OWNER_CONFIRMATION;
const REQUIRED_CONFIRMATION = "REPLACE_DUMMY_PLATFORM_OWNER";
const NEW_PASSWORD = process.env.PLATFORM_OWNER_PASSWORD;
const SOURCE_EMAIL = process.env.SOURCE_PLATFORM_OWNER_EMAIL?.trim().toLowerCase();
const AUDIT_MODE = process.argv.includes("--audit");

const serializeUser = (user) => ({
  id: String(user._id),
  name: user.name,
  email: user.email,
  platformRole: user.platformRole,
  isApproved: user.isApproved,
  accountStatus: user.accountStatus,
});

const run = async () => {
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI is required.");

  await mongoose.connect(process.env.MONGO_URI);

  try {
    const currentOwners = await User.find({
      platformRole: "platform-owner",
    }).sort({ email: 1 });

    if (AUDIT_MODE) {
      console.log(
        JSON.stringify(
          {
            success: true,
            mode: "audit",
            count: currentOwners.length,
            platformOwners: currentOwners.map(serializeUser),
          },
          null,
          2
        )
      );
      return;
    }

    if (CONFIRMATION !== REQUIRED_CONFIRMATION) {
      throw new Error(
        `Set REPAIR_PLATFORM_OWNER_CONFIRMATION=${REQUIRED_CONFIRMATION}.`
      );
    }
    if (!NEW_PASSWORD || NEW_PASSWORD.length < 12) {
      throw new Error("PLATFORM_OWNER_PASSWORD must be at least 12 characters.");
    }
    if (!SOURCE_EMAIL) {
      throw new Error(
        "Set SOURCE_PLATFORM_OWNER_EMAIL to the exact current Dummy 7 email shown by the audit."
      );
    }

    const currentOwner = currentOwners.find(
      (owner) => owner.email?.toLowerCase() === SOURCE_EMAIL
    );

    if (!currentOwner) {
      throw new Error(
        `No platform owner found with source email ${SOURCE_EMAIL}. No data was changed.`
      );
    }

    const existingTarget = await User.findOne({
      email: TARGET_EMAIL.toLowerCase(),
    });

    if (
      existingTarget &&
      String(existingTarget._id) !== String(currentOwner._id)
    ) {
      throw new Error(
        `${TARGET_EMAIL} already belongs to another user. No data was changed.`
      );
    }

    currentOwner.name = TARGET_NAME;
    currentOwner.email = TARGET_EMAIL.toLowerCase();
    currentOwner.password = NEW_PASSWORD;
    currentOwner.platformRole = "platform-owner";
    currentOwner.isAdmin = false;
    currentOwner.role = "user";
    currentOwner.isApproved = true;
    currentOwner.accountStatus = "active";
    currentOwner.companyName = undefined;
    await currentOwner.save();

    console.log(
      JSON.stringify(
        {
          success: true,
          message: "Platform owner repaired.",
          replacedSourceEmail: SOURCE_EMAIL,
          userId: String(currentOwner._id),
          email: currentOwner.email,
          name: currentOwner.name,
          platformRole: currentOwner.platformRole,
        },
        null,
        2
      )
    );
  } finally {
    await mongoose.disconnect();
  }
};

run().catch((error) => {
  console.error(
    JSON.stringify(
      {
        success: false,
        code: "PLATFORM_OWNER_REPAIR_FAILED",
        message: error.message,
      },
      null,
      2
    )
  );
  process.exitCode = 1;
});
