import ChannelConversation from "../models/channelConversation.js";
import ChannelMessage from "../models/channelMessage.js";

export const upsertChannelConversation = async ({
  companyId,
  channel,
  channelAccountId,
  externalConversationId,
  externalUserId,
  eventType,
  eventTimestamp,
  hasMessage = false,
}) => {
  const activityAt = eventTimestamp || new Date();

  return ChannelConversation.findOneAndUpdate(
    {
      companyId,
      channel,
      channelAccountId,
      externalConversationId,
    },
    {
      $set: {
        externalUserId,
        lastActivityAt: activityAt,
        lastEventType: eventType,
        ...(hasMessage ? { lastMessageAt: activityAt } : {}),
      },
      $setOnInsert: {
        companyId,
        channel,
        channelAccountId,
        externalConversationId,
        status: "open",
      },
    },
    {
      upsert: true,
      new: true,
      runValidators: true,
    }
  );
};

export const storeInboundChannelMessage = async ({
  companyId,
  conversation,
  channel,
  externalConversationId,
  externalUserId,
  externalMessageId,
  message,
  eventTimestamp,
  metadata = {},
}) =>
  ChannelMessage.findOneAndUpdate(
    {
      companyId,
      channel,
      externalMessageId,
    },
    {
      $setOnInsert: {
        companyId,
        conversationId: conversation._id,
        channel,
        externalConversationId,
        externalUserId,
        direction: "inbound",
        senderType: "customer",
        message,
        externalMessageId,
        deliveryStatus: "received",
        eventTimestamp,
        metadata,
      },
    },
    {
      upsert: true,
      new: true,
      runValidators: true,
    }
  );

export const markChannelMessagesDelivered = ({
  companyId,
  channel,
  externalMessageIds,
  deliveredAt,
}) => {
  if (!externalMessageIds.length) return Promise.resolve();

  return ChannelMessage.updateMany(
    {
      companyId,
      channel,
      externalMessageId: { $in: externalMessageIds },
      direction: "outbound",
    },
    {
      $set: {
        deliveryStatus: "delivered",
        deliveredAt,
      },
    }
  );
};

export const markChannelMessagesRead = ({
  companyId,
  conversationId,
  channel,
  readAt,
}) =>
  ChannelMessage.updateMany(
    {
      companyId,
      conversationId,
      channel,
      direction: "outbound",
      eventTimestamp: { $lte: readAt },
    },
    {
      $set: {
        deliveryStatus: "read",
        readAt,
      },
    }
  );
