import mongoose from "mongoose";

const ChatbotActionSchema = new mongoose.Schema({
  apiKey: { type: String, required: true, index: true }, // link to ChatbotSettings.apiKey
  intent: { type: String, required: true },              // "track_order"
  description: { type: String },
  keywords: { type: [String], default: [] },             // optional synonyms
  method: { type: String, required: true, enum: ["GET", "POST", "PUT", "DELETE"] },
  endpoint: { type: String, required: true },            // e.g. "/api/orders/track"
  params: { type: [String], default: [] },               // ["orderId"]
  createdAt: { type: Date, default: Date.now },
});

export default mongoose.model("ChatbotAction", ChatbotActionSchema);
