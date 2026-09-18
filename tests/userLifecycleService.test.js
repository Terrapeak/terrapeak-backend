import assert from "node:assert/strict";
import test from "node:test";

import { issuePasswordReset } from "../services/userLifecycleService.js";

const userDocument = () => {
  const persisted = {
    passwordResetTokenHash: "old-hash",
    passwordResetExpiresAt: new Date("2026-09-19T00:00:00.000Z"),
    passwordResetSentAt: new Date("2026-09-18T00:00:00.000Z"),
  };
  const user = {
    _id: "64b000000000000000000001",
    name: "Owner",
    email: "owner@example.com",
    ...persisted,
    save: async function save() {
      Object.assign(persisted, {
        passwordResetTokenHash: this.passwordResetTokenHash,
        passwordResetExpiresAt: this.passwordResetExpiresAt,
        passwordResetSentAt: this.passwordResetSentAt,
      });
      return this;
    },
  };
  return { user, persisted };
};

test("password reset replaces the previous token and never exposes the new token", async () => {
  const { user, persisted } = userDocument();
  let emailPayload = null;
  const result = await issuePasswordReset({
    user,
    sendEmailFn: async (payload) => {
      emailPayload = payload;
    },
  });

  assert.notEqual(persisted.passwordResetTokenHash, "old-hash");
  assert.equal(emailPayload.to, "owner@example.com");
  assert.match(emailPayload.text, /token=/);
  assert.deepEqual(Object.keys(result), ["expiresAt"]);
});

test("password reset delivery failure restores the previous reset state", async () => {
  const { user, persisted } = userDocument();
  await assert.rejects(
    issuePasswordReset({
      user,
      sendEmailFn: async () => {
        throw new Error("delivery failed");
      },
    }),
    /delivery failed/,
  );
  assert.equal(persisted.passwordResetTokenHash, "old-hash");
  assert.equal(persisted.passwordResetExpiresAt.toISOString(), "2026-09-19T00:00:00.000Z");
  assert.equal(persisted.passwordResetSentAt.toISOString(), "2026-09-18T00:00:00.000Z");
});
