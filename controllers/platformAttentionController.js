import asyncHandler from "express-async-handler";
import { runPlatformAttentionScan } from "../services/platformAttentionScanService.js";

export const scanPlatformAttention = asyncHandler(async (req, res) => {
  const result = await runPlatformAttentionScan();

  res.json({
    success: true,
    ...result,
  });
});
