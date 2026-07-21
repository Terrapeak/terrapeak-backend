import axios from "axios";
import FacebookChannelConfig from "../models/facebookChannelConfig.js";
import { decryptSecret } from "../utils/secretEncryption.js";

const requireGraphVersion = () => {
  const graphVersion = process.env.META_GRAPH_API_VERSION?.trim();

  if (!graphVersion || !/^v\d+\.\d+$/.test(graphVersion)) {
    throw new Error("Facebook Graph API version is not configured.");
  }

  return graphVersion;
};

const requireNonEmptyString = (value, name) => {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${name} is required.`);
  }

  return value.trim();
};

export const sendFacebookTextMessage = async ({
  companyId,
  recipientId,
  message,
} = {}) => {
  if (
    !companyId ||
    (typeof companyId === "string" && !companyId.trim())
  ) {
    throw new Error("companyId is required.");
  }

  const normalizedRecipientId = requireNonEmptyString(
    recipientId,
    "recipientId"
  );
  const normalizedMessage = requireNonEmptyString(message, "message");
  const config = await FacebookChannelConfig.findOne({ companyId }).select(
    "+pageAccessTokenEncrypted"
  );

  if (!config) {
    throw new Error("Facebook Messenger is not configured for this company.");
  }

  if (config.connectionStatus !== "connected") {
    throw new Error("Facebook channel is not connected.");
  }

  if (typeof config.pageId !== "string" || !config.pageId.trim()) {
    throw new Error("Facebook Page configuration is incomplete.");
  }

  if (!config.pageAccessTokenEncrypted) {
    throw new Error("Facebook Page credentials are missing.");
  }

  let pageAccessToken;

  try {
    pageAccessToken = decryptSecret(config.pageAccessTokenEncrypted);
  } catch {
    throw new Error("Facebook Page credentials could not be loaded.");
  }

  if (!pageAccessToken) {
    throw new Error("Facebook Page credentials are missing.");
  }

  const graphVersion = requireGraphVersion();
  const endpoint = `https://graph.facebook.com/${graphVersion}/${encodeURIComponent(
    config.pageId.trim()
  )}/messages`;
  const payload = {
    recipient: {
      id: normalizedRecipientId,
    },
    messaging_type: "RESPONSE",
    message: {
      text: normalizedMessage,
    },
  };

  let response;

  try {
    response = await axios.post(endpoint, payload, {
      headers: {
        Authorization: `Bearer ${pageAccessToken}`,
        "Content-Type": "application/json",
      },
      timeout: 15000,
    });
  } catch (error) {
    const status = error.response?.status;
    throw new Error(
      `Meta could not send the Facebook Messenger message${
        status ? ` (HTTP ${status})` : ""
      }.`
    );
  }

  const externalMessageId = response.data?.message_id;

  if (!externalMessageId) {
    throw new Error("Meta did not confirm the Facebook Messenger message.");
  }

  return {
    externalMessageId,
    recipientId: normalizedRecipientId,
  };
};
