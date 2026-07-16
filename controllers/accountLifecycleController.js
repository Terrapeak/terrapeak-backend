import asyncHandler from "express-async-handler";

import User from "../models/user.js";
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
  user.invitationStatus = "accepted";
  user.invitationTokenHash = null;
  user.invitationExpiresAt = null;
  user.accountStatus = "active";
  user.isApproved = true;
  await user.save();

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
  user.passwordResetTokenHash = null;
  user.passwordResetExpiresAt = null;
  user.accountStatus = "active";
  await user.save();

  res.json({
    success: true,
    message: "Your password has been updated. You can now sign in.",
  });
});
