import User from "../models/user.js";

const normalizeEnvironment = () =>
  String(process.env.APP_ENV || process.env.NODE_ENV || "")
    .trim()
    .toLowerCase();

const isStagingEnvironment = () =>
  ["staging", "stage", "preview", "test"].includes(normalizeEnvironment());

const normalizeEmail = (value) => String(value || "").trim().toLowerCase();

export const bootstrapStagingPlatformOwner = async () => {
  if (!isStagingEnvironment()) return null;

  const email = normalizeEmail(process.env.PLATFORM_BOOTSTRAP_EMAIL);
  if (!email) {
    console.log("Staging Platform bootstrap skipped: PLATFORM_BOOTSTRAP_EMAIL is not set");
    return null;
  }

  const user = await User.findOne({ email });
  if (!user) {
    console.log(`Staging Platform bootstrap waiting for verified user: ${email}`);
    return null;
  }

  const alreadyConfigured =
    user.platformRole === "platform-owner" &&
    user.isAdmin === true &&
    user.role === "admin" &&
    user.isApproved === true &&
    user.accountStatus === "active";

  if (alreadyConfigured) {
    console.log(`Staging Platform owner ready: ${email}`);
    return user;
  }

  user.platformRole = "platform-owner";
  user.isAdmin = true;
  user.role = "admin";
  user.isApproved = true;
  user.accountStatus = "active";
  user.mustChangePassword = false;
  await user.save();

  console.log(`Staging Platform owner bootstrapped: ${email}`);
  return user;
};

export default bootstrapStagingPlatformOwner;
