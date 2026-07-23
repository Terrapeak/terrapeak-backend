import asyncHandler from "express-async-handler";
import FacebookChannelConfig from "../models/facebookChannelConfig.js";

export const disconnectFacebookChannel = asyncHandler(async (req, res) => {
  const membership = req.companyMembership;

  if (membership.role !== "owner") {
    return res.status(403).json({
      success: false,
      message: "Only the company owner can disconnect Facebook.",
    });
  }

  const config = await FacebookChannelConfig.findOne({
    companyId: membership.companyId,
  }).select(
    "+pageAccessTokenEncrypted +availablePages.pageAccessTokenEncrypted +oauthStateNonceHash"
  );

  if (!config) {
    return res.json({
      success: true,
      wizardStep: 1,
      message: "Facebook is already disconnected.",
    });
  }

  config.connectionStatus = "disconnected";
  config.metaUserId = "";
  config.pageId = "";
  config.pageName = "";
  config.pageAccessTokenEncrypted = "";
  config.availablePages = [];
  config.wizardStep = 1;
  config.oauthCompletedAt = null;
  config.oauthStateNonceHash = "";
  config.oauthStateExpiresAt = null;
  config.grantedPermissions = [];
  config.webhookSubscribed = false;
  config.webhookSubscriptionStatus = "not_subscribed";
  config.connectedAt = null;
  config.disconnectedAt = new Date();
  config.lastError = "";
  await config.save();

  return res.json({
    success: true,
    wizardStep: 1,
    message: "Facebook has been disconnected. You can connect it again at any time.",
  });
});
