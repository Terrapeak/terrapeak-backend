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
    throw new Error("Chatbot settings were not found for this company.");
  }

  if (!settings.geminiKey || !settings.gemini_model) {
    throw new Error("The company chatbot AI configuration is incomplete.");
  }

  return settings;