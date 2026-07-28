import crypto from "crypto";

const STATE_TTL_MS = 10 * 60 * 1000;

const getSecret = () => {
  const secret = process.env.GOOGLE_OAUTH_STATE_SECRET || process.env.JWT_SECRET;

  if (!secret) {
    throw new Error("Google OAuth state secret is not configured.");
  }

  return secret;
};

const encode = (value) =>
  Buffer.from(JSON.stringify(value), "utf8").toString("base64url");

const sign = (payload) =>
  crypto.createHmac("sha256", getSecret()).update(payload).digest("base64url");

export const createGoogleOAuthState = (userId) => {
  const payload = encode({
    userId: String(userId),
    issuedAt: Date.now(),
    nonce: crypto.randomBytes(16).toString("hex"),
  });

  return `${payload}.${sign(payload)}`;
};

export const verifyGoogleOAuthState = (state) => {
  if (typeof state !== "string") return null;

  const [payload, signature] = state.split(".");
  if (!payload || !signature) return null;

  const expected = Buffer.from(sign(payload), "utf8");
  const provided = Buffer.from(signature, "utf8");

  if (
    expected.length !== provided.length ||
    !crypto.timingSafeEqual(expected, provided)
  ) {
    return null;
  }

  try {
    const decoded = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    );

    if (
      !decoded?.userId ||
      !Number.isFinite(decoded?.issuedAt) ||
      Date.now() - decoded.issuedAt > STATE_TTL_MS
    ) {
      return null;
    }

    return decoded;
  } catch {
    return null;
  }
};
