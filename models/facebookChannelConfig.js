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
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
      unique: true,
      index: true,
    },
    appInstallationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "CompanyAppInstallation",
      default: null,
    },
    connectionStatus: {
      type: String,
      enum: ["not_connected", "connecting", "connected", "error"],
      default: "not_connected",