import test from "node:test";
import assert from "node:assert/strict";
import axios from "axios";
import {
  FacebookOAuthApiError,
  FacebookPageSubscriptionError,
  subscribeFacebookPageToWebhook,
  verifyFacebookPageWebhookSubscription,
} from "../services/facebookOAuthService.js";

const PAGE_ID = "page-1";
const PAGE_ACCESS_TOKEN = "page-access-token";
const ENDPOINT =
  "https://graph.facebook.com/v24.0/page-1/subscribed_apps";
const REQUIRED_FIELDS = [
  "messages",
  "message_deliveries",
  "message_reads",
];

const configureMetaEnvironment = () => {
  process.env.META_APP_ID = "test-app-id";
  process.env.META_APP_SECRET = "test-app-secret";
  process.env.META_GRAPH_API_VERSION = "v24.0";
  process.env.META_OAUTH_REDIRECT_URI =
    "https://api.example.com/api/company/channels/facebook/oauth/callback";
};

const subscribedAppsResponse = (overrides = {}) => ({
  data: {
    data: [
      {
        id: "test-app-id",
        name: "Terrapeak Test App",
        subscribed_fields: REQUIRED_FIELDS,
        ...overrides,
      },
    ],
  },
});

test("Facebook Page subscription posts required Messenger fields and verifies the result", async (t) => {
  configureMetaEnvironment();
  t.mock.method(axios, "post", async (url, body, options) => {
    assert.equal(url, ENDPOINT);
    assert.equal(body, null);
    assert.deepEqual(options.params, {
      access_token: PAGE_ACCESS_TOKEN,
      subscribed_fields: REQUIRED_FIELDS.join(","),
    });
    return { data: { success: true } };
  });
  t.mock.method(axios, "get", async (url, options) => {
    assert.equal(url, ENDPOINT);
    assert.equal(options.params.access_token, PAGE_ACCESS_TOKEN);
    assert.equal(options.params.fields, "id,name,subscribed_fields");
    return subscribedAppsResponse();
  });

  const result = await subscribeFacebookPageToWebhook({
    pageId: PAGE_ID,
    pageAccessToken: PAGE_ACCESS_TOKEN,
  });

  assert.equal(result.appId, "test-app-id");
  assert.deepEqual(result.subscribedFields, REQUIRED_FIELDS);
});

test("Facebook Page subscribed_apps GET verifies the configured app", async (t) => {
  configureMetaEnvironment();
  t.mock.method(axios, "get", async () => subscribedAppsResponse());

  const result = await verifyFacebookPageWebhookSubscription({
    pageId: PAGE_ID,
    pageAccessToken: PAGE_ACCESS_TOKEN,
  });

  assert.deepEqual(result, {
    appId: "test-app-id",
    appName: "Terrapeak Test App",
    subscribedFields: REQUIRED_FIELDS,
  });
});

test("Facebook Page subscription verification rejects a missing configured app", async (t) => {
  configureMetaEnvironment();
  t.mock.method(axios, "get", async () =>
    subscribedAppsResponse({ id: "another-app-id" })
  );

  await assert.rejects(
    verifyFacebookPageWebhookSubscription({
      pageId: PAGE_ID,
      pageAccessToken: PAGE_ACCESS_TOKEN,
    }),
    (error) => {
      assert.ok(error instanceof FacebookPageSubscriptionError);
      assert.match(error.message, /not subscribed/);
      return true;
    }
  );
});

test("Facebook Page subscription verification rejects missing required fields", async (t) => {
  configureMetaEnvironment();
  t.mock.method(axios, "get", async () =>
    subscribedAppsResponse({ subscribed_fields: ["messages"] })
  );

  await assert.rejects(
    verifyFacebookPageWebhookSubscription({
      pageId: PAGE_ID,
      pageAccessToken: PAGE_ACCESS_TOKEN,
    }),
    (error) => {
      assert.ok(error instanceof FacebookPageSubscriptionError);
      assert.deepEqual(error.missingFields, [
        "message_deliveries",
        "message_reads",
      ]);
      return true;
    }
  );
});

test("Facebook Page subscription preserves safe Meta failure diagnostics", async (t) => {
  configureMetaEnvironment();
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
          fbtrace_id: "trace-subscribe-1",
        },
      },
    };
    throw error;
  });

  await assert.rejects(
    subscribeFacebookPageToWebhook({
      pageId: PAGE_ID,
      pageAccessToken: PAGE_ACCESS_TOKEN,
    }),
    (error) => {
      assert.ok(error instanceof FacebookOAuthApiError);
      assert.equal(error.phase, "Page webhook subscription");
      assert.equal(error.status, 400);
      assert.equal(error.requestContext.endpoint, ENDPOINT);
      assert.equal(error.metaError.type, "OAuthException");
      assert.equal(error.metaError.code, 200);
      assert.equal(error.metaError.subcode, 2018065);
      assert.equal(error.metaError.traceId, "trace-subscribe-1");
      assert.doesNotMatch(
        JSON.stringify(error.requestContext),
        /page-access-token|test-app-secret/
      );
      return true;
    }
  );
});

test("Facebook Page subscription is idempotent when repeated", async (t) => {
  configureMetaEnvironment();
  let postCount = 0;
  let getCount = 0;
  t.mock.method(axios, "post", async () => {
    postCount += 1;
    return { data: { success: true } };
  });
  t.mock.method(axios, "get", async () => {
    getCount += 1;
    return subscribedAppsResponse();
  });

  for (let i = 0; i < 2; i += 1) {
    await subscribeFacebookPageToWebhook({
      pageId: PAGE_ID,
      pageAccessToken: PAGE_ACCESS_TOKEN,
    });
  }

  assert.equal(postCount, 2);
  assert.equal(getCount, 2);
});
