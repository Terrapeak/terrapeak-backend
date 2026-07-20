import axios from "axios";
import ChatbotSettings from "../models/chatbotSettings.js";
import ChannelMessage from "../models/channelMessage.js";

const HISTORY_LIMIT = 12;

const getInstructionText = (settings) =>
  [
    settings.systemInstruction,
    settings.systemInstructionFileText1?.setFile
      ? settings.systemInstructionFileText1.FileText
      : "",
    settings.systemInstructionFileText2?.setFile
      ? settings.systemInstructionFileText2.FileText
      : "",
  ]
    .filter((value) => typeof value === "string" && value.trim())
    .join("\n\n")
    .trim();

export const getChatbotSettingsForCompany = async (companyId) => {
  if (!companyId) {
    throw new Error("companyId is required to resolve chatbot settings.");
  }

  const settings = await ChatbotSettings.findOne({ companyId });

  if (!settings) {
    throw new Error("No chatbot settings were found for this company.");
  }

  if (!settings.geminiKey || !settings.gemini_model) {
    throw new Error("Gemini API key and model must be configured.");
  }

  return settings;
};

const loadConversationHistory = async ({ conversationId }) => {
  if (!conversationId) return [];

  const messages = await ChannelMessage.find({ conversationId })
    .sort({ eventTimestamp: -1, createdAt: -1