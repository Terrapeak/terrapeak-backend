import mongoose from "mongoose";

const CompanySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },

    displayName: {
      type: String,
      default: "",
    },

    referencePrefix: {
      type: String,
      default: "BOT",
    },

    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },

    reservationBusinessSlug: {
      type: String,
      default: "",
    },

    country: {
      type: String,
      default: "PH",
      uppercase: true,
      trim: true,
    },

    address: {
      type: String,
      default: "",
      trim: true,
    },

    website: {
