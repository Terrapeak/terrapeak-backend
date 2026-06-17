import asyncHandler from "express-async-handler";
import jwt from "jsonwebtoken";
import User from "../models/user.js";
import Otp from "../models/otp.js"; // new OTP model
import sendEmail from "../utils/sendEmail.js";

// Helpers
const isValidEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
const isValidPhone = (phone) => /^[0-9]{10}$/.test(phone);

// Cookie options
const cookieOptions = {
  httpOnly: true,
  secure: true, // Required for HTTPS
  sameSite: "None",
  maxAge: 24 * 60 * 60 * 1000, // 1 day
};

// Generate 6-digit OTP
const generateOTP = () =>
  Math.floor(100000 + Math.random() * 900000).toString();

// 📌 STEP 1: Request OTP for Signup
export const requestSignupOTP = asyncHandler(async (req, res) => {
  const { name, email, password, phone, country, companyName } = req.body;

  if (!name || !email || !password || !phone) {
    return res.status(400).json({
      success: false,
      message: "Name, email, password, and phone are required",
    });
  }

  if (!isValidEmail(email)) {
    return res.status(400).json({
      success: false,
      message: "Invalid email format",
    });
  }

  if (!isValidPhone(phone)) {
    return res.status(400).json({
      success: false,
      message: "Invalid phone number",
    });
  }

  if (password.length < 6) {
    return res.status(400).json({
      success: false,
      message: "Password must be at least 6 characters long",
    });
  }

  if (await User.findOne({ email })) {
    return res.status(400).json({
      success: false,
      message: "Email is already registered",
    });
  }

  if (await User.findOne({ phone })) {
    return res.status(400).json({
      success: false,
      message: "Phone is already registered",
    });
  }

  const user = new User({
    name,
    email,
    password,
    phone,
    country,
    companyName,
  });

  await user.save();

  const token = jwt.sign(
    { _id: user._id, isAdmin: user.isAdmin },
    process.env.JWT_SECRET,
    { expiresIn: "1d" }
  );

  res.cookie("token", token, cookieOptions).status(201).json({
    success: true,
    message: "Signup successful",
    token,
    user,
  });
});

// 📌 STEP 2: Verify OTP & Create Account
export const verifySignupOTP = asyncHandler(async (req, res) => {
  const { name, email, password, phone, country, companyName, otp } = req.body;

  if (!email || !otp)
    return res
      .status(400)
      .json({ success: false, message: "Email and OTP are required" });

  const record = await Otp.findOne({ email, otp });
  if (!record)
    return res
      .status(400)
      .json({ success: false, message: "Invalid or expired OTP" });

  // OTP is valid → create user
  const user = new User({ name, email, password, phone, country, companyName });
  await user.save();

  // Delete OTP after verification
  await Otp.deleteMany({ email });

  // Create JWT
  const token = jwt.sign(
    { _id: user._id, isAdmin: user.isAdmin },
    process.env.JWT_SECRET,
    { expiresIn: "1d" }
  );

  res.cookie("token", token, cookieOptions).status(201).json({
    success: true,
    message: "Signup successful",
    token,
  });
});

// 📌 LOGIN

export const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password)
    return res
      .status(400)
      .json({ success: false, message: "Email and password are required" });
  if (!isValidEmail(email))
    return res
      .status(400)
      .json({ success: false, message: "Invalid email format" });

  const user = await User.findOne({ email });
  if (!user)
    return res.status(404).json({ success: false, message: "User not found" });

  const isMatch = await user.matchPassword(password);
  if (!isMatch)
    return res
      .status(400)
      .json({ success: false, message: "Invalid email or password" });

  const token = jwt.sign(
    { _id: user._id, isAdmin: user.isAdmin },
    process.env.JWT_SECRET,
    { expiresIn: "1d" }
  );

  const userData = {
    name: user.name,
    email: user.email,
    phone: user.phone, // Added phone
    country: user.country, // Added country
    companyName: user.companyName, // Added companyName
    isAdmin: user.isAdmin,
    role: user.role || "user",
  };

  res.cookie("token", token, cookieOptions).status(200).json({
    success: true,
    message: "Login successful",
    user: userData,
    token,
  });
});

// 📌 LOGOUT
export const logout = asyncHandler(async (req, res) => {
  res
    .clearCookie("token", {
      httpOnly: true,
      secure: true,
      sameSite: "None",
    })
    .status(200)
    .json({ success: true, message: "Logged out successfully" });
});
