import express from "express";
import isAuthenticated from "../middleware/isAuthenticated.js";
import isPlatformAdmin from "../middleware/isPlatformAdmin.js";
import {
  listMySupportConversations,
  createSupportConversation,
  replyToMySupportConversation,
  listPlatformSupportConversations,
  getPlatformSupportConversation,
  replyToPlatformSupportConversation,
  updatePlatformSupportConversation,
} from "../controllers/supportController.js";

const router = express.Router();

router.get("/conversations", isAuthenticated, listMySupportConversations);
router.post("/conversations", isAuthenticated, createSupportConversation);
router.post(
  "/conversations/:conversationId/messages",
  isAuthenticated,
  replyToMySupportConversation
);

router.get(
  "/platform/conversations",
  isAuthenticated,
  isPlatformAdmin,
  listPlatformSupportConversations
);
router.get(
  "/platform/conversations/:conversationId",
  isAuthenticated,
  isPlatformAdmin,
  getPlatformSupportConversation
);
router.post(
  "/platform/conversations/:conversationId/messages",
  isAuthenticated,
  isPlatformAdmin,
  replyToPlatformSupportConversation
);
router.patch(
  "/platform/conversations/:conversationId",
  isAuthenticated,
  isPlatformAdmin,
  updatePlatformSupportConversation
);

export default router;
