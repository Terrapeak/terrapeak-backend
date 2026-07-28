const normalizeLoginFailure = (req, res, next) => {
  const sendJson = res.json.bind(res);

  res.json = (body) => {
    if (
      res.statusCode === 404 &&
      body?.success === false &&
      body?.message === "User not found."
    ) {
      res.statusCode = 401;
      return sendJson({
        ...body,
        message: "Invalid email or password.",
      });
    }

    return sendJson(body);
  };

  return next();
};

export default normalizeLoginFailure;
