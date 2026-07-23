import crypto from "crypto";
import asyncHandler from "express-async-handler";

import Company from "../models/company.js";
import CompanyMembership from "../models/companyMembership.js";
import User from "../models/user.js";
import {
  issueInvitation,
  issuePasswordReset,
} from "../services/userLifecycleService.js";

const MEMBERSHIP_ROLES = new Set(["owner", "admin", "manager", "staff", "viewer"]);
const ACTIVITY_LIMIT = 50;

const appendActivity = async ({ companyId, title, actor, metadata = {} }) => {
  await Company.updateOne(
    { _id: companyId },
    {
      $push: {
        activityEvents: {
          $each: [
            {
              eventType: "updated",
              title,
              appSlug: "platform-admin",
              appName: "Platform Administration",
              actorUserId: actor?._id || null,
              actorName: actor?.name || "",
              actorEmail: actor?.email || "",
              createdAt: new Date(),
              metadata,
            },
          ],
          $position: 0,
          $slice: ACTIVITY_LIMIT,
        },
      },
    }
  );
};

const createInternalPassword = () => crypto.randomBytes(24).toString("base64url");

export const invitePlatformCompanyUser = asyncHandler(async (req, res) => {
  const { companyId } = req.params;
  const {
    name,
    email,
    phone,
    country,
    role = "staff",
  } = req.body;

  const company = await Company.findById(companyId);
  if (!company) {
    return res.status(404).json({ success: false, message: "Company not found." });
  }

  if (!name || !email || !phone) {
    return res.status(400).json({
      success: false,
      message: "Name, email and phone are required.",
    });
  }

  if (!MEMBERSHIP_ROLES.has(role)) {
    return res.status(400).json({ success: false, message: "Invalid company role." });
  }

  const activeMemberships = await CompanyMembership.countDocuments({
    companyId: company._id,
    status: "active",
  });

  if (activeMemberships >= company.maxUsers) {
    return res.status(409).json({
      success: false,
      message: `This company has reached its maximum of ${company.maxUsers} active users.`,
    });
  }

  const normalizedEmail = String(email).trim().toLowerCase();
  const normalizedPhone = String(phone).trim();
  let user = await User.findOne({ email: normalizedEmail });
  let membership = null;
  let createdUser = false;

  if (!user) {
    const phoneConflict = await User.findOne({ phone: normalizedPhone }).select("_id");
    if (phoneConflict) {
      return res.status(409).json({ success: false, message: "Phone number is already in use." });
    }

    user = await User.create({
      name: String(name).trim(),
      email: normalizedEmail,
      phone: normalizedPhone,
      password: createInternalPassword(),
      country: country || company.country,
      companyName: company.name,
      role: "user",
      isAdmin: false,
      platformRole: "none",
      isApproved: false,
      accountStatus: "pending",
      invitationStatus: "not_invited",
    });
    createdUser = true;
  } else {
    membership = await CompanyMembership.findOne({
      companyId: company._id,
      userId: user._id,
    });

    if (membership?.status === "active") {
      return res.status(409).json({
        success: false,
        message: "This user already belongs to the company.",
      });
    }

    user.name = String(name).trim();
    user.phone = normalizedPhone;
    user.country = country || user.country || company.country;
    user.companyName = company.name;
    await user.save();
  }

  if (membership) {
    membership.role = role;
    membership.status = "active";
    await membership.save();
  } else {
    membership = await CompanyMembership.create({
      companyId: company._id,
      userId: user._id,
      role,
      status: "active",
    });
  }

  try {
    await issueInvitation({ user, company, role });
  } catch (error) {
    if (createdUser) {
      await CompanyMembership.deleteOne({ _id: membership._id });
      await User.deleteOne({ _id: user._id });
    } else {
      membership.status = "inactive";
      await membership.save();
    }
    throw error;
  }

  await appendActivity({
    companyId: company._id,
    title: "Company user invited",
    actor: req.platformUser,
    metadata: { userId: user._id, email: user.email, role },
  });

  res.status(201).json({
    success: true,
    message: "Invitation sent.",
    user,
    membership,
  });
});

export const resendPlatformCompanyInvitation = asyncHandler(async (req, res) => {
  const { companyId, membershipId } = req.params;
  const membership = await CompanyMembership.findOne({
    _id: membershipId,
    companyId,
    status: "active",
  });

  if (!membership) {
    return res.status(404).json({ success: false, message: "Company user not found." });
  }

  const [company, user] = await Promise.all([
    Company.findById(companyId),
    User.findById(membership.userId),
  ]);

  if (!company || !user) {
    return res.status(404).json({ success: false, message: "Company user record not found." });
  }

  await issueInvitation({ user, company, role: membership.role });
  await appendActivity({
    companyId,
    title: "Company invitation resent",
    actor: req.platformUser,
    metadata: { userId: user._id, email: user.email },
  });

  res.json({ success: true, message: "Invitation resent." });
});

export const sendPlatformUserPasswordReset = asyncHandler(async (req, res) => {
  const { companyId, membershipId } = req.params;
  const membership = await CompanyMembership.findOne({
    _id: membershipId,
    companyId,
    status: "active",
  });

  if (!membership) {
    return res.status(404).json({ success: false, message: "Company user not found." });
  }

  const user = await User.findById(membership.userId);
  if (!user) {
    return res.status(404).json({ success: false, message: "User record not found." });
  }

  await issuePasswordReset({ user });
  await appendActivity({
    companyId,
    title: "Password reset email sent",
    actor: req.platformUser,
    metadata: { userId: user._id, email: user.email },
  });

  res.json({ success: true, message: "Password reset email sent." });
});
