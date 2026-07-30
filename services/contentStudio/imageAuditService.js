import ContentStudioImageAudit from "../../models/contentStudioImageAudit.js";

const stripSecrets = (metadata = {}) => {
  const safe = { ...metadata };
  for (const key of [
    "apiKey",
    "geminiKey",
    "imageGeminiKey",
    "accessToken",
    "refreshToken",
    "googleAccessToken",
    "googleRefreshToken",
    "rawBuffer",
    "signedUrl",
  ]) {
    delete safe[key];
  }
  return safe;
};

export const recordImageAudit = async ({
  companyId,
  userId = null,
  imageId = null,
  eventType,
  source = "",
  provider = "",
  fileSize = null,
  model = "",
  secureMetadata = {},
  session,
}) => {
  const [event] = await ContentStudioImageAudit.create(
    [{
      companyId,
      userId,
      imageId,
      eventType,
      source,
      provider,
      fileSize,
      model,
      secureMetadata: stripSecrets(secureMetadata),
    }],
    session ? { session } : undefined,
  );
  return event;
};
