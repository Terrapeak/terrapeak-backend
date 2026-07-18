import asyncHandler from "express-async-handler";
import jwt from "jsonwebtoken";

import User from "../models/user.js";
import Company from "../models/company.js";
import CompanyMembership from "../models/companyMembership.js";
import Otp from "../models/otp.js";
import sendEmail from "../utils/sendEmail.js";

/* =====================================================
   HELPERS
===================================================== */

const PLATFORM_ROLES = ["platform-owner", "platform-admin"];

const isValidEmail = (email) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

const isValidPhone = (phone) =>
  /^[0-9]{10}$/.test(phone);

const cookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: "None",
  maxAge: 24 * 60 * 60 * 1000,
};

const platformCookieOptions = {
  ...cookieOptions,
  maxAge: 8 * 60 * 60 * 1000,
};

const generateOTP = () =>
  Math.floor(100000 + Math.random() * 900000).toString();

const createAuthToken = (user) =>
  jwt.sign(
    {
      _id: user._id,
      isAdmin: user.isAdmin,
      role: user.role || "user",
      platformRole: user.platformRole || "none",
      authScope: "dashboard",
    },
    process.env.JWT_SECRET,
    {
      expiresIn: "1d",
    }
  );

const createPlatformToken = (user) =>
  jwt.sign(
    {
      _id: user._id,
      platformRole: user.platformRole,
      authScope: "platform",
    },
    process.env.JWT_SECRET,
    {
      expiresIn: "8h",
    }
  );

const buildUserResponse = (user) => ({
  _id: user._id,
  name: user.name,
  email: user.email,
  phone: user.phone,
  country: user.country,
  companyName: user.companyName,
  isAdmin: user.isAdmin,
  isApproved: user.isApproved,
  role: user.role || "user",
  platformRole: user.platformRole || "none",
});

const buildPlatformUserResponse = (user) => ({
  _id: user._id,
  name: user.name,
  email: user.email,
  platformRole: user.platformRole,
});

/* =====================================================
   STEP 1 — REQUEST SIGNUP OTP
===================================================== */

export const requestSignupOTP = asyncHandler(
  async (req, res) => {
    const {
      name,
      email,
      password,
      phone,
      country,
      companyName,
    } = req.body;

    if (
      !name ||
      !email ||
      !password ||
      !phone ||
      !companyName
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Name, email, password, phone, and company name are required.",
      });
    }

    const normalizedEmail = email
      .trim()
      .toLowerCase();

    const normalizedPhone = phone.trim();

    if (!isValidEmail(normalizedEmail)) {
      return res.status(400).json({
        success: false,
        message: "Invalid email format.",
      });
    }

    if (!isValidPhone(normalizedPhone)) {
      return res.status(400).json({
        success: false,
        message: "Invalid phone number.",
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message:
          "Password must be at least 6 characters long.",
      });
    }

    const existingEmail = await User.findOne({
      email: normalizedEmail,
    });

    if (existingEmail) {
      return res.status(400).json({
        success: false,
        message: "Email is already registered.",
      });
    }

    const existingPhone = await User.findOne({
      phone: normalizedPhone,
    });

    if (existingPhone) {
      return res.status(400).json({
        success: false,
        message: "Phone is already registered.",
      });
    }

    const otp = generateOTP();

    await Otp.deleteMany({
      email: normalizedEmail,
    });

    await Otp.create({
      email: normalizedEmail,
      otp,
    });

    await sendEmail({
      to: normalizedEmail,
      subject: "Your Terrapeak verification code",
      text: `Your Terrapeak verification code is ${otp}.`,
      html: `
        <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
          <h2>Email Verification</h2>
          <p>Hi <b>${name}</b>,</p>
          <p>Use the following verification code to complete your signup:</p>
          <div style="font-size: 28px; font-weight: bold; letter-spacing: 6px; margin: 20px 0;">
            ${otp}
          </div>
          <p>After verification, your account will await Terrapeak approval.</p>
        </div>
      `,
    });

    return res.status(200).json({
      success: true,
      message:
        "Verification code sent successfully.",
    });
  }
);

/* =====================================================
   STEP 2 — VERIFY OTP AND CREATE PENDING USER
===================================================== */

export const verifySignupOTP = asyncHandler(
  async (req, res) => {
    const {
      name,
      email,
      password,
      phone,
      country,
      companyName,
      otp,
    } = req.body;

    if (
      !name ||
      !email ||
      !password ||
      !phone ||
      !companyName ||
      !otp
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Name, email, password, phone, company name, and OTP are required.",
      });
    }

    const normalizedEmail = email
      .trim()
      .toLowerCase();

    const normalizedPhone = phone.trim();

    const record = await Otp.findOne({
      email: normalizedEmail,
      otp: otp.toString().trim(),
    });

    if (!record) {
      return res.status(400).json({
        success: false,
        message:
          "Invalid or expired verification code.",
      });
    }

    const existingEmail = await User.findOne({
      email: normalizedEmail,
    });

    if (existingEmail) {
      await Otp.deleteMany({
        email: normalizedEmail,
      });

      return res.status(400).json({
        success: false,
        message: "Email is already registered.",
      });
    }

    const existingPhone = await User.findOne({
      phone: normalizedPhone,
    });

    if (existingPhone) {
      return res.status(400).json({
        success: false,
        message: "Phone is already registered.",
      });
    }

    const user = new User({
      name: name.trim(),
      email: normalizedEmail,
      password,
      phone: normalizedPhone,
      country,
      companyName: companyName.trim(),
      isAdmin: false,
      role: "user",
      platformRole: "none",
      isApproved: false,
    });

    await user.save();

    await Otp.deleteMany({
      email: normalizedEmail,
    });

    return res.status(201).json({
      success: true,
      approvalRequired: true,
      message:
        "Email verified successfully. Your account is awaiting Terrapeak approval.",
      user: buildUserResponse(user),
    });
  }
);

/* =====================================================
   DASHBOARD LOGIN
===================================================== */

export const login = asyncHandler(
  async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message:
          "Email and password are required.",
      });
    }

    const normalizedEmail = email
      .trim()
      .toLowerCase();

    if (!isValidEmail(normalizedEmail)) {
      return res.status(400).json({
        success: false,
        message: "Invalid email format.",
      });
    }

    const user = await User.findOne({
      email: normalizedEmail,
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found.",
      });
    }

    const isMatch =
      await user.matchPassword(password);

    if (!isMatch) {
      return res.status(400).json({
        success: false,
        message:
          "Invalid email or password.",
      });
    }

    if (!user.isApproved) {
      return res.status(403).json({
        success: false,
        code: "ACCOUNT_PENDING_APPROVAL",
        message:
          "Your account is awaiting Terrapeak approval. You will receive an email when your company environment is ready.",
      });
    }

    const token = createAuthToken(user);
    const userData = buildUserResponse(user)

    return res
      .cookie("token", token, cookieOptions)
      .status(200)
      .json({
        success: true,
        message: "Login successful.",
        user: userData,
        token,
      });
  }
);

/* =====================================================
   PLATFORM LOGIN
===================================================== */

export const platformLogin = asyncHandler(
  async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required.",
      });
    }

    const normalizedEmail = email.trim().toLowerCase();

    if (!isValidEmail(normalizedEmail)) {
      return res.status(400).json({
        success: false,
        message: "Invalid email format.",
      });
    }

    const user = await User.findOne({ email: normalizedEmail });

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Invalid platform credentials.",
      });
    }

    const isMatch = await user.matchPassword(password);

    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: "Invalid platform credentials.",
      });
    }

    if (!user.isApproved) {
      return res.status(403).json({
        success: false,
        message: "This platform account is not active.",
      });
    }

    if (!PLATFORM_ROLES.includes(user.platformRole)) {
      return res.status(403).json({
        success: false,
        message: "Terrapeak platform access required.",
      });
    }

    const platformCompanies = await Company.find({
      isPlatformWorkspace: true,
      isActive: true,
    }).select("_id");

    if (platformCompanies.length !== 1) {
      console.error(
        `Platform configuration error: expected exactly one Platform Workspace, found ${platformCompanies.length}.`
      );

      return res.status(500).json({
        success: false,
        message: "Platform configuration error. Please contact Terrapeak.",
      });
     }

const platformCompany = platformCompanies[0];
                          
    if (!platformCompany) {
      return res.status(403).json({
        success: false,
        message: "Platform workspace is not configured.",
      });
    }

    const platformMembership = await CompanyMembership.findOne({
      companyId: platformCompany._id,
      userId: user._id,
      isActive: true,
    }).select("_id");


if (!platformMembership) {
  return res.status(403).json({
    success: false,
    message: "Terrapeak platform access required.",
  });
}
    const platformToken = createPlatformToken(user);

    return res
      .cookie("platformToken", platformToken, platformCookieOptions)
      .status(200)
      .json({
        success: true,
        message: "Platform login successful.",
        platformUser: buildPlatformUserResponse(user),
        platformToken,
      });
  }
);

/* =====================================================
   LOGOUTS
===================================================== */

export const logout = asyncHandler(
  async (req, res) => {
    return res
      .clearCookie("token", {
        httpOnly: true,
        secure: true,
        sameSite: "None",
      })
      .status(200)
      .json({
        success: true,
        message: "Logged out successfully.",
      });
  }
);

export const platformLogout = asyncHandler(
  async (req, res) => {
    return res
      .clearCookie("platformToken", {
        httpOnly: true,
        secure: true,
        sameSite: "None",
      })
      .status(200)
      .json({
        success: true,
        message: "Platform logout successful.",
      });
  }
);
