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
  create