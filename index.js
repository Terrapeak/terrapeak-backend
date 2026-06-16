import express from "express";
import cookieParser from "cookie-parser";
import mongoose from "mongoose";
import dotenv from "dotenv";
import routes from "./routes/index.js";
import widgetRoutes from "./routes/widget.js";
import swaggerRoutes from "./swagger.js";
import cors from "cors";
import path from "path";

// ⬇️ Fix __dirname for ES Modules
import { fileURLToPath } from "url";
import { dirname } from "path";
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config();

// Connect to MongoDB
mongoose
  .connect(process.env.MONGO_URI, {})
  .then(() => console.log("MongoDB connected"))
  .catch((error) => console.error("MongoDB connection error:", error));

const app = express();
app.use(express.static("public"));
app.use(
  cors({
    origin: [process.env.FRONTEND_URL],
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  })
);

// Middleware
app.use(express.json());
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
