const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

const parseConfiguredOrigins = () =>
  String(process.env.FRONTEND_URLS || process.env.FRONTEND_URL || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

const getTrustedOrigins = () =>
  new Set(
    [
      ...parseConfiguredOrigins(),
      "https://terrapeak-gemini-assistant.vercel.app",
      "https://platform.terrapeakgroup.com",
      "https://dashboard.terrapeakgroup.com",
      ...(process.env.NODE_ENV === "production"
        ? []
        : [
            "http://localhost:5173",
            "http://localhost:5174",
            "http://localhost:5175",
          ]),
    ].filter(Boolean),
  );

const requireTrustedCookieOrigin = (req, res, next) => {
  if (SAFE_METHODS.has(req.method)) return next();

  const usesCookieAuthentication = Boolean(
    req.cookies?.token || req.cookies?.platformToken,
  );

  if (!usesCookieAuthentication) return next();

  const origin = req.get("origin");
  const trustedOrigins = getTrustedOrigins();

  if (!origin || !trustedOrigins.has(origin)) {
    return res.status(403).json({
      success: false,
      code: "UNTRUSTED_REQUEST_ORIGIN",
      message: "This request origin is not allowed.",
    });
  }

  return next();
};

export default requireTrustedCookieOrigin;
