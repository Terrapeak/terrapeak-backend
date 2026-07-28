import express from "express";
import {
  getChatbotSettings,
  saveChatbotSettings,
  askGemini,
  getChatbotSettingsByKey,
  getApiKey,
  saveWebsiteInfo,
  saveBotAction,
  getSession,
  getUsersChatlog,
  extractInstructions,
  optimizeSystemInstruction,
} from "../controllers/chatbotController.js";
import isVerifiedUser from "../middleware/isVerifiedUser.js";
import resolveCompanyContext from "../middleware/resolveCompanyContext.js";
import requireCompanyWriteAccess from "../middleware/requireCompanyWriteAccess.js";
import { askRateLimiter } from "../middleware/rateLimiter.js";
import { verifyDomain } from "../middleware/validateChatbotApiKey.js";
import {
  maskCustomerAIConfigResponse,
  stripCustomerAIConfigUpdates,
} from "../middleware/protectCustomerAIConfig.js";
import upload from "../utils/upload.js";

const router = express.Router();

// Protected routes for logged-in users
router.get(
  "/settings",
  isVerifiedUser,
  resolveCompanyContext,
  maskCustomerAIConfigResponse,
  getChatbotSettings
);
router.get("/settingByKey", verifyDomain, getChatbotSettingsByKey);
router.post(
  "/settings",
  isVerifiedUser,
  resolveCompanyContext,
  requireCompanyWriteAccess,
  stripCustomerAIConfigUpdates,
  maskCustomerAIConfigResponse,
  saveChatbotSettings
);

router.post(
  "/extract-instruction",
  isVerifiedUser,
  resolveCompanyContext,
  requireCompanyWriteAccess,
  upload.single("file"),
  extractInstructions
);

router.post(
  "/optimize-system-instruction",
  isVerifiedUser,
  resolveCompanyContext,
  requireCompanyWriteAccess,
  optimizeSystemInstruction
);

router.get(
  "/getApiKey",
  isVerifiedUser,
  resolveCompanyContext,
  requireCompanyWriteAccess,
  getApiKey
);
router.post(
  "/website-info",
  isVerifiedUser,
  resolveCompanyContext,
  requireCompanyWriteAccess,
  saveWebsiteInfo
);
router.post(
  "/action",
  isVerifiedUser,
  resolveCompanyContext,
  requireCompanyWriteAccess,
  saveBotAction
);

// Public route (uses x-api-key and domain validation instead)
router.post("/ask", askRateLimiter, askGemini);

router.get("/session/:sessionId", verifyDomain, getSession);

router.get(
  "/sessions",
  isVerifiedUser,
  resolveCompanyContext,
  getUsersChatlog
);

export default router;
