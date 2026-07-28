const validateSignupPassword = (req, res, next) => {
  const password = req.body?.password;

  if (typeof password !== "string" || password.length < 8) {
    return res.status(400).json({
      success: false,
      code: "PASSWORD_TOO_SHORT",
      message: "Password must be at least 8 characters long.",
    });
  }

  return next();
};

export default validateSignupPassword;
