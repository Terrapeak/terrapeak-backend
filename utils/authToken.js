import jwt from "jsonwebtoken";

export const AUTH_ERROR_CODES = {
  missing: "TOKEN_MISSING",
  invalid: "TOKEN_INVALID",
  expired: "TOKEN_EXPIRED",
  scope: "AUTH_SCOPE_INVALID",
};

export const getRequestToken = (req, cookieName) => {
  const authorizationHeader = req.get("authorization");
  const bearerToken = authorizationHeader?.startsWith("Bearer ")
    ? authorizationHeader.slice(7).trim()
    : null;

  return {
    token: bearerToken || req.cookies?.[cookieName] || null,
    source: bearerToken ? "bearer" : req.cookies?.[cookieName] ? "cookie" : null,
  };
};

export const verifyRequestToken = ({ req, cookieName, expectedScope }) => {
  const { token, source } = getRequestToken(req, cookieName);

  if (!token) {
    return {
      error: {
        status: 401,
        code: AUTH_ERROR_CODES.missing,
        message: "Authentication token is missing.",
      },
    };
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (decoded.authScope !== expectedScope) {
      return {
        error: {
          status: 401,
          code: AUTH_ERROR_CODES.scope,
          message: "Authentication scope is invalid.",
        },
      };
    }

    return { decoded, source };
  } catch (error) {
    const expired = error?.name === "TokenExpiredError";

    return {
      error: {
        status: 401,
        code: expired ? AUTH_ERROR_CODES.expired : AUTH_ERROR_CODES.invalid,
        message: expired ? "Authentication token has expired." : "Authentication token is invalid.",
      },
    };
  }
};

export const sendAuthError = (res, error) =>
  res.status(error.status).json({
    success: false,
    code: error.code,
    message: error.message,
  });
