import dotenv from "dotenv";
import mongoose from "mongoose";

import User from "../models/user.js";

dotenv.config();

const TARGET_EMAIL = "timharmsen@gmail.com";
const TARGET_NAME = "Tim Harmsen";
const CONFIRMATION = process.env.REPAIR_PLATFORM_OWNER_CONFIRMATION;
const REQUIRED_CONFIRMATION = "REPLACE_DUMMY_PLATFORM_OWNER";
const NEW_PASSWORD = process.env.PLATFORM_OWNER_PASSWORD;

const run = async () => {
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI is required.");
  if (CONFIRMATION !== REQUIRED_CONFIRMATION) {
    throw new Error(
      `Set REPAIR_PLATFORM_OWNER_CONFIRMATION=${REQUIRED_CONFIRMATION}.`
    );
  }
  if (!NEW_PASSWORD || NEW_PASSWORD.length < 12) {
    throw new Error("PLATFORM_OWNER_PASSWORD must be at least 12 characters.");
  }

  await mongoose.connect(process.env.MONGO_URI);

  try {
    const existingTarget = await User.findOne({
      email: TARGET_EMAIL.toLowerCase(),
    });
    const currentOwners = await User.find({
      platformRole: "platform-owner",
    });

    if (currentOwners.length !== 1) {
      throw new Error(
        `Expected exactly one current platform owner, found ${currentOwners.length}. No data was changed.`
      );
    }

    const currentOwner = currentOwners[0];

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
