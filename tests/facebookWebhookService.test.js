import test from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import {
  verifyFacebookWebhookSignature,
  verifyFacebookWebhookToken,
} from "../services/facebookWebhookService.js";

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
