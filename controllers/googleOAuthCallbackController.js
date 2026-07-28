import asyncHandler from "express-async-handler";
import User from "../models/user.js";
import { oauth2Client } from "../utils/googleMeet.js";

const redirectToAppointment = (res, status, message) => {
  const encodedMessage = encodeURIComponent(message);
  return res.redirect(
    `${process.env.FRONTEND_URL}/dashboard/appointment?status=${status}&message=${encodedMessage}`,
  );
};

export const exchangeVerifiedGoogleCode = asyncHandler(async (req, res) => {
  try {
    const { code } = req.query;
    const userId = req.googleOAuthUserId;

    if (!code) {
      return redirectToAppointment(
        res,
        "false",
        "Google authorization code is required",
      );
    }

    if (!userId) {
      return redirectToAppointment(
        res,
        "false",
        "Google authorization session is invalid or has expired.",
      );
    }

    const { tokens } = await oauth2Client.getToken(code);

    if (!tokens?.access_token) {
      return redirectToAppointment(
        res,
        "false",
        "Failed to exchange Google authorization code.",
      );
    }

    const user = await User.findById(userId);

    if (!user) {
      return redirectToAppointment(res, "false", "User not found.");
    }

    user.isGoogleOauth = true;
    user.googleAccessToken = tokens.access_token;

    if (tokens.refresh_token) {
      user.googleRefreshToken = tokens.refresh_token;
    }

    await user.save();

    return redirectToAppointment(
      res,
      "true",
      "Google Calendar connected successfully",
    );
  } catch (error) {
    console.error("Google OAuth callback failed:", error.message);
    return redirectToAppointment(res, "false", "Google authentication failed.");
  }
});
