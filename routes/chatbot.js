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
  stripCustomerAIConfigUpdates,
  maskCustomerAIConfigResponse,
  saveChatbotSettings
);

router.post("/extract-instruction", upload.single("file"), extractInstructions);

router.post("/optimize-system-instruction", optimizeSystemInstruction);

router.get("/getApiKey", isVerifiedUser, resolveCompanyContext, getApiKey);
router.post("/website-info", isVerifiedUser, resolveCompanyContext, saveWebsiteInfo);
router.post("/action", isVerifiedUser, resolveCompanyContext, saveBotAction);

// Public route (uses x-api-key and domain validation instead)
router.post("/ask", askRateLimiter, askGemini);

router.get("/session/:sessionId", verifyDomain, getSession);

router.get("/sessions", resolveCompanyContext, getUsersChatlog);

export default router;
