import crypto from "crypto";
import FacebookChannelConfig from "../models/facebookChannelConfig.js";
import {
  markChannelMessagesDelivered,
  markChannelMessagesRead,
  storeInboundChannelMessage,
  upsertChannelConversation,
} from "./channelConversationService.js";

const CHANNEL = "facebook";

const safeEqual = (firstValue, secondValue) => {
  const first = Buffer.from(firstValue || "", "utf8");
  const second = Buffer.from(secondValue || "", "utf8");

  return first.length === second.length && crypto.timingSafeEqual(first, second);
};

export const verifyFacebookWebhookToken = (providedToken) => {
  const configuredToken = process.env.META_WEBHOOK_VERIFY_TOKEN;
  return Boolean(configuredToken && safeEqual(providedToken, configuredToken));
};

export const verifyFacebookWebhookSignature = ({ rawBody, signature }) => {
  const appSecret = process.env.META_APP_SECRET;

  if (
    !appSecret ||
    !Buffer.isBuffer(rawBody) ||
    typeof signature !== "string" ||
    !/^sha256=[a-f\d]{64}$/i.test(signature)
  ) {
    return false;
  }

  const expectedSignature = `sha256=${crypto
    .createHmac("sha256", appSecret)
    .update(rawBody)
    .digest("hex")}`;

  return safeEqual(signature.toLowerCase(), expectedSignature);
};

const toEventDate = (timestamp) => {
  const parsedTimestamp = Number(timestamp);
  return Number.isFinite(parsedTimestamp) && parsedTimestamp > 0
    ? new Date(parsedTimestamp)
    : new Date();
};

const getEventType = (event) => {
  if (event.message && !event.message.is_echo) return "message";
  if (event.delivery) return "delivery";
  if (event.read) return "read";
  return null;
};

const updateWebhookDiagnostics = ({
  configId,
  processedAt,
  senderId,
  eventType,
}) =>
  FacebookChannelConfig.updateOne(
    { _id: configId },
    {
      $set: {
        lastWebhookProcessedAt: processedAt,
        lastWebhookSenderId: senderId,
        lastWebhookEventType: eventType,
      },
    }
  );

const processMessengerEvent = async ({ config, pageId, event }) => {
  if (event.recipient?.id && event.recipient.id !== pageId) return false;

  const eventType = getEventType(event);
  const senderId = event.sender?.id;

  if (!eventType || !senderId) return false;

  const companyId = config.companyId._id;
  const externalConversationId = `${pageId}:${senderId}`;
  const eventTimestamp = toEventDate(
    event.timestamp || event.delivery?.watermark || event.read?.watermark
  );
  const conversation = await upsertChannelConversation({
    companyId,
    channel: CHANNEL,
    channelAccountId: pageId,
    externalConversationId,
    externalUserId: senderId,
    eventType,
    eventTimestamp,
    hasMessage: eventType === "message",
  });

  if (eventType === "message") {
    const externalMessageId = event.message?.mid;

    if (!externalMessageId) return false;

    await storeInboundChannelMessage({
      companyId,
      conversation,
      channel: CHANNEL,
      externalConversationId,
      externalUserId: senderId,
      externalMessageId,
      message: event.message?.text || "",
      eventTimestamp,
      metadata: {
        attachmentTypes: (event.message?.attachments || [])
          .map((attachment) => attachment.type)
          .filter(Boolean),
      },
    });
  }

  if (eventType === "delivery") {
    await markChannelMessagesDelivered({
      companyId,
      channel: CHANNEL,
      externalMessageIds: event.delivery?.mids || [],
      deliveredAt: toEventDate(event.delivery?.watermark || event.timestamp),
    });
  }

  if (eventType === "read") {
    await markChannelMessagesRead({
      companyId,
      conversationId: conversation._id,
      channel: CHANNEL,
      readAt: toEventDate(event.read?.watermark || event.timestamp),
    });
  }

  await updateWebhookDiagnostics({
    configId: config._id,
    processedAt: new Date(),
    senderId,
    eventType,
  });

  return true;
};

export const processFacebookWebhookPayload = async (body) => {
  if (body?.object !== "page") return;

  for (const entry of body.entry || []) {
    const pageId = entry.id;

    if (!pageId) continue;

    const config = await FacebookChannelConfig.findOne({
      pageId,
      connectionStatus: "connected",
    }).populate("companyId", "_id");

    if (!config?.companyId) continue;

    await FacebookChannelConfig.updateOne(
      { _id: config._id },
      { $set: { lastWebhookReceivedAt: new Date() } }
    );

    for (const event of entry.messaging || []) {
      try {
        await processMessengerEvent({ config, pageId, event });
      } catch (error) {
        console.error("Facebook webhook event processing failed:", error.message);
      }
    }
  }
};
