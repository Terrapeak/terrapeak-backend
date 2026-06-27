import mongoose from "mongoose";
import crypto from "crypto";

const ChatbotSettingsSchema = new mongoose.Schema(
  {
    brandName: {
  type: String,
  default: "Terrapeak",
},
reservationBusinessSlug: {
  type: String,
  default: "",
},
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    googleApiKey: { type: String },
    apiKey: {
      type: String,
      unique: true,
      default: () => crypto.randomBytes(16).toString("hex"),
    },
    allowedDomains: {
      type: [String],
      default: [],
      validate: {
        validator: function (domains) {
          return domains.every((domain) =>
            /^(localhost(:\d+)?|(\d{1,3}\.){3}\d{1,3}(:\d+)?|([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,})(:\d+)?$/.test(
              domain.replace(/^https?:\/\//, "")
            )
          );
        },
        message: "Invalid domain format",
      },
    },

    botName: { type: String, default: "" },
    welcomeMessage: { type: String, default: "" },
    language: { type: String, default: "en" },
    onlineMessage: { type: String, default: "" },
    offlineMessage: {
      type: String,
      default: ".",
    },

    themeColor: { type: String, default: "#2563eb" },
    accentColor: { type: String, default: "#38bdf8" },
    textColor: { type: String, default: "#ffffff" },
    font: {
      type: String,
      default: "Inter",
      enum: ["Arial", "Roboto", "Inter", "Poppins", "Georgia", "Courier New"],
    },
    fontSize: { type: String, default: "16" },
    backgroundColor: { type: String, default: "#f3f4f6" },
    bgImage: { type: String, default: "" },
    bgImageWidth: { type: String },
    bgImageHeight: { type: String },
    messageAlign: {
      type: String,
      default: "left",
      enum: ["left", "center", "right"],
    },
    messageStyle: {
      type: String,
      default: "bubble",
      enum: ["bubble", "square", "rounded", "glass"],
    },
    avatarShape: {
      type: String,
      default: "circle",
      enum: ["circle", "square", "rounded"],
    },
    avatarSize: { type: String, default: "40" },
    botAvatar: {
      type: String,
      default:
        "https://img.freepik.com/free-vector/graident-ai-robot-vectorart_78370-4114.jpg?semt=ais_hybrid&w=740",
    },
    userAvatar: {
      type: String,
      default: "https://cdn.getmerlin.in/cms/pfp1_fe1e0a17e8.jpg",
    },
    showUserAvatar: { type: Boolean, default: true },
    showBotAvatar: { type: Boolean, default: true },
    enableGradient: { type: Boolean, default: false },
    chatDirection: {
      type: String,
      default: "bottom-to-top",
      enum: ["top-to-bottom", "bottom-to-top"],
    },

    // Backward-compatible width/height
    width: { type: String, default: "400px" },
    height: { type: String, default: "500px" },

    // Responsive device sizes
    deviceSizes: {
      small: {
        width: { type: String, default: "90%" },
        height: { type: String, default: "400px" },
      },
      medium: {
        width: { type: String, default: "70%" },
        height: { type: String, default: "500px" },
      },
      large: {
        width: { type: String, default: "400px" },
        height: { type: String, default: "600px" },
      },
    },

    borderRadius: { type: String, default: "16" },
    boxShadow: { type: Boolean, default: true },
    position: {
      type: String,
      default: "bottom-right",
      enum: ["bottom-right", "bottom-left", "top-right", "top-left"],
    },

    sendButtonLabel: { type: String, default: "Send" },
    sendButtonIcon: { type: String, default: "" },
    showTimestamp: { type: Boolean, default: true },
    typingIndicator: { type: Boolean, default: true },
    messageDelay: { type: Number, default: 300 },
    typingSpeed: { type: Number, default: 20 },
    soundOnMessage: { type: Boolean, default: false },
    voiceGender: {
      type: String,
      default: "Microsoft David - English (United States)",
    },
    autoScroll: { type: Boolean, default: true },
    animations: { type: Boolean, default: true },
    fileUpload: { type: Boolean, default: false },

    allowEmojis: { type: Boolean, default: true },
    allowMarkdown: { type: Boolean, default: true },
    fullscreen: { type: Boolean, default: false },
    systemInstruction: {
      type: String,
      default:
        "You are a helpful chatbot assistant. Provide accurate and concise responses.",
    },
    systemInstructionFileText1: {
      Name: { type: String, default: "" },
      FileText: { type: String, default: "" },
      setFile: { type: Boolean, default: false },
    },
    systemInstructionFileText2: {
      Name: { type: String, default: "" },
      FileText: { type: String, default: "" },
      setFile: { type: Boolean, default: false },
    },

    geminiKey: String,
    gemini_model: String,

    preActivationFields: {
      type: [
        {
          name: { type: String, required: true }, // e.g., "name", "email", "phone"
          label: { type: String, required: true }, // e.g., "Your Name", "Your Email"
          type: {
            type: String,
            enum: ["text", "email", "tel", "number"],
            default: "text",
          },
          required: { type: Boolean, default: false },
          placeholder: { type: String, default: "" },
        },
      ],
      default: [],
    },
    requirePreActivation: { type: Boolean, default: false }, // Whether to prompt for info before activation
  },
  {
    timestamps: true,
  }
);

export default mongoose.model("ChatbotSettings", ChatbotSettingsSchema);
