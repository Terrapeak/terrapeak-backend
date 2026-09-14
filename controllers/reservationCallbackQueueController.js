import asyncHandler from "express-async-handler";
import {
  CALLBACK_STATUSES,
  listTenantCallbackRequests,
  updateTenantCallbackRequestStatus,
} from "../services/reservationCallbackQueueService.js";

export const getTenantCallbackRequests = asyncHandler(async (req, res) => {
  const status = String(req.query.status || "").trim();
  if (status && !CALLBACK_STATUSES.includes(status)) {
    return res.status(400).json({ success: false, message: "Select a valid callback request status." });
  }
  const requests = await listTenantCallbackRequests({
    companyId: req.company._id,
    status: status || undefined,
  });
  return res.json({ success: true, requests });
});

export const patchTenantCallbackRequest = asyncHandler(async (req, res) => {
  const request = await updateTenantCallbackRequestStatus({
    companyId: req.company._id,
    requestId: req.params.requestId,
    status: req.body?.status,
    actorUserId: req.userId,
  });
  return res.json({ success: true, request });
});

---FILE---
import mongoose from "mongoose";
import Company from "../models/company.js";
import ReservationStaffRequest from "../models/reservationStaffRequest.js";

export const CALLBACK_STATUSES = Object.freeze([
  "pending",
  "reviewing",
  "completed",
  "dismissed",
]);

const TRANSITIONS = Object.freeze({
  pending: new Set(["reviewing", "completed", "dismissed"]),
  reviewing: new Set(["completed", "dismissed"]),
  completed: new Set(),
  dismissed: new Set(),
});

export const serializeReservationCallbackRequest = (request) => {
  const change = request?.requestedChange || {};
  return {
    id: String(request?._id || request?.id || ""),
    customerName: request?.customerName || "",
    customerContact: request?.customerContact || "",
    preferredCallbackTime: change.preferredCallbackTime || "",
    questionOrConcern: change.question || "",
    serviceOrProviderContext: change.serviceOrTeacher || "",
    reservationReference: request?.reservationReference || "",
    createdAt: request?.createdAt || null,
    updatedAt: request?.updatedAt || null,
    status: request?.status || "pending",
  };
};

export const listTenantCallbackRequests = async ({ companyId, status }) => {
  const query = { companyId, type: "callback" };
  if (status) query.status = status;
  const requests = await ReservationStaffRequest.find(query)
    .sort({ createdAt: -1 })
    .limit(100)
    .lean();
  return requests.map(serializeReservationCallbackRequest);
};

export const updateTenantCallbackRequestStatus = async ({
  companyId,
  requestId,
  status,
  actorUserId,
}) => {
  if (!mongoose.isValidObjectId(requestId)) {
    const error = new Error("Callback request not found.");
    error.statusCode = 404;
    throw error;
  }

  const request = await ReservationStaffRequest.findOne({
    _id: requestId,
    companyId,
    type: "callback",
  });
  if (!request) {
    const error = new Error("Callback request not found.");
    error.statusCode = 404;
    throw error;
  }
  if (!CALLBACK_STATUSES.includes(status)) {
    const error = new Error("Select a valid callback request status.");
    error.statusCode = 400;
    throw error;
  }
  if (!TRANSITIONS[request.status]?.has(status)) {
    const error = new Error(
      `A ${request.status} callback request cannot move to ${status}.`,
    );
    error.statusCode = 409;
    throw error;
  }

  request.status = status;
  await request.save();
  await Company.updateOne(
    { _id: companyId },
    {
      $push: {
        activityEvents: {
          $each: [
            {
              eventType: "updated",
              title: "Reservations callback request updated",
              appSlug: "reservations",
              appName: "Reservations",
              actorUserId: actorUserId || null,
              createdAt: new Date(),
              metadata: { requestId: request._id, status },
            },
          ],
          $position: 0,
          $slice: 50,
        },
      },
    },
  );
  return serializeReservationCallbackRequest(request);
};

---FILE---
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
  ReservationStaffRequest.findOne = async () => request;
  Company.updateOne = async (filter) => { companyFilter = filter; };
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
    assert.equal("summary" in result, false);
  } finally {
    ReservationStaffRequest.findOne = originalFindOne;
    Company.updateOne = originalUpdateOne;
  }
});

