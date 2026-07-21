import test from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import axios from "axios";
import ChatbotSettings from "../models/chatbotSettings.js";
import ChannelConversation from "../models/channelConversation.js";
import ChannelMessage from "../models/channelMessage.js";
import FacebookChannelConfig from "../models/facebookChannelConfig.js";
import { encryptSecret } from "../utils/secretEncryption.js";
import {
  processFacebookWebhookPayload,
  verifyFacebookWebhookSignature,
  verifyFacebookWebhookToken,
} from "../services/facebookWebhookService.js";

const COMPANY_ID = "507f1f77bcf86cd799439011";
const CONVERSATION_ID = "507f191e810c19729de860ea";
const PAGE_ID = "page-1";
const SENDER_ID = "sender-1";
const PAGE_ACCESS_TOKEN = "page-access-token";

const configureFacebookEnvironment = () => {
  process.env.META_GRAPH_API_VERSION = "v24.0";
  process.env.FACEBOOK_TOKEN_ENCRYPTION_KEY = "22".repeat(32);
};

const webhookPayload = (event) => ({
  object: "page",
  entry: [{ id: PAGE_ID, messaging: [event] }],
});

const inboundEvent = (overrides = {}) => ({
  sender: { id: SENDER_ID },
  recipient: { id: PAGE_ID },
  timestamp: 1710000000000,
  message: {
    mid: "inbound-message-1",
    text: "What time do you open?",
  },
  ...overrides,
});

const mockWebhookConfig = (t, { includeSenderConfig = false } = {}) => {
  const webhookConfig = {
    _id: "facebook-config-1",
    companyId: { _id: COMPANY_ID },
  };
  const senderConfig = {
    connectionStatus: "connected",
    pageId: PAGE_ID,
    pageAccessTokenEncrypted: encryptSecret(PAGE_ACCESS_TOKEN),
  };

  t.mock.method(FacebookChannelConfig, "findOne", (filter) => {
    if (filter.pageId === PAGE_ID) {
      assert.equal(filter.connectionStatus, "connected");
      return {
        populate: async (path, selection) => {
          assert.equal(path, "companyId");
          assert.equal(selection, "_id");
          return webhookConfig;
        },
      };
    }

    if (includeSenderConfig && filter.companyId === COMPANY_ID) {
      return {
        select: async (selection) => {
          assert.equal(selection, "+pageAccessTokenEncrypted");
          return senderConfig;
        },
      };
    }

    throw new Error(`Unexpected Facebook config query: ${JSON.stringify(filter)}`);
  });
  t.mock.method(FacebookChannelConfig, "updateOne", async () => ({}));
};

const mockConversation = (t) => {
  t.mock.method(ChannelConversation, "findOneAndUpdate", async () => ({
    _id: CONVERSATION_ID,
  }));
};

const mockChatbot = (t, settings) => {
  t.mock.method(ChatbotSettings, "findOne", async (filter) => {
    assert.deepEqual(filter, { companyId: COMPANY_ID });
    return settings;
  });

  t.mock.method(ChannelMessage, "find", (filter) => {
    assert.equal(filter.companyId, COMPANY_ID);
    assert.equal(filter.conversationId, CONVERSATION_ID);
    const query = {
      sort: () => query,
      limit: () => query,
      select: () => query,
      lean: async () => [],
    };
    return query;
  });
};

test("Facebook webhook verification token must match exactly", () => {
  process.env.META_WEBHOOK_VERIFY_TOKEN = "test-webhook-verification-token";

  assert.equal(
    verifyFacebookWebhookToken("test-webhook-verification-token"),
    true
  );
  assert.equal(verifyFacebookWebhookToken("wrong-token"), false);
});

test("Facebook webhook signature validates the unmodified raw body", () => {
  process.env.META_APP_SECRET = "test-meta-app-secret";
  const rawBody = Buffer.from(
    JSON.stringify({ object: "page", entry: [{ id: "page-1" }] })
  );
  const signature = `sha256=${crypto
    .createHmac("sha256", process.env.META_APP_SECRET)
    .update(rawBody)
    .digest("hex")}`;

  assert.equal(
    verifyFacebookWebhookSignature({ rawBody, signature }),
    true
  );
  assert.equal(
    verifyFacebookWebhookSignature({
      rawBody: Buffer.from(`${rawBody.toString()} `),
      signature,
    }),
    false
  );
});

test("Facebook inbound text generates, sends, and stores one outbound reply", async (t) => {
  configureFacebookEnvironment();
  mockWebhookConfig(t, { includeSenderConfig: true });
  mockConversation(t);
  mockChatbot(t, {
    geminiKey: "gemini-test-key",
    gemini_model: "gemini-test-model",
    systemInstruction: "Answer using the business information.",
  });

  const storedMessages = [];
  t.mock.method(ChannelMessage, "findOneAndUpdate", async (filter, update) => {
    storedMessages.push({ filter, record: update.$setOnInsert });
    return update.$setOnInsert;
  });
  t.mock.method(axios, "post", async (url, payload, options) => {
    if (url.startsWith("https://generativelanguage.googleapis.com/")) {
      assert.equal(payload.contents.at(-1).parts[0].text, "What time do you open?");
      return {
        data: {
          candidates: [
            { content: { parts: [{ text: "We open at 9 AM." }] } },
          ],
        },
      };
    }

    assert.equal(url, "https://graph.facebook.com/v24.0/page-1/messages");
    assert.deepEqual(payload, {
      recipient: { id: SENDER_ID },
      messaging_type: "RESPONSE",
      message: { text: "We open at 9 AM." },
    });
    assert.equal(options.headers.Authorization, `Bearer ${PAGE_ACCESS_TOKEN}`);
    return { data: { message_id: "outbound-message-1" } };
  });

  await processFacebookWebhookPayload(webhookPayload(inboundEvent()));

  assert.equal(storedMessages.length, 2);
  assert.deepEqual(storedMessages[0].record, {
    companyId: COMPANY_ID,
    conversationId: CONVERSATION_ID,
    channel: "facebook",
    externalConversationId: `${PAGE_ID}:${SENDER_ID}`,
    externalUserId: SENDER_ID,
    direction: "inbound",
    senderType: "customer",
    message: "What time do you open?",
    externalMessageId: "inbound-message-1",
    deliveryStatus: "received",
    eventTimestamp: new Date(1710000000000),
    metadata: { attachmentTypes: [] },
  });
  assert.equal(storedMessages[1].record.direction, "outbound");
  assert.equal(storedMessages[1].record.senderType, "business");
  assert.equal(storedMessages[1].record.message, "We open at 9 AM.");
  assert.equal(
    storedMessages[1].record.externalMessageId,
    "outbound-message-1"
  );
  assert.equal(storedMessages[1].record.deliveryStatus, "sent");
  assert.equal(storedMessages[1].record.conversationId, CONVERSATION_ID);
});

test("Facebook AI failure keeps inbound storage and does not send", async (t) => {
  configureFacebookEnvironment();
  mockWebhookConfig(t);
  mockConversation(t);
  mockChatbot(t, null);

  const storedDirections = [];
  t.mock.method(ChannelMessage, "findOneAndUpdate", async (filter, update) => {
    storedDirections.push(update.$setOnInsert.direction);
    return update.$setOnInsert;
  });
  t.mock.method(axios, "post", async () => {
    throw new Error("HTTP must not be called when AI generation fails");
  });
  const loggedErrors = [];
  t.mock.method(console, "error", (...args) => loggedErrors.push(args));

  await processFacebookWebhookPayload(webhookPayload(inboundEvent()));

  assert.deepEqual(storedDirections, ["inbound"]);
  assert.deepEqual(loggedErrors, [["Facebook AI reply generation failed."]]);
});

test("Facebook send failure does not store an outbound message", async (t) => {
  configureFacebookEnvironment();
  mockWebhookConfig(t, { includeSenderConfig: true });
  mockConversation(t);
  mockChatbot(t, {
    geminiKey: "gemini-test-key",
    gemini_model: "gemini-test-model",
    systemInstruction: "Be helpful.",
  });

  const storedDirections = [];
  t.mock.method(ChannelMessage, "findOneAndUpdate", async (filter, update) => {
    storedDirections.push(update.$setOnInsert.direction);
    return update.$setOnInsert;
  });
  let requestCount = 0;
  t.mock.method(axios, "post", async (url) => {
    requestCount += 1;
    if (url.startsWith("https://generativelanguage.googleapis.com/")) {
      return {
        data: {
          candidates: [
            { content: { parts: [{ text: "Generated reply" }] } },
          ],
        },
      };
    }
    const error = new Error("Meta request failed");
    error.response = { status: 400 };
    throw error;
  });
  const loggedErrors = [];
  t.mock.method(console, "error", (...args) => loggedErrors.push(args));

  await processFacebookWebhookPayload(webhookPayload(inboundEvent()));

  assert.equal(requestCount, 2);
  assert.deepEqual(storedDirections, ["inbound"]);
  assert.deepEqual(loggedErrors, [["Facebook reply send failed."]]);
});

test("Facebook outbound storage failure does not send a second reply", async (t) => {
  configureFacebookEnvironment();
  mockWebhookConfig(t, { includeSenderConfig: true });
  mockConversation(t);
  mockChatbot(t, {
    geminiKey: "gemini-test-key",
    gemini_model: "gemini-test-model",
    systemInstruction: "Be helpful.",
  });

  let storageCount = 0;
  t.mock.method(ChannelMessage, "findOneAndUpdate", async (filter, update) => {
    storageCount += 1;
    if (update.$setOnInsert.direction === "outbound") {
      throw new Error("Database unavailable");
    }
    return update.$setOnInsert;
  });
  let metaSendCount = 0;
  t.mock.method(axios, "post", async (url) => {
    if (url.startsWith("https://generativelanguage.googleapis.com/")) {
      return {
        data: {
          candidates: [
            { content: { parts: [{ text: "Generated reply" }] } },
          ],
        },
      };
    }
    metaSendCount += 1;
    return { data: { message_id: "outbound-message-1" } };
  });
  const loggedErrors = [];
  t.mock.method(console, "error", (...args) => loggedErrors.push(args));

  await processFacebookWebhookPayload(webhookPayload(inboundEvent()));

  assert.equal(storageCount, 2);
  assert.equal(metaSendCount, 1);
  assert.deepEqual(loggedErrors, [
    ["Facebook outbound message storage failed."],
  ]);
});

test("Facebook echo and textless messages do not generate or send replies", async (t) => {
  configureFacebookEnvironment();
  mockWebhookConfig(t);
  mockConversation(t);

  const storedMessages = [];
  t.mock.method(ChannelMessage, "findOneAndUpdate", async (filter, update) => {
    storedMessages.push(update.$setOnInsert);
    return update.$setOnInsert;
  });
  t.mock.method(ChannelMessage, "find", () => {
    throw new Error("AI history must not be loaded");
  });
  t.mock.method(axios, "post", async () => {
    throw new Error("HTTP must not be called");
  });

  await processFacebookWebhookPayload(
    webhookPayload(inboundEvent({ message: { mid: "echo-1", is_echo: true } }))
  );
  await processFacebookWebhookPayload(
    webhookPayload(
      inboundEvent({
        message: {
          mid: "attachment-1",
          attachments: [{ type: "image" }],
        },
      })
    )
  );

  assert.equal(storedMessages.length, 1);
  assert.equal(storedMessages[0].externalMessageId, "attachment-1");
  assert.equal(storedMessages[0].message, "");
});

test("Facebook delivery and read events retain status update behavior", async (t) => {
  configureFacebookEnvironment();
  mockWebhookConfig(t);
  mockConversation(t);

  const updates = [];
  t.mock.method(ChannelMessage, "updateMany", async (filter, update) => {
    updates.push({ filter, update });
    return {};
  });
  t.mock.method(ChannelMessage, "findOneAndUpdate", async () => {
    throw new Error("Delivery and read events must not store messages");
  });
  t.mock.method(axios, "post", async () => {
    throw new Error("Delivery and read events must not call HTTP APIs");
  });

  await processFacebookWebhookPayload({
    object: "page",
    entry: [
      {
        id: PAGE_ID,
        messaging: [
          {
            sender: { id: SENDER_ID },
            recipient: { id: PAGE_ID },
            delivery: { mids: ["outbound-message-1"], watermark: 1710000001000 },
          },
          {
            sender: { id: SENDER_ID },
            recipient: { id: PAGE_ID },
            read: { watermark: 1710000002000 },
          },
        ],
      },
    ],
  });

  assert.equal(updates.length, 2);
  assert.deepEqual(updates[0].filter, {
    companyId: COMPANY_ID,
    channel: "facebook",
    externalMessageId: { $in: ["outbound-message-1"] },
    direction: "outbound",
  });
  assert.equal(updates[0].update.$set.deliveryStatus, "delivered");
  assert.deepEqual(updates[1].filter, {
    companyId: COMPANY_ID,
    conversationId: CONVERSATION_ID,
    channel: "facebook",
    direction: "outbound",
    eventTimestamp: { $lte: new Date(1710000002000) },
  });
  assert.equal(updates[1].update.$set.deliveryStatus, "read");
});
