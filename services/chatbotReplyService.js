import axios from "axios";
import ChatbotSettings from "../models/chatbotSettings.js";
import ChannelMessage from "../models/channelMessage.js";

const HISTORY_LIMIT = 12;

const instructionText = (settings) =>
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

export const getChatbotSettingsForCompany =
  async (companyId) => ChatbotSettings.findOne({ companyId });

const loadRecentHistory = async ({ companyId, conversationId }) => {
  const messages = await ChannelMessage.find({
    companyId,
    conversationId,
    direction: { $in: ["inbound", "outbound"] },
    message: { $type: "string", $ne: "" },
  })
    .sort({ createdAt: -1 })
    .limit(HISTORY_LIMIT)
    .select("direction message")
    .lean();

  return messages.reverse();
};

const toGeminiContents = (messages, message) => {
  const contents = messages.map((historyItem) => ({
    role: historyItem.direction === "outbound" ? "model" : "user",
    parts: [{ text: historyItem.message }],
  }));
  const latestMessage = messages.at(-1);

  // Channel webhooks normally save the inbound message before requesting a
  // reply. Append it only when a caller has not already persisted it.
  if (
    message &&
    !(
      latestMessage?.direction === "inbound" &&
      latestMessage.message === message
    )
  ) {
    contents.push({ role: "user", parts: [{ text: message }] });
  }

  return contents;
};

export const generateChatbotReply = async ({
  companyId,
  conversationId,
  message = "",
}) => {
  if (!companyId || !conversationId) {
    throw new Error("companyId and conversationId are required.");
  }

  const [settings, history] = await Promise.all([
    getChatbotSettingsForCompany(companyId),
    loadRecentHistory({ companyId, conversationId }),
  ]);

  if (!settings) {
    throw new Error("Chatbot settings were not found for this company.");
  }

  if (!settings.geminiKey || !settings.gemini_model) {
    throw new Error("Gemini API key and model must be configured.");
  }

  const contents = toGeminiContents(history, message.trim());

  if (!contents.length) {
    throw new Error("A message is required to generate a chatbot reply.");
  }

  const systemPrompt = instructionText(settings);
  const payload = {
    ...(systemPrompt
      ? {
          systemInstruction: {
            parts: [{ text: systemPrompt }],
          },
        }
      : {}),
    contents,
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 2048,
    },
  };
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/` +
    `${encodeURIComponent(settings.gemini_model)}:generateContent` +
    `?key=${encodeURIComponent(settings.geminiKey)}`;
  const { data } = await axios.post(url, payload, {
    headers: { "Content-Type": "application/json" },
  });
  const generatedText = (data?.candidates?.[0]?.content?.parts || [])
    .map((part) => part?.text || "")
    .join("")
    .trim();

  if (!generatedText) {
    throw new Error("Gemini did not return a generated reply.");
  }

  return generatedText;
};
