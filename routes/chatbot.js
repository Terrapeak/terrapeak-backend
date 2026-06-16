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
import isAuthenticated from "../middleware/isAuthenticated.js";
import isVerifiedUser from "../middleware/isVerifiedUser.js";
import { askRateLimiter } from "../middleware/rateLimiter.js";
import { verifyDomain } from "../middleware/validateChatbotApiKey.js";
import upload from "../utils/upload.js";

const router = express.Router();


// Protected routes for logged-in users
router.get("/settings", isAuthenticated, isVerifiedUser, getChatbotSettings);
router.get("/settingByKey", verifyDomain, getChatbotSettingsByKey);
router.post("/settings", isVerifiedUser, saveChatbotSettings);

router.post("/extract-instruction", upload.single("file"), extractInstructions);

router.post("/optimize-system-instruction", optimizeSystemInstruction);

router.get("/getApiKey", isVerifiedUser, getApiKey);
router.post("/website-info", isAuthenticated, isVerifiedUser, saveWebsiteInfo);
router.post("/action", isAuthenticated, isVerifiedUser, saveBotAction);

// Public route (uses x-api-key and domain validation instead)
router.post("/ask", askRateLimiter, askGemini);

router.get("/session/:sessionId", verifyDomain, getSession);

router.get("/sessions", isAuthenticated, getUsersChatlog);

export default router;
