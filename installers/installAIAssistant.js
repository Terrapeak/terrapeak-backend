import ChatbotSettings from "../models/chatbotSettings.js";

export default async function installAIAssistant({
  company,
  user,
}) {
  let chatbotSettings = await ChatbotSettings.findOne({
    companyId: company._id,
  });

  if (chatbotSettings) {
    console.log("AI Assistant already installed.");
    return chatbotSettings;
  }

  chatbotSettings = new ChatbotSettings({
    userId: user._id,
    companyId: company._id,

    brandName: company.displayName,

    botName: `${company.displayName} Assistant`,

    welcomeMessage: `Welcome to ${company.displayName}! How can I help you today?`,

    reservationBusinessSlug:
      company.reservationBusinessSlug,

    gemini_model: "gemini-2.5-flash",
  });

  await chatbotSettings.save();

  console.log("✓ Installed AI Assistant");

  return chatbotSettings;
}