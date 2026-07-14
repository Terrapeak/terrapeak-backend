const aiAssistantManifest = {
  slug: "ai-assistant",
  name: "AI Assistant",
  category: "core",
  icon: "Bot",
  launchMode: "internal",
  basePath: "/dashboard",

  navigation: {
    title: "AI Assistant",
    icon: "Bot",
    items: [
      { name: "Home", path: "/dashboard", icon: "Home" },
      { name: "Settings", path: "/dashboard/chatbot-setting", icon: "Settings" },
      { name: "Integrate Bot", path: "/dashboard/integrate", icon: "Bot" },
      { name: "Preview", path: "/dashboard/preview", icon: "Eye" },
      { name: "Appointments", path: "/dashboard/appointment", icon: "Calendar" },
      { name: "Chat Logs", path: "/dashboard/chatLog", icon: "MessageSquare" },
    ],
  },
};

export default aiAssistantManifest;