import asyncHandler from "express-async-handler";

import User from "../models/user.js";
import ensureOrganizationMembershipsForCompanyUser from "../services/customerWorkspaceMembershipService.js";
import {
  findInvitationUser,
  findPasswordResetUser,
} from "../services/userLifecycleService.js";

const validatePassword = (password) =>
  typeof password === "string" && password.length >= 8;

export const acceptInvitation = asyncHandler(async (req, res) => {
  const { token, password } = req.body;

  if (!token || !validatePassword(password)) {
    return res.status(400).json({
      success: false,
      message: "A valid invitation token and password of at least 8 characters are required.",
    });
  }

  const user = await findInvitationUser(User, token);

  if (!user) {
    return res.status(400).json({
      success: false,
      message: "This invitation is invalid or has expired.",
    });
  }

  user.password = password;
  user.mustChangePassword = false;
  user.invitationStatus = "accepted";
  user.invitationTokenHash = null;
  user.invitationExpiresAt = null;
  user.accountStatus = "active";
  user.isApproved = true;
  await user.save();

  await ensureOrganizationMembershipsForCompanyUser({ userId: user._id });

  res.json({
    success: true,
    message: "Your account is ready. You can now sign in.",
  });
});

export const completePasswordReset = asyncHandler(async (req, res) => {
  const { token, password } = req.body;

  if (!token || !validatePassword(password)) {
    return res.status(400).json({
      success: false,
      message: "A valid reset token and password of at least 8 characters are required.",
    });
  }

  const user = await findPasswordResetUser(User, token);

  if (!user) {
    return res.status(400).json({
      success: false,
      message: "This password reset link is invalid or has expired.",
    });
  }

  user.password = password;
  user.passwordChangedAt = new Date();
  user.mustChangePassword = false;
  user.passwordResetTokenHash = null;
  user.passwordResetExpiresAt = null;
  user.accountStatus = "active";
  await user.save();

  await ensureOrganizationMembershipsForCompanyUser({ userId: user._id });

  res.json({
    success: true,
    message: "Your password has been updated. You can now sign in.",
  });
});

export const changeTemporaryPassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};

  if (!currentPassword || !validatePassword(newPassword)) {
    return res.status(400).json({
      success: false,
      message: "Your current password and a new password of at least 8 characters are required.",
    });
  }

  if (!req.user?.mustChangePassword) {
    return res.status(409).json({
      success: false,
      message: "This account does not require a temporary password change.",
    });
  }

  const matches = await req.user.matchPassword(currentPassword);
  if (!matches) {
    return res.status(400).json({
      success: false,
      message: "The current temporary password is incorrect.",
    });
  }

  if (await req.user.matchPassword(newPassword)) {
    return res.status(400).json({
      success: false,
      message: "Choose a new password that is different from the temporary password.",
    });
  }

  req.user.password = newPassword;
  req.user.mustChangePassword = false;
  await req.user.save();

  await ensureOrganizationMembershipsForCompanyUser({ userId: req.user._id });

  res.json({
    success: true,
    message: "Your password has been changed. Your workspace is now available.",
    user: {
      _id: req.user._id,
      name: req.user.name,
      email: req.user.email,
      phone: req.user.phone,
      country: req.user.country,
      companyName: req.user.companyName,
      isAdmin: req.user.isAdmin,
      isApproved: req.user.isApproved,
      role: req.user.role || "user",
      platformRole: req.user.platformRole || "none",
      mustChangePassword: false,
    },
  });
});
