import mongoose from "mongoose";

const FacebookPageOptionSchema = new mongoose.Schema(
  {
    pageId: { type: String, required: true, trim: true },
    pageName: { type: String, required: true, trim: true },
    pageAccessToken: { type: String, required: true },
  },
  { _id: false }
);

const FacebookChannelConfigSchema = new mongoose.Schema(
  {
    companyId: {
      type: mongoose