import mongoose from "mongoose";

const SupportMessageSchema = new mongoose.Schema({
  senderType: { type: String, enum: ["customer", "agent", "system"], required: true },
  senderUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  senderName: { type: String, default: "" },
  body: { type: String, required: true, trim: true, maxlength: 10000 },
  readByCustomer: { type: Boolean, default: false },
  readByPlatform: { type: Boolean, default: false },
}, { timestamps: true });

const SupportAiAnalysisSchema = new mongoose.Schema({
  summary: { type: String, default: "" },
  category: { type: String, default: "general" },
  priority: { type: String, default: "normal" },
  needsHuman: { type: Boolean, default: true },
  escalationReason: { type: String, default: "" },
  suggestedReply: { type: String, default: "" },
  suggestedAction: { type: String, default: "" },
  confidence: { type: Number, default: 0 },
  model: { type: String, default: "" },
  analyzedAt: { type: Date, default: null },
}, { _id: false });

const SupportPendingActionSchema = new mongoose.Schema({
  type: { type: String, enum: ["resend_invitation", "password_reset", "update_company_info", "add_user", "update_user", "deactivate_user", "remove_user", "clarify_phone_target"], required: true },
  membershipId: { type: mongoose.Schema.Types.ObjectId, ref: "CompanyMembership", default: null },
  targetUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  targetEmail: { type: String, default: "", lowercase: true, trim: true },
  targetName: { type: String, default: "", trim: true },
  targetPhone: { type: String, default: "", trim: true },
  targetCountry: { type: String, default: "", trim: true },
  targetRole: { type: String, enum: ["owner", "admin", "manager", "staff", "viewer", ""], default: "" },
  targetScope: { type: String, enum: ["self", "company", "other_user", "unknown", ""], default: "" },
  userField: { type: String, enum: ["name", "phone", "country", "role", "membership", ""], default: "" },
  companyField: { type: String, enum: ["displayName", "address", "website", "email", "phone", "country", ""], default: "" },
  oldValue: { type: String, default: "" },
  newValue: { type: String, default: "" },
  requestedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  expiresAt: { type: Date, required: true },
}, { _id: false });

const SupportConversationSchema = new mongoose.Schema({
  companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true, index: true },
  createdByUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  subject: { type: String, required: true, trim: true, maxlength: 180 },
  category: { type: String, enum: ["api_key", "technical", "billing", "users", "apps", "general"], default: "general" },
  priority: { type: String, enum: ["low", "normal", "high", "urgent"], default: "normal" },
  status: { type: String, enum: ["new", "needs_reply", "waiting_customer", "resolved"], default: "new", index: true },
  assignedToUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  messages: { type: [SupportMessageSchema], default: [] },
  aiAnalysis: { type: SupportAiAnalysisSchema, default: null },
  pendingAction: { type: SupportPendingActionSchema, default: null },
  lastMessageAt: { type: Date, default: Date.now, index: true },
  resolvedAt: { type: Date, default: null },
  customerHiddenAt: { type: Date, default: null, index: true },
  customerHiddenByUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  archivedAt: { type: Date, default: null, index: true },
  archivedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
}, { timestamps: true });

SupportConversationSchema.index({ companyId: 1, lastMessageAt: -1 });
SupportConversationSchema.index({ archivedAt: 1, lastMessageAt: -1 });

export default mongoose.model("SupportConversation", SupportConversationSchema);
