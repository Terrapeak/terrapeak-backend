import test from "node:test";
import assert from "node:assert/strict";
import axios from "axios";
import FacebookChannelConfig from "../models/facebookChannelConfig.js";
import { verifyFacebookConnection } from "../controllers/facebookChannelController.js";
import { encryptSecret } from "../utils/secretEncryption.js";

const configureEnvironment = () => {
  process.env.META_APP_ID = "test-app-id";
  process.env.META_APP_SECRET = "test-app-secret";
  process.env.META_GRAPH_API_VERSION = "v24.0";
  process.env.META_OAUTH_REDIRECT_URI =
    "https://api.example.com/api/company/channels/facebook/oauth/callback";
  process.env.FACEBOOK_TOKEN_ENCRYPTION_KEY = "11".repeat(32);
};

const createConfig = () => ({
  pageId: "page-1",
  pageName: "Test Page",
  pageAccessTokenEncrypted: encryptSecret("page-access-token"),
  wizardStep: 3,
  connectionStatus: "not_connected",
  webhookSubscribed: false,
  webhookSubscriptionStatus: "not_subscribed",
  connectedAt: null,
  disconnectedAt: null,
  lastError: "",
  saveCount: 0,
  async save() {
    this.saveCount += 1;
  },
});

const createResponse = () => ({
  statusCode: 200,
  body: null,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(body) {
    this.body = body;
    return this;
  },
});

const mockCompanyAndConfig = (t, config) => {
  t.mock.method(FacebookChannelConfig, "findOne", () => ({
    select: async () => config,
  }));
};

const mockSuccessfulPageVerification = (t, subscribedAppsResponse) => {
  t.mock.method(axios, "get", async (url) => {
    if (url.endsWith("/debug_token")) {
      return {
        data: {
          data: {
            is_valid: true,
            app_id: "test-app-id",
            scopes: ["pages_messaging"],
          },
        },
      };
    }

    if (url.endsWith("/subscribed_apps")) {
      return subscribedAppsResponse;
    }

    return { data: { id: "page-1", name: "Verified Page" } };
  });
};

const invokeVerification = async (config) => {
  const response = createResponse();
  await verifyFacebookConnection(
    {
      userId: "user-1",
      companyMembership: {
        companyId: "company-1",
        userId: "user-1",
        role: "owner",
        isActive: true,
      },
      body: {},
    },
    response,
    (error) => {
      throw error;
    }
  );
  return { config, response };
};

test("channel is not marked Connected when the Page subscription POST fails", async (t) => {
  configureEnvironment();
  const config = createConfig();
  mockCompanyAndConfig(t, config);
  mockSuccessfulPageVerification(t, { data: { data: [] } });
  t.mock.method(console, "error", () => {});
  t.mock.method(axios, "post", async () => {
    const error = new Error("Request failed with status code 400");
    error.response = {
      status: 400,
      data: {
        error: {
          message: "Permission denied.",
          type: "OAuthException",
          code: 200,
          error_subcode: 2018065,
          fbtrace_id: "trace-controller-1",
        },
      },
    };
    throw error;
  });

  const { response } = await invokeVerification(config);

  assert.equal(response.statusCode, 422);
  assert.equal(config.connectionStatus, "error");
  assert.equal(config.wizardStep, 3);
  assert.equal(config.webhookSubscribed, false);
  assert.equal(config.webhookSubscriptionStatus, "error");
  assert.equal(config.connectedAt, null);
});

test("webhookSubscribed remains false when POST succeeds but GET verification fails", async (t) => {
  configureEnvironment();
  const config = createConfig();
  mockCompanyAndConfig(t, config);
  mockSuccessfulPageVerification(t, {
    data: {
      data: [
        {
          id: "another-app-id",
          subscribed_fields: [
            "messages",
            "message_deliveries",
            "message_reads",
          ],
        },
      ],
    },
  });
  t.mock.method(console, "error", () => {});
  t.mock.method(axios, "post", async () => ({ data: { success: true } }));

  const { response } = await invokeVerification(config);

  assert.equal(response.statusCode, 422);
  assert.equal(config.connectionStatus, "error");
  assert.equal(config.webhookSubscribed, false);
  assert.equal(config.webhookSubscriptionStatus, "error");
});

test("webhookSubscribed becomes true only after Page and GET subscription verification", async (t) => {
  configureEnvironment();
  const config = createConfig();
  mockCompanyAndConfig(t, config);
  mockSuccessfulPageVerification(t, {
    data: {
      data: [
        {
          id: "test-app-id",
          name: "Terrapeak Test App",
          subscribed_fields: [
            "messages",
            "message_deliveries",
            "message_reads",
          ],
        },
      ],
    },
  });
  t.mock.method(axios, "post", async () => ({ data: { success: true } }));

  const { response } = await invokeVerification(config);

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.verification.webhookSubscribed, true);
  assert.equal(config.connectionStatus, "connected");
  assert.equal(config.wizardStep, 4);
  assert.equal(config.webhookSubscribed, true);
  assert.equal(config.webhookSubscriptionStatus, "subscribed");
  assert.ok(config.connectedAt instanceof Date);
});
