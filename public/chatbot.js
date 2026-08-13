(function () {
  const script = document.currentScript;
  const apiKey = script?.getAttribute("data-api-key");
  const botName = script?.getAttribute("data-bot-name") || "Assistant";
  const origin = window.location.origin;

  if (!apiKey) {
    console.error("Chatbot: API key not found in data-api-key attribute.");
    return;
  }

  const style = document.createElement("style");
  style.textContent = `
    #terrapeak-chat-launcher {
      position: fixed;
      right: 24px;
      bottom: 24px;
      z-index: 9999;
      height: 56px;
      min-width: 56px;
      padding: 0 20px 0 17px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      border: 1px solid rgba(255, 255, 255, 0.18);
      border-radius: 999px;
      background: #1D3E5E;
      color: #FFFFFF;
      box-shadow: 0 10px 28px rgba(18, 43, 65, 0.24);
      cursor: pointer;
      font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 15px;
      font-weight: 600;
      line-height: 1;
      letter-spacing: -0.01em;
      transition: transform 180ms ease, box-shadow 180ms ease, background-color 180ms ease;
      -webkit-tap-highlight-color: transparent;
    }

    #terrapeak-chat-launcher:hover {
      transform: translateY(-2px);
      background: #244B70;
      box-shadow: 0 14px 34px rgba(18, 43, 65, 0.3);
    }

    #terrapeak-chat-launcher:active {
      transform: translateY(0);
    }

    #terrapeak-chat-launcher:focus-visible,
    #terrapeak-chat-close:focus-visible {
      outline: 3px solid rgba(47, 93, 80, 0.32);
      outline-offset: 3px;
    }

    #terrapeak-chat-launcher svg {
      width: 22px;
      height: 22px;
      flex: 0 0 auto;
    }

    #terrapeak-chat-frame {
      position: fixed;
      inset: 0;
      width: 100%;
      height: 100%;
      border: 0;
      z-index: 9998;
      display: none;
      background: rgba(12, 28, 43, 0.16);
    }

    #terrapeak-chat-close {
      position: fixed;
      top: 20px;
      right: 20px;
      z-index: 10000;
      width: 44px;
      height: 44px;
      display: none;
      align-items: center;
      justify-content: center;
      border: 1px solid rgba(29, 62, 94, 0.12);
      border-radius: 50%;
      background: #FFFFFF;
      color: #1D3E5E;
      box-shadow: 0 8px 24px rgba(18, 43, 65, 0.18);
      cursor: pointer;
      transition: transform 180ms ease, box-shadow 180ms ease;
      -webkit-tap-highlight-color: transparent;
    }

    #terrapeak-chat-close:hover {
      transform: rotate(4deg) scale(1.04);
      box-shadow: 0 10px 28px rgba(18, 43, 65, 0.24);
    }

    #terrapeak-chat-close svg {
      width: 20px;
      height: 20px;
    }

    @media (max-width: 640px) {
      #terrapeak-chat-launcher {
        right: 18px;
        bottom: 18px;
        width: 56px;
        min-width: 56px;
        padding: 0;
      }

      #terrapeak-chat-launcher span {
        display: none;
      }

      #terrapeak-chat-close {
        top: 14px;
        right: 14px;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      #terrapeak-chat-launcher,
      #terrapeak-chat-close {
        transition: none;
      }
    }
  `;
  document.head.appendChild(style);

  const chatButton = document.createElement("button");
  chatButton.id = "terrapeak-chat-launcher";
  chatButton.type = "button";
  chatButton.setAttribute("aria-label", `Chat with ${botName}`);
  chatButton.setAttribute("aria-expanded", "false");
  chatButton.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M7.5 18.25 4 20l.9-3.6A7.75 7.75 0 1 1 7.5 18.25Z" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M8 11.75h8M8 8.75h5.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
    </svg>
    <span>Chat with ${botName}</span>
  `;

  const iframe = document.createElement("iframe");
  iframe.id = "terrapeak-chat-frame";
  iframe.title = `${botName} chat assistant`;
  iframe.src = `https://terrapeak-gemini-assistant.vercel.app/embed?apiKey=${encodeURIComponent(apiKey)}&parentDomain=${encodeURIComponent(origin)}`;
  iframe.setAttribute("allow", "microphone");

  const closeButton = document.createElement("button");
  closeButton.id = "terrapeak-chat-close";
  closeButton.type = "button";
  closeButton.setAttribute("aria-label", "Close chat");
  closeButton.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="m7 7 10 10M17 7 7 17" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    </svg>
  `;

  const toggleChat = (isOpen) => {
    iframe.style.display = isOpen ? "block" : "none";
    closeButton.style.display = isOpen ? "flex" : "none";
    chatButton.style.display = isOpen ? "none" : "inline-flex";
    chatButton.setAttribute("aria-expanded", String(isOpen));

    if (isOpen) {
      closeButton.focus();
    } else {
      chatButton.focus();
    }
  };

  chatButton.addEventListener("click", () => toggleChat(true));
  closeButton.addEventListener("click", () => toggleChat(false));

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && iframe.style.display === "block") {
      toggleChat(false);
    }
  });

  document.body.append(chatButton, iframe, closeButton);
})();