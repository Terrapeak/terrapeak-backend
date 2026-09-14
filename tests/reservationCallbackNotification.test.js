import assert from "node:assert/strict";
import test from "node:test";
import CompanyMembership from "../models/companyMembership.js";
import ReservationStaffRequestModel from "../models/reservationStaffRequest.js";
import ReservationStaffRequest from "../models/reservationStaffRequest.js";
import {
  getEmailPayload,
  notifyReservationCallbackCreated,
  resolveRecipients,
} from "../services/reservationCallbackNotificationService.js";

const originalMembershipFind = CompanyMembership.find;
const originalFindOneAndUpdate = ReservationStaffRequest.findOneAndUpdate;
const originalUpdateOne = ReservationStaffRequest.updateOne;

const makeRequest = (overrides = {}) => ({
  _id: "callback-request-1",
  companyId: "company-1",
  type: "callback",
  customerName: "<Customer>",
  customerContact: "customer@example.com",
  createdAt: "2026-09-14T00:00:00.000Z",
  requestedChange: {
    preferredCallbackTime: "tomorrow at 10:00",
    question: "<script>alert('internal')</script>",
    serviceOrTeacher: "General consultation",
  },
  summary: "PRIVATE_INTERNAL_SUMMARY",
  transcript: "PRIVATE_TRANSCRIPT",
  sessionId: "PRIVATE_SESSION_ID",
  notification: {
    email: {
      status: "not_attempted",
      attempts: 0,
    },
  },
  ...overrides,
});

const setMemberships = (memberships) => {
  CompanyMembership.find = () => ({
    select() {
      return this;
    },
    populate() {
      return this;
    },
    lean: async () => memberships,
  });
};

const resetModels = () => {
  CompanyMembership.find = originalMembershipFind;
  ReservationStaffRequest.findOneAndUpdate = originalFindOneAndUpdate;
  ReservationStaffRequest.updateOne = originalUpdateOne;
};

test.afterEach(resetModels);

test("resolves active owner/admin user emails case-insensitively and excludes invalid recipients", async () => {
  let query;
  CompanyMembership.find = (value) => {
    query = value;
    return {
      select() {
        return this;
      },
      populate() {
        return this;
      },
      lean: async () => [
        { userId: { email: "Owner@Example.com" } },
        { userId: { email: "owner@example.com" } },
        { userId: { email: "admin@example.com" } },
        { userId: null },
        { userId: { email: "not-an-email" } },
      ],
    };
  };

  assert.deepEqual(await resolveRecipients("company-1"), [
    "owner@example.com",
    "admin@example.com",
  ]);
  assert.deepEqual(query, {
    companyId: "company-1",
    status: "active",
    role: { $in: ["owner", "admin"] },
  });
});

test("sends one privacy-safe email per recipient and marks the callback sent", async () => {
  setMemberships([
    { userId: { email: "Owner@example.com" } },
    { userId: { email: "ADMIN@example.com" } },
  ]);
  const request = makeRequest();
  let claimFilter;
  let claimUpdate;
  let deliveryUpdate;
  ReservationStaffRequest.findOneAndUpdate = async (filter, update) => {
    claimFilter = filter;
    claimUpdate = update;
    return {
      ...request,
      notification: {
        email: {
          status: "not_attempted",
          claimToken: update.$set["notification.email.claimToken"],
        },
      },
    };
  };
  ReservationStaffRequest.updateOne = async (filter, update) => {
    deliveryUpdate = { filter, update };
  };
  const sent = [];
  const result = await notifyReservationCallbackCreated(request, {
    send: async (message) => {
      sent.push(message);
      return { id: `provider-${sent.length}` };
    },
  });

  assert.equal(result.status, "sent");
  assert.deepEqual(sent.map((message) => message.to), [
    "owner@example.com",
    "admin@example.com",
  ]);
  assert.match(sent[0].text, /Customer: <Customer>/);
  assert.match(sent[0].html, /&lt;Customer&gt;/);
  assert.doesNotMatch(sent[0].text, /PRIVATE_INTERNAL_SUMMARY|PRIVATE_TRANSCRIPT|PRIVATE_SESSION_ID/);
  assert.doesNotMatch(sent[0].html, /PRIVATE_INTERNAL_SUMMARY|PRIVATE_TRANSCRIPT|PRIVATE_SESSION_ID/);
  assert.equal(claimFilter._id, request._id);
  assert.equal(claimFilter.companyId, request.companyId);
  assert.equal(claimFilter.type, "callback");
  assert.equal(claimUpdate.$inc["notification.email.attempts"], 1);
  assert.equal(deliveryUpdate.update.$set["notification.email.status"], "sent");
  assert.equal(deliveryUpdate.update.$set["notification.email.providerMessageId"], "provider-1,provider-2");
});

test("records no_recipients without attempting delivery", async () => {
  setMemberships([]);
  const request = makeRequest();
  let deliveryUpdate;
  ReservationStaffRequest.updateOne = async (filter, update) => {
    deliveryUpdate = { filter, update };
  };
  let sendCount = 0;
  const result = await notifyReservationCallbackCreated(request, {
    send: async () => {
      sendCount += 1;
    },
  });

  assert.equal(result.status, "no_recipients");
  assert.equal(sendCount, 0);
  assert.equal(deliveryUpdate.update.$set["notification.email.status"], "no_recipients");
  assert.equal(deliveryUpdate.filter.type, "callback");
});

test("records failed delivery with a normalized failure code and remains retryable", async () => {
  setMemberships([{ userId: { email: "owner@example.com" } }]);
  const request = makeRequest();
  let deliveryUpdate;
  ReservationStaffRequest.findOneAndUpdate = async (_filter, update) => ({
    ...request,
    notification: {
      email: {
        status: "not_attempted",
        claimToken: update.$set["notification.email.claimToken"],
      },
    },
  });
  ReservationStaffRequest.updateOne = async (_filter, update) => {
    deliveryUpdate = update;
  };

  const result = await notifyReservationCallbackCreated(request, {
    send: async () => {
      const error = new Error("provider unavailable");
      error.code = "EMAIL_PROVIDER_ERROR";
      throw error;
    },
  });

  assert.deepEqual(result, {
    status: "failed",
    failureCode: "EMAIL_PROVIDER_ERROR",
  });
  assert.equal(deliveryUpdate.$set["notification.email.status"], "failed");
  assert.equal(deliveryUpdate.$set["notification.email.failureCode"], "EMAIL_PROVIDER_ERROR");
  assert.equal(deliveryUpdate.$unset["notification.email.claimToken"], "");
});

test("does not send for reschedule/cancellation requests and does not query recipients", async () => {
  let queried = false;
  CompanyMembership.find = () => {
    queried = true;
    throw new Error("recipient lookup should not run");
  };
  const result = await notifyReservationCallbackCreated(
    makeRequest({ type: "reschedule" }),
    { send: async () => assert.fail("should not send") },
  );
  assert.deepEqual(result, { status: "ignored" });
  assert.equal(queried, false);
});

test("does not send a request already marked sent", async () => {
  let sendCount = 0;
  const result = await notifyReservationCallbackCreated(
    makeRequest({
      notification: { email: { status: "sent" } },
    }),
    { send: async () => { sendCount += 1; } },
  );
  assert.deepEqual(result, { status: "already_sent" });
  assert.equal(sendCount, 0);
});

test("email payload contains only approved callback fields and escapes HTML", () => {
  const payload = getEmailPayload(makeRequest());
  assert.match(payload.text, /Preferred time: tomorrow at 10:00/);
  assert.match(payload.text, /Service\/team: General consultation/);
  assert.match(payload.text, /https:\/\/dashboard\.terrapeakgroup\.com\/dashboard\/reservations\/callback-requests/);
  assert.match(payload.html, /&lt;script&gt;alert\(&#39;internal&#39;\)&lt;\/script&gt;/);
  assert.doesNotMatch(payload.text, /PRIVATE_INTERNAL_SUMMARY|PRIVATE_TRANSCRIPT|PRIVATE_SESSION_ID/);
  assert.doesNotMatch(payload.html, /PRIVATE_INTERNAL_SUMMARY|PRIVATE_TRANSCRIPT|PRIVATE_SESSION_ID/);
});

test("notification attempts accept zero and positive integers only", async () => {
  const makeDocument = (attempts) =>
    new ReservationStaffRequestModel({
      companyId: "507f1f77bcf86cd799439011",
      type: "callback",
      notification: { email: { attempts } },
    });

  assert.equal((await makeDocument(0).validate()).notification.email.attempts, 0);
  assert.equal((await makeDocument(3).validate()).notification.email.attempts, 3);

  await assert.rejects(
    makeDocument(-1).validate(),
    (error) => Boolean(error.errors["notification.email.attempts"]),
  );
  await assert.rejects(
    makeDocument(1.5).validate(),
    (error) =>
      error.errors["notification.email.attempts"]?.message ===
      "notification email attempts must be an integer",
  );
});
