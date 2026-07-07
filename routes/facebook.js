import express from "express";

const router = express.Router();

// Facebook webhook verification
// Meta calls this route when you connect the webhook in the Meta Developer Console.
router.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === process.env.FB_VERIFY_TOKEN) {
    console.log("Facebook webhook verified successfully");
    return res.status(200).send(challenge);
  }

  console.warn("Facebook webhook verification failed");
  return res.sendStatus(403);
});

// Facebook incoming messages
// For now this only confirms that the backend received the message.
// In the next step we will connect this to the existing chatbot logic.
router.post("/webhook", (req, res) => {
  console.log("Facebook webhook event received:", JSON.stringify(req.body, null, 2));
  return res.sendStatus(200);
});

export default router;
