// (function () {
//   const script = document.currentScript;
//   const apiKey = script.getAttribute("data-api-key");

//   if (!apiKey) {
//     return console.error("Chatbot: API key not found in data-api-key attribute.");
//   }

//   // Fetch chatbot settings from backend
//   fetch("http://localhost:5000/api/chatbot/settings?apiKey=" + apiKey)
//     .then((res) => res.json())
//     .then((data) => {
//       if (!data.success || !data.data) throw new Error("Invalid API key");

//       const settings = data.data;

//       // Create and apply dynamic iframe
//       const iframe = document.createElement("iframe");
//       iframe.src = "http://localhost:5000/chatbot/widget?apiKey=" + apiKey;
//       iframe.style.position = "fixed";

//       const position = settings.position || "bottom-right";
//       const [vertical, horizontal] = position.split("-");

//       iframe.style[vertical] = "20px";
//       iframe.style[horizontal] = "20px";
//       iframe.style.width = settings.width ? settings.width + "px" : "400px";
//       iframe.style.height = settings.height ? settings.height + "px" : "500px";
//       iframe.style.border = "none";
//       iframe.style.borderRadius = settings.borderRadius + "px";
//       iframe.style.boxShadow = settings.boxShadow
//         ? "0 10px 20px rgba(0,0,0,0.2)"
//         : "none";
//       iframe.style.zIndex = "9999";

//       document.body.appendChild(iframe);
//     })
//     .catch((err) => {
//       console.error("Chatbot error:", err.message);
//     });
// })();

(function () {
  console.log("script");
  const script = document.currentScript;
  console.log(script, "hlo");
  const apiKey = script.getAttribute("data-api-key");
  const origin = window.location.origin;

  if (!apiKey) {
    return console.error(
      "Chatbot: API key not found in data-api-key attribute."
    );
  }
  // Helper to apply CSS styles
  const css = (el, styles) => Object.assign(el.style, styles);

  // --- Create Chat Button ---
  const chatButton = document.createElement("button");
  chatButton.textContent = "💬";
  chatButton.setAttribute("aria-label", "Open Chat");
  css(chatButton, {
    position: "fixed",
    bottom: "20px",
    right: "20px",
    zIndex: "9999",
    width: "50px",
    height: "50px",
    background: "linear-gradient(135deg, #3b82f6, #1e40af)",
    color: "white",
    border: "none",
    borderRadius: "50%",
    cursor: "pointer",
    fontSize: "24px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    boxShadow: "0 4px 12px rgba(0, 0, 0, 0.15)",
    transition: "transform 0.2s ease",
  });

  // --- Create Iframe ---
  const iframe = document.createElement("iframe");
  // The API key and base URL are now directly embedded in the downloaded script
 iframe.src = `https://terrapeak-gemini-assistant.vercel.app/embed?apiKey=${apiKey}&parentDomain=${encodeURIComponent(origin)}`;
  // iframe.src = `http://localhost:5173/embed?apiKey=${apiKey}&parentDomain=${origin}`;

  css(iframe, {
    position: "fixed",
    top: "0",
    left: "0",
    width: "100%",
    height: "100%",
    border: "none",
    zIndex: "9998",
    display: "none",
    backgroundColor: "rgba(0, 0, 0, 0.1)",
  });

  // --- Create Close Button ---
  const closeButton = document.createElement("button");
  closeButton.textContent = "✖";
  closeButton.setAttribute("aria-label", "Close Chat");
  css(closeButton, {
    position: "fixed",
    top: "20px",
    right: "20px",
    zIndex: "10000",
    width: "40px",
    height: "40px",
    background: "#fff",
    color: "#333",
    border: "1px solid #ccc",
    borderRadius: "50%",
    cursor: "pointer",
    fontSize: "20px",
    display: "none",
    alignItems: "center",
    justifyContent: "center",
    boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
  });

  // --- Event Handlers ---
  const toggleChat = (isOpen) => {
    iframe.style.display = isOpen ? "block" : "none";
    closeButton.style.display = isOpen ? "flex" : "none";
    chatButton.style.display = isOpen ? "none" : "flex";
  };

  chatButton.onclick = () => toggleChat(true);
  closeButton.onclick = () => toggleChat(false);

  document.body.append(chatButton, iframe, closeButton);
})();
