import {
  createGoogleOAuthState,
  verifyGoogleOAuthState,
} from "../utils/googleOAuthState.js";

export const signGoogleOAuthUrlState = (req, res, next) => {
  const originalJson = res.json.bind(res);

  res.json = (body) => {
    if (body?.url) {
      try {
        const authUrl = new URL(body.url);
        authUrl.searchParams.set("state", createGoogleOAuthState(req.userId));
        body = { ...body, url: authUrl.toString() };
      } catch {
        return originalJson({
          success: false,
          message: "Google authorization could not be started.",
        });
      }
    }

    return originalJson(body);
  };

  return next();
};

export const verifyGoogleOAuthCallbackState = (req, res, next) => {
  const decodedState = verifyGoogleOAuthState(req.query?.state);

  if (!decodedState) {
    const message = encodeURIComponent(
      "Google authorization session is invalid or has expired.",
    );

    return res.redirect(
      `${process.env.FRONTEND_URL}/dashboard/appointment?status=false&message=${message}`,
    );
  }

  req.googleOAuthUserId = decodedState.userId;
  return next();
};
