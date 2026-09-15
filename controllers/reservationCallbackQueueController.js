import asyncHandler from "express-async-handler";
import {
  CALLBACK_STATUSES,
  listTenantCallbackRequests,
  summarizeTenantCallbackRequests,
  updateTenantCallbackRequestStatus,
} from "../services/reservationCallbackQueueService.js";

export const getTenantCallbackRequests = asyncHandler(async (req, res) => {
  if (String(req.query.summary || "").trim() === "1") {
    return res.json(await summarizeTenantCallbackRequests({ companyId: req.company._id }));
  }

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
