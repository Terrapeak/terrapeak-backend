import express from "express";
import axios from "axios";

const router = express.Router();

async function sendFacebookMessage(recipientId, text) {
  if (!process.env.FB_PAGE_ACCESS_TOKEN) {
    console.error("FB_PAGE_ACCESS_TOKEN is missing in Railway variables");
    return;
  }

  await axios.post(
    `https://graph.facebook.com/v22.0/me/messages?access_token=${process.env.FB_PAGE_ACCESS_TOKEN}`,
    {
      recipient: { id: recipientId },
      message: { text },
    }
  );
}

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
// This first version sends a simple fixed test reply.
// After this works, we will connect it to the existing TerraPeak chatbot logic.
router.post("/webhook", async (req, res) => {
  res.sendStatus(200);

  try {
    const body = req.body;

    console.log("Facebook webhook POST received");
    console.log("Facebook webhook body:", JSON.stringify(body, null, 2));

    if (body.object !== "page") {
      console.log("Facebook webhook ignored because object is not page");
      return;
    }

    for (const entry of body.entry || []) {
      for (const event of entry.messaging || []) {
        const senderId = event.sender?.id;
        const messageText = event.message?.text;

        // Ignore events without a sender or text message.
        // This avoids replying to delivery receipts, echoes, attachments, etc.
        if (!senderId || !messageText) {
          continue;
        }

        console.log("Facebook message received from:", senderId);
        console.log("Facebook message text:", messageText);

        await sendFacebookMessage(
          senderId,
          "Hi, this is TerraPeak AI. I received your message."
        );
      }
    }
  } catch (error) {
    console.error(
      "Facebook webhook processing error:",
      error.response?.data || error.message
    );
  }
});

export default router;
