import express from "express";
import isAuthenticated from "../middleware/isAuthenticated.js";
import isPlatformAdmin from "../middleware/isPlatformAdmin.js";
import {
  listMySupportConversations,
  createSupportConversation,
  replyToMySupportConversation,
  listPlatformSupportConversations,
  getPlatformSupportConversation,
  analyzePlatformSupportConversation,
  replyToPlatformSupportConversation,
  updatePlatformSupportConversation,
} from "../controllers/supportController.js";
import {
  listSupportKnowledgeArticles,
  createSupportKnowledgeArticle,
  updateSupportKnowledgeArticle,
  deleteSupportKnowledgeArticle,
} from "../controllers/supportKnowledgeController.js";

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
  "/platform/conversations/:conversationId/analyze",
  isAuthenticated,
  isPlatformAdmin,
  analyzePlatformSupportConversation
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

router.get(
  "/platform/knowledge",
  isAuthenticated,
  isPlatformAdmin,
  listSupportKnowledgeArticles
);
router.post(
  "/platform/knowledge",
  isAuthenticated,
  isPlatformAdmin,
  createSupportKnowledgeArticle
);
router.patch(
  "/platform/knowledge/:articleId",
  isAuthenticated,
  isPlatformAdmin,
  updateSupportKnowledgeArticle
);
router.delete(
  "/platform/knowledge/:articleId",
  isAuthenticated,
  isPlatformAdmin,
  deleteSupportKnowledgeArticle
);

export default router;
