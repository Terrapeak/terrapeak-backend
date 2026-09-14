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

  const previousStatus = request.status;
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
              metadata: { requestId: request._id, oldStatus: previousStatus, newStatus: status },
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
