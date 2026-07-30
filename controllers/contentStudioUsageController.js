import asyncHandler from "express-async-handler";
import { getContentStudioUsageSnapshot } from "../services/contentStudio/contentStudioUsageService.js";

export const getCompanyContentStudioUsage = asyncHandler(async (req, res) => {
  const companyId = req.company?._id || req.companyId;
  const usage = await getContentStudioUsageSnapshot({ companyId });
  res.json({ success: true, data: usage });
});

export const getPlatformCompanyContentStudioUsage = asyncHandler(async (req, res) => {
  const usage = await getContentStudioUsageSnapshot({ companyId: req.params.companyId });
  res.json({ success: true, data: usage });
});
