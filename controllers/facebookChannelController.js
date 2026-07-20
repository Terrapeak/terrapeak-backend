import asyncHandler from "express-async-handler";
import CompanyMembership from "../models/companyMembership.js";
import CompanyAppInstallation from "../models/companyAppInstallation.js";
import FacebookChannelConfig from "../models/facebookChannelConfig.js";

const getChannelState = ({ installation, config }) => {
  if (
    !installation ||
    !installation.enabled ||
    installation.status === "disabled"
  ) {
    return "not_installed";
  }

  if (config?.connectionStatus === "error") {
    return "connection_error";
  }

  if (config?.connectionStatus === "connected") {
    return "connected";
  }

  return "not_connected";
};

export const getFacebookChannel = asyncHandler(async (req, res) => {
  const membership = await CompanyMembership.findOne({
    userId: req.userId,
    isActive: true,
  });

  if (!membership) {
    return res.status(404).json({
      success: false,
      message: "No active company membership found.",
    });
  }

  const [installation, config] = await Promise.all([
    CompanyAppInstallation.findOne({
      companyId: membership.companyId,
      appSlug: "facebook",
    }),
    FacebookChannelConfig.findOne({
      companyId: membership.companyId,
    }),
  ]);

  const state = getChannelState({ installation, config });

  return res.json({
    success: true,
    channel: {
      slug: "facebook",
      name: "Facebook Messenger",
      state,
      installed: state !== "not_installed",
      connection: {
        pageId: config?.pageId || null,
        pageName: config?.pageName || null,
        connectedAt: config?.connectedAt || null,
        lastError: config?.lastError || null,
      },
    },
  });
});
