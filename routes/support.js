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
import {
  listSupportAssignees,
  listPlatformTasks,
  listConversationTasks,
  createConversationTask,
  createTaskFromAiSuggestion,
  updateConversationTask,
} from "../controllers/supportTaskController.js";
import {
  listConversationInternalNotes,
  createConversationInternalNote,
} from "../controllers/supportInternalNoteController.js";
import {
  listMySupportNotifications,
  markSupportNotificationRead,
  markAllSupportNotificationsRead,
} from "../controllers/supportNotificationController.js";

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
  "/platform/conversations/:conversationId/internal-notes",
  isAuthenticated,
  isPlatformAdmin,
  listConversationInternalNotes
);
router.post(
  "/platform/conversations/:conversationId/internal-notes",
  isAuthenticated,
  isPlatformAdmin,
  createConversationInternalNote
);

router.get(
  "/platform/notifications",
  isAuthenticated,
  isPlatformAdmin,
  listMySupportNotifications
);
router.patch(
  "/platform/notifications/read-all",
  isAuthenticated,
  isPlatformAdmin,
  markAllSupportNotificationsRead
);
router.patch(
  "/platform/notifications/:notificationId/read",
  isAuthenticated,
  isPlatformAdmin,
  markSupportNotificationRead
);

router.get(
  "/platform/assignees",
  isAuthenticated,
  isPlatformAdmin,
  listSupportAssignees
);
router.get(
  "/platform/tasks",
  isAuthenticated,
  isPlatformAdmin,
  listPlatformTasks
);
router.get(
  "/platform/conversations/:conversationId/tasks",
  isAuthenticated,
  isPlatformAdmin,
  listConversationTasks
);
router.post(
  "/platform/conversations/:conversationId/tasks",
  isAuthenticated,
  isPlatformAdmin,
  createConversationTask
);
router.post(
  "/platform/conversations/:conversationId/tasks/from-ai",
  isAuthenticated,
  isPlatformAdmin,
  createTaskFromAiSuggestion
);
router.patch(
  "/platform/conversations/:conversationId/tasks/:taskId",
  isAuthenticated,
  isPlatformAdmin,
  updateConversationTask
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
