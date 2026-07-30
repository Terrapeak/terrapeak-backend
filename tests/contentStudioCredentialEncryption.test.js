import assert from "node:assert/strict";
import test from "node:test";
import {
  decryptContentStudioCredential,
  encryptContentStudioCredential,
  fingerprintContentStudioCredential,
  resolveCompanyContentStudioKeys,
} from "../utils/contentStudioCredentialEncryption.js";

const originalKey = process.env.CONTENT_STUDIO_CREDENTIAL_ENCRYPTION_KEY;

test.before(() => {
  process.env.CONTENT_STUDIO_CREDENTIAL_ENCRYPTION_KEY =
    Buffer.alloc(32, 7).toString("base64");
});

test.after(() => {
  if (originalKey === undefined) {
    delete process.env.CONTENT_STUDIO_CREDENTIAL_ENCRYPTION_KEY;
  } else {
    process.env.CONTENT_STUDIO_CREDENTIAL_ENCRYPTION_KEY = originalKey;
  }
});

test("encrypts and decrypts Content Studio credentials", () => {
  const encrypted = encryptContentStudioCredential("company-secret-1234");

  assert.notEqual(encrypted.ciphertext, "company-secret-1234");
  assert.equal(encrypted.lastFour, "1234");
  assert.equal(
    decryptContentStudioCredential(encrypted),
    "company-secret-1234",
  );
});

test("rejects tampered encrypted credentials", () => {
  const encrypted = encryptContentStudioCredential("company-secret-1234");
  encrypted.authTag = Buffer.alloc(16, 1).toString("base64");

  assert.throws(() => decryptContentStudioCredential(encrypted));
});

test("prefers encrypted keys while retaining plaintext rollback support", () => {
  const company = {
    contentStudioAiConfig: {
      geminiKey: "old-text-key",
      imageGeminiKey: "old-image-key",
      geminiKeyEncrypted: encryptContentStudioCredential("new-text-key"),
      imageGeminiKeyEncrypted:
        encryptContentStudioCredential("new-image-key"),
    },
  };

  assert.deepEqual(resolveCompanyContentStudioKeys(company), {
    textKey: "new-text-key",
    imageKey: "new-image-key",
  });
  assert.equal(
    fingerprintContentStudioCredential("new-text-key"),
    fingerprintContentStudioCredential("new-text-key"),
  );
});
