import express from "express";
import {
  receiveFacebookWebhook,
  verifyFacebookWebhook,
} from "../controllers/facebookWebhookController.js";

const router = express.Router();

router.get("/webhook", verifyFacebookWebhook);
router.post("/webhook", receiveFacebookWebhook);

export default router;
