import mongoose from "mongoose";

const WebsiteInfoSchema = new mongoose.Schema({
  apiKey: { type: String, required: true, index: true },
  info: { type: String, default: "" },   // long text / FAQs / policies
  updatedAt: { type: Date, default: Date.now },
});

export default mongoose.model("WebsiteInfo", WebsiteInfoSchema);
