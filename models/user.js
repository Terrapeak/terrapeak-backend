import mongoose from "mongoose";
import bcrypt from "bcrypt";
import { PLATFORM_ROLES } from "../utils/roleSeparation.js";

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    email: { type: String, unique: true, required: true },
    phone: { type: String, unique: true, required: true },
    password: { type: String, required: true },
    country: { type: String, required: false },
    companyName: { type: String, required: false },
    isAdmin: { type: Boolean, default: false },
    role: {
      type: String,
      enum: ["user", "admin"],
      default: "user",
      required: true,
    },
    platformRole: {
      type: String,
      enum: PLATFORM_ROLES,
      default: "none",
    },
    isApproved: { type: Boolean, default: false },
    accountStatus: {
      type: String,
      enum: ["pending", "active", "suspended", "removed"],
      default: "active",
    },
    invitationStatus: {
      type: String,
      enum: ["not_invited", "pending", "accepted", "expired"],
      default: "not_invited",
    },
    invitationTokenHash: { type: String, default: null },
    invitationExpiresAt: { type: Date, default: null },
    invitationSentAt: { type: Date, default: null },
    passwordResetTokenHash: { type: String, default: null },
    passwordResetExpiresAt: { type: Date, default: null },
    passwordResetSentAt: { type: Date, default: null },
    isGoogleOauth: { type: Boolean, default: false },
    googleRefreshToken: { type: String },
    googleAccessToken: { type: String },
  },
  { timestamps: true }
);

userSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

userSchema.methods.matchPassword = async function (enteredPassword) {
  return bcrypt.compare(enteredPassword, this.password);
};

const User = mongoose.model("User", userSchema);

export default User;
