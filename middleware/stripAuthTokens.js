const stripAuthTokens = (req, res, next) => {
  const sendJson = res.json.bind(res);

  res.json = (body) => {
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return sendJson(body);
    }

    const { token, platformToken, ...safeBody } = body;
    return sendJson(safeBody);
  };

  return next();
};

export default stripAuthTokens;
