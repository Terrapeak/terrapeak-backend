import express from "express";
import cookieParser from "cookie-parser";
import mongoose from "mongoose";
import dotenv from "dotenv";
import routes from "./routes/index.js";
import swaggerRoutes from "./swagger.js";
import cors from "cors";
import ensureChannelRegistry from "./services/channelRegistryService.js";
import ensureContentStudioRegistry from "./services/contentStudioRegistryService.js";
import bootstrapStagingIdentities from "./services/stagingIdentityBootstrapService.js";
import requireTrustedCookieOrigin from "./middleware/requireTrustedCookieOrigin.js";
import configureProductionLogging from "./utils/configureProductionLogging.js";
import { startContentStudioImageLifecycleScheduler } from "./services/contentStudio/imageLifecycleSchedulerService.js";

dotenv.config();
configureProductionLogging();

const parseConfiguredOrigins = () =>
  String(process.env.FRONTEND_URLS || process.env.FRONTEND_URL || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

mongoose
  .connect(process.env.MONGO_URI, {})
  .then(async () => {
    console.log("MongoDB connected");
    await ensureChannelRegistry();
    await ensureContentStudioRegistry();
    await bootstrapStagingIdentities();
    startContentStudioImageLifecycleScheduler();
  })
  .catch((error) => console.error("MongoDB connection error:", error));

const app = express();

app.use(express.static("public"));

const productionOrigins = [
  ...parseConfiguredOrigins(),
  "https://terrapeak-gemini-assistant.vercel.app",
  "https://platform.terrapeakgroup.com",
  "https://dashboard.terrapeakgroup.com",
].filter(Boolean);

const developmentOrigins = [
  "http://localhost:5173",
  "http://localhost:5174",
  "http://localhost:5175",
];

const allowedOrigins = new Set([
  ...productionOrigins,
  ...(process.env.NODE_ENV === "production" ? [] : developmentOrigins),
]);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.has(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  }),
);

app.use(
  express.json({
    limit: "1mb",
    verify(req, res, buffer) {
      if (req.originalUrl?.split("?")[0] === "/api/facebook/webhook") {
        req.rawBody = Buffer.from(buffer);
      }
    },
  }),
);
app.use(cookieParser());
app.use(requireTrustedCookieOrigin);

app.use("/api/", routes);
app.use("/api", swaggerRoutes);

app.use((err, req, res, next) => {
  const isMulterError = err?.name === "MulterError";
  const explicitStatus = Number(err?.statusCode || err?.status);
  const statusCode = isMulterError
    ? 400
    : Number.isInteger(explicitStatus) && explicitStatus >= 400 && explicitStatus < 600
      ? explicitStatus
      : 500;

  console.error(err?.stack || err);

  const isExpectedClientError = statusCode >= 400 && statusCode < 500;
  const message = isMulterError
    ? err.code === "LIMIT_FILE_SIZE"
      ? "The uploaded file is too large."
      : "The uploaded file could not be accepted."
    : isExpectedClientError && err?.message
      ? err.message
      : "An unexpected error occurred.";

  res.status(statusCode).json({
    success: false,
    message,
  });
});

const port = process.env.PORT || 5000;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
