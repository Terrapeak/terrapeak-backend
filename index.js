import express from "express";
import cookieParser from "cookie-parser";
import mongoose from "mongoose";
import dotenv from "dotenv";
import routes from "./routes/index.js";
import widgetRoutes from "./routes/widget.js";
import swaggerRoutes from "./swagger.js";
import cors from "cors";
import path from "path";
import ensureChannelRegistry from "./services/channelRegistryService.js";

// ⬇️ Fix __dirname for ES Modules
import { fileURLToPath } from "url";
import { dirname } from "path";
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config();

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

app.use(
  cors({
    origin(origin, callback) {
      const allowed = [
        process.env.FRONTEND_URL,
        "http://localhost:5173",
        "http://localhost:5174",
        "http://localhost:5175",
      ];

      if (!origin || allowed.includes(origin)) {
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
// app.use((req, res, next) => {
//   console.log(req);
//   next();
// });
app.use("/api/", routes);
app.use("/api", swaggerRoutes);

app.use((err, req, res, next) => {
  // Use the error's status code or default to 500 (Internal Server Error)
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
