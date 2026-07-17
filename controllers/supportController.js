import asyncHandler from "express-async-handler";
import mongoose from "mongoose";
import CompanyMembership from "../models/companyMembership.js";
import SupportConversation from "../models/supportConversation.js";
import SupportTask from "../models/supportTask.js";
import User from "../models/user.js";
import { analyzeSupportConversation } from "../services/supportAiService.js";
import { buildSupportCompanyContext } from "../services/supportContextService.js";
import { findRelevantSupportKnowledge }