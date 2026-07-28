import express from "express";
import cookieParser from "cookie-parser";
import mongoose from "mongoose";
import dotenv from "dotenv";
import routes from "./routes/index.js";
import swaggerRoutes from "./swagger.js";
import cors from "cors";
import ensureChannelRegistry from "./services/channelRegistryService.js";
import configureProductionLogging from "./utils/configureProductionLogging.js";

dotenv.config();
configureProductionLogging();

// Connect to MongoDB
mongoose
  .connect(process.env.MONGO_URI, {})
  .then(async () => {
    console.log("MongoDB connected");
    await ensureChannelRegistry();
  })
  .catch((error) => console.error("MongoDB connection error:", error));

const app = express();

app.use(express.static("public"));

const productionOrigins = [
  process.env.FRONTEND_URL,
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
  })
);

// Middleware
app.use(
  express.json({
    verify(req, res, buffer) {
      if (req.originalUrl?.split("?")[0] === "/api/facebook/webhook") {
        req.rawBody = Buffer.from(buffer);
      }
    },
  })
);
app.use(cookieParser());

// Routes
app.use("/api/", routes);
app.use("/api", swaggerRoutes);

app.use((err, req, res, next) => {
  const statusCode = err.statusCode || 500;
  console.log(err.stack);
  res.status(statusCode).json({
    message: err.message || "An unexpected error occurred",
  });
});

// Start server
const port = process.env.PORT || 5000;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
