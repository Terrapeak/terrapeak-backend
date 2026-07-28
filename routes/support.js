import express from "express";
import isPlatformAuthenticated from "../middleware/isPlatformAuthenticated.js";
import isPlatformAdmin from "../middleware/isPlatformAdmin.js";
import resolveCompanyContext from "../middleware/resolveCompanyContext.js";
import {
  listMySupportConversations,
  createSupportConversation,
  replyToMySupportConversation,
  hideMySupportConversation,
  listPlatformSupportConversations,
  getPlatformSupportConversation,
  markAllPlatformSupportConversationsRead,
  analyzePlatformSupportConversation,
  replyToPlatformSupportConversation,
  updatePlatformSupportConversation,
  archivePlatformSupportConversation,
  restorePlatformSupportConversation,
  permanentlyDeletePlatformSupportConversation,
} from "../controllers/supportController.js";
import { listSupportKnowledgeArticles, createSupportKnowledgeArticle, updateSupportKnowledgeArticle, deleteSupportKnowledgeArticle } from "../controllers/supportKnowledgeController.js";
import { listSupportAssignees, listPlatformTasks, listConversationTasks, createConversationTask, createTaskFromAiSuggestion, updateConversationTask } from "../controllers/supportTaskController.js";
import { listConversationInternalNotes, createConversationInternalNote } from "../controllers/supportInternalNoteController.js";
import { listMySupportNotifications, markSupportNotificationRead, markAllSupportNotificationsRead } from "../controllers/supportNotificationController.js";
import { listSupportSavedReplies, createSupportSavedReply, updateSupportSavedReply, deleteSupportSavedReply } from "../controllers/supportSavedReplyController.js";
import { getSupportReport } from "../controllers/supportReportController.js";

const router = express.Router();

router.get("/conversations", resolveCompanyContext, listMySupportConversations);
router.post("/conversations", resolveCompanyContext, createSupportConversation);
router.post("/conversations/:conversationId/messages", resolveCompanyContext, replyToMySupportConversation);
router.delete("/conversations/:conversationId", resolveCompanyContext, hideMySupportConversation);

const platformAuth = [isPlatformAuthenticated, isPlatformAdmin];

router.get("/platform/conversations", ...platformAuth, listPlatformSupportConversations);
router.patch("/platform/conversations/read-all", ...platformAuth, markAllPlatformSupportConversationsRead);
router.get("/platform/conversations/:conversationId", ...platformAuth, getPlatformSupportConversation);
router.post("/platform/conversations/:conversationId/analyze", ...platformAuth, analyzePlatformSupportConversation);
router.post("/platform/conversations/:conversationId/messages", ...platformAuth, replyToPlatformSupportConversation);
router.patch("/platform/conversations/:conversationId", ...platformAuth, updatePlatformSupportConversation);
router.post("/platform/conversations/:conversationId/archive", ...platformAuth, archivePlatformSupportConversation);
router.post("/platform/conversations/:conversationId/restore", ...platformAuth, restorePlatformSupportConversation);
router.delete("/platform/conversations/:conversationId", ...platformAuth, permanentlyDeletePlatformSupportConversation);
router.get("/platform/conversations/:conversationId/internal-notes", ...platformAuth, listConversationInternalNotes);
router.post("/platform/conversations/:conversationId/internal-notes", ...platformAuth, createConversationInternalNote);
router.get("/platform/notifications", ...platformAuth, listMySupportNotifications);
router.patch("/platform/notifications/read-all", ...platformAuth, markAllSupportNotificationsRead);
router.patch("/platform/notifications/:notificationId/read", ...platformAuth, markSupportNotificationRead);
router.get("/platform/reports", ...platformAuth, getSupportReport);
router.get("/platform/assignees", ...platformAuth, listSupportAssignees);
router.get("/platform/tasks", ...platformAuth, listPlatformTasks);
router.get("/platform/conversations/:conversationId/tasks", ...platformAuth, listConversationTasks);
router.post("/platform/conversations/:conversationId/tasks", ...platformAuth, createConversationTask);
router.post("/platform/conversations/:conversationId/tasks/from-ai", ...platformAuth, createTaskFromAiSuggestion);
router.patch("/platform/conversations/:conversationId/tasks/:taskId", ...platformAuth, updateConversationTask);
router.get("/platform/knowledge", ...platformAuth, listSupportKnowledgeArticles);
router.post("/platform/knowledge", ...platformAuth, createSupportKnowledgeArticle);
router.patch("/platform/knowledge/:articleId", ...platformAuth, updateSupportKnowledgeArticle);
router.delete("/platform/knowledge/:articleId", ...platformAuth, deleteSupportKnowledgeArticle);
router.get("/platform/saved-replies", ...platformAuth, listSupportSavedReplies);
router.post("/platform/saved-replies", ...platformAuth, createSupportSavedReply);
router.patch("/platform/saved-replies/:replyId", ...platformAuth, updateSupportSavedReply);
router.delete("/platform/saved-replies/:replyId", ...platformAuth, deleteSupportSavedReply);

export default router;
