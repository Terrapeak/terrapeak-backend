import test from "node:test";
import assert from "node:assert/strict";
import axios from "axios";
import FacebookChannelConfig from "../models/facebookChannelConfig.js";
import { encryptSecret } from "../utils/secretEncryption.js";
import { sendFacebookTextMessage } from "../services/facebookMessageService.js";

const COMPANY_ID = "507f1f77bcf86cd799439011";
const PAGE_ID = "page-1";
const RECIPIENT_ID = "recipient-1";
const PAGE_ACCESS_TOKEN = "page-access-token";
const ENDPOINT = "https://graph.facebook.com/v24.0/page-1/messages";

const configureEnvironment = () => {
  process.env.META_GRAPH_API_VERSION = "v24.0";
  process.env.FACEBOOK_TOKEN_ENCRYPTION_KEY = "11".repeat(32);
};

const mockConfig = (t, config) => {
  t.mock.method(FacebookChannelConfig, "findOne", (filter) => {
    assert.deepEqual(filter, { companyId: COMPANY_ID });

    return {
      select: async (selection) => {
        assert.equal(selection, "+pageAccessTokenEncrypted");
        return config;
      },
    };
  });
};

const connectedConfig = (overrides = {}) => ({
  connectionStatus: "connected",
  pageId: PAGE_ID,
  pageAccessTokenEncrypted: encryptSecret(PAGE_ACCESS_TOKEN),
  ...overrides,
});

test("sendFacebookTextMessage sends the required Messenger payload", async (t) => {
  configureEnvironment();
  mockConfig(t, connectedConfig());
  t.mock.method(axios, "post", async (url, payload, options) => {
    assert.equal(url, ENDPOINT);
    assert.deepEqual(payload, {
      recipient: { id: RECIPIENT_ID },
      messaging_type: "RESPONSE",
      message: { text: "Hello from Terrapeak" },
    });
    assert.equal(options.headers.Authorization, `Bearer ${PAGE_ACCESS_TOKEN}`);
    assert.equal(options.headers["Content-Type"], "application/json");
    assert.equal(options.timeout, 15000);
    assert.doesNotMatch(url, /page-access-token/);
    assert.doesNotMatch(JSON.stringify(payload), /page-access-token/);
    return {
      data: {
        message_id: "message-1",
        recipient_id: RECIPIENT_ID,
      },
    };
  });

  const result = await sendFacebookTextMessage({
    companyId: COMPANY_ID,
    recipientId: RECIPIENT_ID,
    message: "Hello from Terrapeak",
  });

  assert.deepEqual(result, {
    externalMessageId: "message-1",
    recipientId: RECIPIENT_ID,
  });
});

test("sendFacebookTextMessage rejects missing configuration", async (t) => {
  configureEnvironment();
  mockConfig(t, null);

  await assert.rejects(
    sendFacebookTextMessage({
      companyId: COMPANY_ID,
      recipientId: RECIPIENT_ID,
      message: "Hello",
    }),
    /not configured/
  );
});

test("sendFacebookTextMessage rejects a disconnected channel", async (t) => {
  configureEnvironment();
  mockConfig(t, connectedConfig({ connectionStatus: "disconnected" }));

  await assert.rejects(
    sendFacebookTextMessage({
      companyId: COMPANY_ID,
      recipientId: RECIPIENT_ID,
      message: "Hello",
    }),
    /not connected/
  );
});

test("sendFacebookTextMessage rejects missing Page credentials", async (t) => {
  configureEnvironment();
  mockConfig(t, connectedConfig({ pageAccessTokenEncrypted: "" }));

  await assert.rejects(
    sendFacebookTextMessage({
      companyId: COMPANY_ID,
      recipientId: RECIPIENT_ID,
      message: "Hello",
    }),
    /credentials are missing/
  );
});

test("sendFacebookTextMessage returns a safe Meta API failure", async (t) => {
  configureEnvironment();
  mockConfig(t, connectedConfig());
  t.mock.method(axios, "post", async () => {
    const error = new Error(`Request failed for ${PAGE_ACCESS_TOKEN}`);
    error.response = {
      status: 400,
      data: {
        error: {
          message: `Invalid token ${PAGE_ACCESS_TOKEN}`,
        },
      },
    };
    throw error;
  });

  await assert.rejects(
    sendFacebookTextMessage({
      companyId: COMPANY_ID,
      recipientId: RECIPIENT_ID,
      message: "Hello",
    }),
    (error) => {
      assert.equal(
        error.message,
        "Meta could not send the Facebook Messenger message (HTTP 400)."
      );
      assert.doesNotMatch(error.message, /page-access-token/);
      return true;
    }
  );
});

test("sendFacebookTextMessage validates required arguments", async () => {
  await assert.rejects(sendFacebookTextMessage(), /companyId is required/);
  await assert.rejects(
    sendFacebookTextMessage({ companyId: COMPANY_ID, message: "Hello" }),
    /recipientId is required/
  );
  await assert.rejects(
    sendFacebookTextMessage({
      companyId: COMPANY_ID,
      recipientId: RECIPIENT_ID,
      message: "   ",
    }),
    /message is required/
  );
});
