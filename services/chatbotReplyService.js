import axios from "axios";
import ChatbotSettings from "../models/chatbotSettings.js";
import ChannelMessage from "../models/channelMessage.js";

const HISTORY_LIMIT = 12;

const instructionText = (s) => [
  s.systemInstruction,
  s.systemInstructionFileText1?.setFile ? s.systemInstructionFileText1.FileText : "",
  s.systemInstructionFileText2?.setFile ? s.systemInstructionFileText2.FileText : "",
].filter((v) => typeof v === "string" && v.trim()).join("\n\n").trim();

export const getChatbotSettingsForCompany =