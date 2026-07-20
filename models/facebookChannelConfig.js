import mongoose from "mongoose";

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
    },
    pageId: {
      type: String,
