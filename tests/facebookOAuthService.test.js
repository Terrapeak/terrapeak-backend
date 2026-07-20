import test from "node:test";
import assert from "node:assert/strict";
import axios from "axios";
import {
  buildFacebookAuthorizationUrl,
  createFacebookOAuthState,
  exchangeFacebookAuthorizationCode,
  FacebookOAuthApiError,
  getFacebookOAuthAccountData,
  parseFacebookOAuthCallbackQuery,
  verifyFacebookOAuthState,
} from "../services/facebookOAuthService.js";

const configureMetaEnvironment = () => {
  process.env.META_APP_ID = "test-app-id";
  process.env.META_APP_SECRET = "test-app-secret";
  process.env.META_GRAPH_API_VERSION = "v24.0";
  process.env.META_OAUTH_REDIRECT_URI =
    "https://api.example.com/api/company/channels/facebook/oauth/callback";
  process.env.META_OAUTH_STATE_SECRET =
    "test-state-secret-that-is-long-enough-for-tests";
  delete process.env.META_OAUTH_SCOPES;
};

test("Facebook OAuth state survives authorization URL and callback parsing", () => {
  configureMetaEnvironment();
  const state = createFacebookOAuthState({
    userId: "user-1",
    companyId: "company-1",
    nonce: "nonce-1",
  });
  const authorizationUrl = new URL(buildFacebookAuthorizationUrl(state));
  const callback = parseFacebookOAuthCallbackQuery({
    code: "authorization-code",
    state: authorizationUrl.searchParams.get("state"),
  });
  const payload = verifyFacebookOAuthState(callback.state);

  assert.equal(authorizationUrl.searchParams.get("redirect_uri"), process.env.META_OAUTH_REDIRECT_URI);
  assert.equal(authorizationUrl.searchParams.get("response_type"), "code");
  assert.equal(callback.code, "authorization-code");
  assert.equal(payload.userId, "user-1");
  assert.equal(payload.companyId, "company-1");
  assert.equal(payload.nonce, "nonce-1");
  assert.equal(payload.purpose, "facebook_channel_connect");
});

test("Facebook OAuth callback parser reads Meta error parameters safely", () => {
  const callback = parseFacebookOAuthCallbackQuery({
    state: ["signed-state"],
    error: "access_denied",
    error_reason: "user_denied",
    error_description: "The user denied the request.",
    error_code: "200",
  });

  assert.equal(callback.state, "signed-state");
  assert.deepEqual(callback.metaError, {
    error: "access_denied",
    reason: "user_denied",
    description: "The user denied the request.",
    code: "200",
  });
});

test("Facebook authorization-code exchange sends Meta's required parameters", async (t) => {
  configureMetaEnvironment();
  t.mock.method(axios, "get", async (url, options) => {
    assert.equal(
      url,
      "https://graph.facebook.com/v24.0/oauth/access_token"
    );
    assert.deepEqual(options.params, {
      client_id: "test-app-id",
      client_secret: "test-app-secret",
      code: "authorization-code",
      redirect_uri: process.env.META_OAUTH_REDIRECT_URI,
    });
    return { data: { access_token: "user-access-token" } };
  });

  assert.equal(
    await exchangeFacebookAuthorizationCode("authorization-code"),
    "user-access-token"
  );
});

test("Facebook OAuth account retrieval collects paginated managed Pages", async (t) => {
  configureMetaEnvironment();
  t.mock.method(axios, "get", async (url, options) => {
    if (url.endsWith("/me/permissions")) {
      return {
        data: {
          data: [
            { permission: "pages_show_list", status: "granted" },
            { permission: "pages_messaging", status: "declined" },
          ],
        },
      };
    }

    if (url.endsWith("/me/accounts") && !options.params.after) {
      return {
        data: {
          data: [{ id: "page-1", name: "Page One", access_token: "token-1" }],
          paging: { next: "next-page", cursors: { after: "cursor-1" } },
        },
      };
    }

    if (url.endsWith("/me/accounts")) {
      assert.equal(options.params.after, "cursor-1");
      return {
        data: {
          data: [{ id: "page-2", name: "Page Two", access_token: "token-2" }],
        },
      };
    }

    if (url.endsWith("/me")) {
      return { data: { id: "meta-user-1" } };
    }

    throw new Error(`Unexpected Meta URL: ${url}`);
  });

  const account = await getFacebookOAuthAccountData("user-access-token");

  assert.equal(account.metaUserId, "meta-user-1");
  assert.deepEqual(account.grantedPermissions, ["pages_show_list"]);
  assert.deepEqual(
    account.pages.map((page) => page.id),
    ["page-1", "page-2"]
  );
});

test("Facebook OAuth API failures retain Meta diagnostics", async (t) => {
  configureMetaEnvironment();
  let attempts = 0;
  t.mock.method(axios, "get", async () => {
    attempts += 1;
    const error = new Error("Request failed with status code 500");
    error.response = {
      status: 500,
      data: {
        error: {
          message: "An unknown error occurred.",
          type: "OAuthException",
          code: 1,
          error_subcode: 99,
          fbtrace_id: "trace-1",
        },
      },
    };
    throw error;
  });

  await assert.rejects(
    exchangeFacebookAuthorizationCode("authorization-code"),
    (error) => {
      assert.ok(error instanceof FacebookOAuthApiError);
      assert.equal(error.phase, "authorization-code exchange");
      assert.equal(error.status, 500);
      assert.equal(error.metaError.code, 1);
      assert.equal(error.requestContext.method, "GET");
      assert.equal(
        error.requestContext.endpoint,
        "https://graph.facebook.com/v24.0/oauth/access_token"
      );
      assert.deepEqual(error.requestContext.parameterNames, [
        "client_id",
        "client_secret",
        "code",
        "redirect_uri",
      ]);
      assert.doesNotMatch(
        JSON.stringify(error.requestContext),
        /test-app-secret|authorization-code/
      );
      assert.match(error.message, /An unknown error occurred/);
      return true;
    }
  );
  assert.equal(attempts, 1);
});

test("Facebook OAuth does not replay a single-use code after a Meta server failure", async (t) => {
  configureMetaEnvironment();
  let attempts = 0;
  t.mock.method(axios, "get", async () => {
    attempts += 1;

    const error = new Error("Request failed with status code 500");
    error.response = {
      status: 500,
      data: { error: { message: "Temporary failure" } },
    };
    throw error;
  });

  await assert.rejects(
    exchangeFacebookAuthorizationCode("authorization-code"),
    FacebookOAuthApiError
  );
  assert.equal(attempts, 1);
});
