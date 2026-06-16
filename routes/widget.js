// routes/chatbotWidgetRoute.js

import express from "express";
import ChatbotSettings from "../models/chatbotSettings.js";

const router = express.Router();

router.get("/widget", async (req, res) => {
  const { apiKey } = req.query;
  const origin = req.headers.origin || req.headers.referer || "";

  if (!apiKey) return res.send("API key missing");

  const settings = await ChatbotSettings.findOne({ apiKey });
  if (!settings) return res.send("Invalid API key");

  // const isAllowed = settings.allowedDomains.some(domain => origin.includes(domain));
  // if (!isAllowed) return res.send("Not allowed");

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>${settings.botName}</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    html, body { margin: 0; height: 100%; }
    * { font-family: ${settings.font}; }
    ::-webkit-scrollbar { width: 6px; }
    ::-webkit-scrollbar-thumb { background: #ccc; border-radius: 4px; }
  </style>
</head>
<body class="bg-transparent">
  <div class="h-full w-full flex flex-col overflow-hidden shadow-xl rounded-[${settings.borderRadius}px]"
       style="background: ${settings.bgImage ? `url(${settings.bgImage})` : settings.backgroundColor};
              background-size: cover; background-position: center;
              box-shadow: ${settings.boxShadow ? '0 10px 20px rgba(0,0,0,0.2)' : 'none'}">
    
    <div class="p-3 text-base font-semibold bg-white/60 border-b border-gray-200 text-gray-800">
      🤖 ${settings.botName}
    </div>

    <div id="messages" class="flex-1 overflow-y-auto p-4 flex flex-col ${settings.chatDirection === "bottom-to-top" ? "flex-col-reverse" : "flex-col"} space-y-3"></div>

    <div class="p-3 border-t border-gray-300 flex items-center">
      <input id="message-input" type="text" placeholder="Type your message..." class="flex-1 px-3 py-2 text-sm border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500" />
      <button id="send-button" class="ml-2 px-4 py-2 text-sm rounded-md text-white flex items-center space-x-1 hover:opacity-90 transition-all"
        style="background: ${settings.themeColor};">
        ${settings.sendButtonIcon
          ? `<img src="${settings.sendButtonIcon}" class="w-5 h-5" />`
          : `<span>${settings.sendButtonLabel}</span>`}
      </button>
    </div>
  </div>

  <script>
    const apiKey = "${apiKey}";
    const showAvatars = ${settings.showAvatars};
    const userAvatar = "${settings.userAvatar}";
    const botAvatar = "${settings.botAvatar}";
    const avatarShape = "${settings.avatarShape}";
    const avatarSize = ${settings.avatarSize};
    const messageAlign = "${settings.messageAlign}";
    const messageStyle = "${settings.messageStyle}";
    const showTimestamp = ${settings.showTimestamp};
    const typingIndicator = ${settings.typingIndicator};

    const input = document.getElementById("message-input");
    const sendButton = document.getElementById("send-button");
    const messagesDiv = document.getElementById("messages");
    const chatHistory = [];

    const formatTimestamp = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const createBubble = (role, text) => {
      const wrapper = document.createElement("div");
      wrapper.className = "flex items-end " + (role === "user" ? "justify-end" : "justify-start");

      const bubble = document.createElement("div");
      bubble.className = "px-4 py-2 text-sm whitespace-pre-wrap";
      bubble.style.maxWidth = "70%";
      bubble.style.borderRadius = "12px";
      bubble.style.background = role === "user" ? "#e0f2fe" : "#f3f4f6";
      bubble.style.color = "#111827";

      bubble.innerHTML = text;

      if (showTimestamp) {
        const time = document.createElement("div");
        time.className = "text-[10px] text-gray-400 mt-1";
        time.textContent = formatTimestamp();
        bubble.appendChild(time);
      }

      if (showAvatars) {
        const avatar = document.createElement("img");
        avatar.src = role === "user" ? userAvatar : botAvatar;
        avatar.style.width = avatar.style.height = avatarSize + "px";
        avatar.style.borderRadius = avatarShape === "circle" ? "50%" : avatarShape === "rounded" ? "8px" : "0";
        avatar.className = "mx-2";

        if (role === "user") {
          wrapper.appendChild(bubble);
          wrapper.appendChild(avatar);
        } else {
          wrapper.appendChild(avatar);
          wrapper.appendChild(bubble);
        }
      } else {
        wrapper.appendChild(bubble);
      }

      messagesDiv.appendChild(wrapper);
      messagesDiv.scrollTop = messagesDiv.scrollHeight;
    };

    const showTyping = () => {
      if (!typingIndicator) return;
      const loading = document.createElement("div");
      loading.className = "text-gray-400 text-xs italic";
      loading.id = "typing";
      loading.textContent = "Typing...";
      messagesDiv.appendChild(loading);
    };

    const removeTyping = () => {
      const typing = document.getElementById("typing");
      if (typing) typing.remove();
    };

    sendButton.onclick = async () => {
      const message = input.value.trim();
      if (!message) return;

      createBubble("user", message);
      chatHistory.push({ role: "user", parts: [{ text: message }] });
      input.value = "";

      showTyping();

      try {
        const res = await fetch("http://localhost:5000/api/chatbot/ask", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKey
          },
          body: JSON.stringify({ message, chatHistory })
        });

        const data = await res.json();
        removeTyping();

        if (data.success) {
          const reply = data.reply;
          chatHistory.push({ role: "model", parts: [{ text: reply }] });
          createBubble("model", reply);
        } else {
          createBubble("model", "Bot error: " + (data.error || "Unknown"));
        }
      } catch (e) {
        removeTyping();
        createBubble("model", "Network error.");
      }
    };

    input.addEventListener("keypress", function (e) {
      if (e.key === "Enter") sendButton.click();
    });
  </script>
</body>
</html>
`;

  res.setHeader("Content-Type", "text/html");
  res.send(html);
});

export default router;
