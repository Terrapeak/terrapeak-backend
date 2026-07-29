import asyncHandler from "express-async-handler";
import User from "../models/user.js";
import { oauth2Client } from "../utils/googleMeet.js";

const redirectAfterGoogleOAuth = (res, status, message, purpose = "calendar") => {
  const encodedMessage = encodeURIComponent(message);
  return res.redirect(
    `${process.env.FRONTEND_URL}${purpose === "content-studio-drive" ? "/dashboard/content-studio" : "/dashboard/appointment"}?googleStatus=${status}&message=${encodedMessage}`,
  );
};

export const exchangeVerifiedGoogleCode = asyncHandler(async (req, res) => {
  try {
    const { code } = req.query;
    const userId = req.googleOAuthUserId;
    const purpose = req.googleOAuthPurpose || "calendar";

    if (!code) {
      return redirectAfterGoogleOAuth(
        res,
        "false",
        "Google authorization code is required",
        purpose,
      );
    }

    if (!userId) {
      return redirectAfterGoogleOAuth(
        res,
        "false",
        "Google authorization session is invalid or has expired.",
        purpose,
      );
    }

    const { tokens } = await oauth2Client.getToken(code);

    if (!tokens?.access_token) {
      return redirectAfterGoogleOAuth(
        res,
        "false",
        "Failed to exchange Google authorization code.",
        purpose,
      );
    }

    const user = await User.findById(userId);

    if (!user) {
      return redirectAfterGoogleOAuth(res, "false", "User not found.", purpose);
    }

    user.isGoogleOauth = true;
    user.googleAccessToken = tokens.access_token;

    if (tokens.refresh_token) {
      user.googleRefreshToken = tokens.refresh_token;
    }

    await user.save();

    return redirectAfterGoogleOAuth(
      res,
      "true",
      purpose === "content-studio-drive"
        ? "Google Drive connected successfully"
        : "Google Calendar connected successfully",
      purpose,
    );
  } catch (error) {
    console.error("Google OAuth callback failed:", error.message);
    return redirectAfterGoogleOAuth(res, "false", "Google authentication failed.", req.googleOAuthPurpose);
  }
});
