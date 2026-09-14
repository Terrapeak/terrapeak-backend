import test from "node:test";
import assert from "node:assert/strict";
import {
  CALLBACK_STATUSES,
  listTenantCallbackRequests,
  serializeReservationCallbackRequest,
  updateTenantCallbackRequestStatus,
} from "../services/reservationCallbackQueueService.js";
import ReservationStaffRequest from "../models/reservationStaffRequest.js";
import Company from "../models/company.js";

test("callback serializer exposes operational fields and excludes internal data", () => {
  const result = serializeReservationCallbackRequest({
    _id: "abc123",
    customerName: "Ada",
    customerContact: "hidden-contact",
    requestedChange: {
      preferredCallbackTime: "Tomorrow morning",
      question: "Pricing",
      serviceOrTeacher: "Consultation",
    },
    reservationReference: "BK-1",
    status: "pending",
    summary: "private summary",
    transcript: "private transcript",
    sessionId: "private-session",
  });
  assert.deepEqual(result, {
    id: "abc123",
    customerName: "Ada",
    customerContact: "hidden-contact",
    preferredCallbackTime: "Tomorrow morning",
    questionOrConcern: "Pricing",
    serviceOrProviderContext: "Consultation",
    reservationReference: "BK-1",
    createdAt: null,
    updatedAt: null,
    status: "pending",
  });
  assert.equal("summary" in result, false);
  assert.equal("transcript" in result, false);
  assert.equal("sessionId" in result, false);
});

test("callback status contract permits only forward operational transitions", () => {
  assert.deepEqual(CALLBACK_STATUSES, ["pending", "reviewing", "completed", "dismissed"]);
});

test("tenant queue listing is limited to callback requests for the resolved company", async () => {
  let capturedQuery;
  const chain = {
    sort(value) { assert.deepEqual(value, { createdAt: -1 }); return this; },
    limit(value) { assert.equal(value, 100); return this; },
    lean: async () => [{ _id: "507f1f77bcf86cd799439011", type: "callback", companyId: "company-a", status: "pending" }],
  };
  const originalFind = ReservationStaffRequest.find;
  ReservationStaffRequest.find = (query) => { capturedQuery = query; return chain; };
  try {
    const requests = await listTenantCallbackRequests({ companyId: "company-a", status: "pending" });
    assert.deepEqual(capturedQuery, { companyId: "company-a", type: "callback", status: "pending" });
    assert.equal(requests[0].id, "507f1f77bcf86cd799439011");
  } finally {
    ReservationStaffRequest.find = originalFind;
  }
});

test("tenant status update cannot cross company boundaries", async () => {
  const originalFindOne = ReservationStaffRequest.findOne;
  ReservationStaffRequest.findOne = async (query) => {
    assert.deepEqual(query, {
      _id: "507f1f77bcf86cd799439011",
      companyId: "company-a",
      type: "callback",
    });
    return null;
  };
  try {
    await assert.rejects(
      updateTenantCallbackRequestStatus({
        companyId: "company-a",
        requestId: "507f1f77bcf86cd799439011",
        status: "reviewing",
      }),
      /Callback request not found/,
    );
  } finally {
    ReservationStaffRequest.findOne = originalFindOne;
  }
});

test("status update records tenant audit activity without returning private fields", async () => {
  const request = {
    _id: "507f1f77bcf86cd799439011",
    companyId: "company-a",
    type: "callback",
    status: "pending",
    customerName: "Ada",
    requestedChange: { question: "Pricing" },
    save: async () => {},
  };
  const originalFindOne = ReservationStaffRequest.findOne;
  const originalUpdateOne = Company.updateOne;
  let companyFilter;
  let companyUpdate;
  ReservationStaffRequest.findOne = async () => request;
  Company.updateOne = async (filter, update) => { companyFilter = filter; companyUpdate = update; };
  try {
    const result = await updateTenantCallbackRequestStatus({
      companyId: "company-a",
      requestId: "507f1f77bcf86cd799439011",
      status: "reviewing",
      actorUserId: "507f1f77bcf86cd799439012",
    });
    assert.equal(request.status, "reviewing");
    assert.deepEqual(companyFilter, { _id: "company-a" });
    assert.equal(result.status, "reviewing");
    assert.equal(companyUpdate.$push.activityEvents.$each[0].metadata.oldStatus, "pending");
    assert.equal(companyUpdate.$push.activityEvents.$each[0].metadata.newStatus, "reviewing");
    assert.equal("summary" in result, false);
  } finally {
    ReservationStaffRequest.findOne = originalFindOne;
    Company.updateOne = originalUpdateOne;
  }
});


test("status update rejects invalid statuses", async () => {
  const originalFindOne = ReservationStaffRequest.findOne;
  ReservationStaffRequest.findOne = async () => ({ status: "pending" });
  try {
    await assert.rejects(
      updateTenantCallbackRequestStatus({
        companyId: "company-a",
        requestId: "507f1f77bcf86cd799439011",
        status: "unknown",
      }),
      (error) => error.statusCode === 400,
    );
  } finally {
    ReservationStaffRequest.findOne = originalFindOne;
  }
});

test("status update rejects backward transitions", async () => {
  const originalFindOne = ReservationStaffRequest.findOne;
  ReservationStaffRequest.findOne = async () => ({ status: "completed" });
  try {
    await assert.rejects(
      updateTenantCallbackRequestStatus({
        companyId: "company-a",
        requestId: "507f1f77bcf86cd799439011",
        status: "pending",
      }),
      (error) => error.statusCode === 409,
    );
  } finally {
    ReservationStaffRequest.findOne = originalFindOne;
  }
});
