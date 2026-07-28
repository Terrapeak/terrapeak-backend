import crypto from "crypto";
import mongoose from "mongoose";

const hashOtp = (value) => {
  if (value === undefined || value === null) return value;

  const secret = process.env.OTP_HASH_SECRET || process.env.JWT_SECRET;

  if (!secret) {
    throw new Error("OTP hashing secret is not configured.");
  }

  return crypto
    .createHmac("sha256", secret)
    .update(String(value).trim())
    .digest("hex");
};

const otpSchema = new mongoose.Schema({
  email: { type: String, required: true, lowercase: true, trim: true },
  otp: {
    type: String,
    required: true,
    set: hashOtp,
    select: false,
  },
  createdAt: { type: Date, default: Date.now, expires: 300 },
});

export default mongoose.model("Otp", otpSchema);
