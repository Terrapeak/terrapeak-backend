import {
  processFacebookWebhookPayload,
  verifyFacebookWebhookSignature,
  verifyFacebookWebhookToken,
} from "../services/facebookWebhookService.js";

export const verifyFacebookWebhook = (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (
    mode === "subscribe" &&
    typeof token === "string" &&
    typeof challenge === "string" &&
    verifyFacebookWebhookToken(token)
  ) {
    return res.status(200).send(challenge);
  }

  console.warn("Facebook webhook verification rejected.");
  return res.sendStatus(403);
};

export const receiveFacebookWebhook = (req, res) => {
  const signature = req.get("x-hub-signature-256");

  if (
    !verifyFacebookWebhookSignature({
      rawBody: req.rawBody,
      signature,
    })
  ) {
    console.warn("Facebook webhook rejected because its signature was invalid.");
    return res.sendStatus(401);
  }

  res.sendStatus(200);

  void processFacebookWebhookPayload(req.body).catch((error) => {
    console.error("Facebook webhook processing failed:", error.message);
  });
};
