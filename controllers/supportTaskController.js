import asyncHandler from "express-async-handler";
import mongoose from "mongoose";
import SupportConversation from "../models/supportConversation.js";
import SupportTask from "../models/supportTask.js";
import User from "../models/user.js";

const ALLOWED_STATUSES = new Set(["open", "in_progress", "done", "cancelled"]);
const ALLOWED_PRIORITIES = new Set(["low", "normal", "high", "urgent"]);
const PLATFORM_ROLES = [
