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
    settings