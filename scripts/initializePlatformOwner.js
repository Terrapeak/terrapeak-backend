import crypto from "crypto";
import dotenv from "dotenv";
import mongoose from "mongoose";

import User from "../models/user.js";

dotenv.config();

const TARGET_EMAIL = "timharmsen@gmail.com";
const TARGET_NAME = "Tim Harmsen";
const TARGET_PHONE = process.env.PLATFORM_OWNER_PHONE || "+6500000001";
const CONFIRMATION = process.env.INITIALIZE_PLATFORM_OWNER_CONFIRMATION;
const REQUIRED_CONFIRMATION = "INITIALIZE_PLATFORM_OWNER";

const createTemporaryPassword = () =>
  `TpV2!${crypto.randomBytes(12).toString("base64url")}#26`;

const run = async () => {
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI is required.");
  if (CONFIRMATION !== REQUIRED_CONFIRMATION) {
    throw new Error(
      `Set INITIALIZE_PLATFORM_OWNER_CONFIRMATION=${REQUIRED_CONFIRMATION}.`,
    );
  }

  const temporaryPassword = createTemporaryPassword();

  await mongoose.connect(process.env.MONGO_URI);

  try {
    let owner = await User.findOne({ email: TARGET_EMAIL });

    if (!owner) {
      owner = new User({
        name: TARGET_NAME,
        email: TARGET_EMAIL,
        phone: TARGET_PHONE,
        password: temporaryPassword,
        country: "SG",
        role: "user",
        isAdmin: false,
        platformRole: "platform-owner",
        isApproved: true,
        accountStatus: "active",
        mustChangePassword: false,
      });
    } else {
      owner.name = TARGET_NAME;
      owner.password = temporaryPassword;
      owner.role = "user";
      owner.isAdmin = false;
      owner.platformRole = "platform-owner";
      owner.isApproved = true;
      owner.accountStatus = "active";
      owner.mustChangePassword = false;
      owner.companyName = undefined;
    }

    await owner.save();

    console.log(
      JSON.stringify(
        {
          success: true,
          temporaryPassword,
          platformOwner: {
            id: String(owner._id),
            name: owner.name,
            email: owner.email,
            platformRole: owner.platformRole,
            isAdmin: owner.isAdmin,
            role: owner.role,
            isApproved: owner.isApproved,
            accountStatus: owner.accountStatus,
          },
        },
        null,
        2,
      ),
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
        code: "PLATFORM_OWNER_INITIALIZATION_FAILED",
        message: error.message,
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
});
