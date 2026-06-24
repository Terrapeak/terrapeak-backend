import { google } from "googleapis";
import User from "../models/user.js";
import { configDotenv } from "dotenv";
configDotenv();

// Use environment variable for redirect URI (set in .env or server config)
const redirectUri = process.env.GOOGLE_REDIRECT_URI;
console.log("redretc url is", redirectUri);
//console.log("google mai hai", "http://localhost:5173/dashboard/oauth/callback");
// Factory function to create OAuth client using user's credentials

export const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  redirectUri
);
// Save new tokens automatically if refreshed

// Generate Google OAuth URL for user
// export const getGoogleAuthUrl = async (userId) => {
//   const user = await User.findById(userId).select("googleClientId googleClientSecret");
//   if (!user || !user.googleClientId || !user.googleClientSecret) {
//     throw new Error(`Missing Google client credentials for user ${userId}`);
//   }

//   const oAuth2Client = new google.auth.OAuth2(
//     user.googleClientId,
//     user.googleClientSecret,
//     redirectUri
//   );

//   const SCOPES = ["https://www.googleapis.com/auth/calendar"];
//   const authUrl = oAuth2Client.generateAuthUrl({
//     access_type: "offline",
//     prompt: "consent",
//     scope: SCOPES,
//     state: userId, // Add userId as state for CSRF protection
//   });

//   return authUrl;
// };

// // Create Google Meet for a specific user (owner)
export const createGoogleMeet = async ({
  userId,
  summary,
  description,
  startTime,
  endTime,
  timeZone,
  attendeeEmail,
  attendeeName,
}) => {
  try {
    console.log("ALLOW_FAKE_GOOGLE_MEET:", process.env.ALLOW_FAKE_GOOGLE_MEET);
        
    // LOCAL TESTING ONLY
    if (process.env.ALLOW_FAKE_GOOGLE_MEET === "true") {
      return {
        hangoutLink: "https://meet.google.com/local-test-meet",
        eventId: `local-test-${Date.now()}`,
      };
    }
    const user = await User.findById(userId);
    if (!user || !user.isGoogleOauth) return null;

    oauth2Client.setCredentials({
      access_token: user.googleAccessToken,
      refresh_token: user.googleRefreshToken,
    });

    // Force refresh if needed
    await oauth2Client.getAccessToken();

    const updatedCredentials = oauth2Client.credentials;

    // Save new tokens if refreshed
    if (
      updatedCredentials.access_token !== user.googleAccessToken ||
      updatedCredentials.refresh_token
    ) {
      await User.findByIdAndUpdate(userId, {
        googleAccessToken: updatedCredentials.access_token,
        ...(updatedCredentials.refresh_token && {
          googleRefreshToken: updatedCredentials.refresh_token,
        }),
      });
    }

    const calendar = google.calendar({
      version: "v3",
      auth: oauth2Client,
    });

    const response = await calendar.events.insert({
  calendarId: "primary",
  requestBody: {
    summary,
    description,
    start: {
      dateTime: startTime.toISOString(),
      timeZone: timeZone,
    },
    end: {
      dateTime: endTime.toISOString(),
      timeZone: timeZone,
    },
    attendees: attendeeEmail
      ? [
          {
            email: attendeeEmail,
            displayName: attendeeName || "",
          },
        ]
      : [],
    conferenceData: {
      createRequest: {
        requestId: `meet-${Date.now()}`,
        conferenceSolutionKey: { type: "hangoutsMeet" },
      },
    },
  },
  conferenceDataVersion: 1,
  sendUpdates: "all",
});

    return {
      hangoutLink: response.data.hangoutLink,
      eventId: response.data.id,
    };
  } catch (err) {
    console.error("Google Meet Error:", err);

    if (
      err?.response?.data?.error === "invalid_grant" ||
      err?.response?.data?.error === "unauthorized_client"
    ) {
      await User.findByIdAndUpdate(userId, {
        isGoogleOauth: false,
        googleAccessToken: null,
        googleRefreshToken: null,
      });

      console.log("Google disconnected for user:", userId);
    }

    return null;
  }
};

export const deleteGoogleEvent = async (user, eventId) => {
  try {
    oauth2Client.setCredentials({
      access_token: user.googleAccessToken,
      refresh_token: user.googleRefreshToken,
    });

    const calendar = google.calendar({
      version: "v3",
      auth: oauth2Client,
    });

    await calendar.events.delete({
      calendarId: "primary",
      eventId,
    });
  } catch (err) {
    console.error("Google delete event error:", err);

    const errorMessage =
      err?.response?.data?.error?.message ||
      err?.response?.data?.error ||
      err?.message;

    // Handle expired / revoked token
    if (
      errorMessage?.includes("invalid_grant") ||
      errorMessage?.includes("Invalid Credentials") ||
      err?.response?.status === 401
    ) {
      await User.findByIdAndUpdate(user._id, {
        isGoogleOauth: false,
        googleAccessToken: null,
        googleRefreshToken: null,
      });
    }
  }
};
