require("dotenv").config();

const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const helmet = require("helmet");
const compression = require("compression");

const validateEnv = require("./src/middleware/validateEnv");
const errorHandler = require("./src/middleware/errorHandler");
const connectDB = require("./src/config/database");
const routes = require("./src/routes");
const healthCheck = require("./src/utils/healthCheck");

validateEnv(["PORT", "MONGODB_URI", "JWT_SECRET", "ALLOWED_ORIGINS"]);

const app = express();

const corsOptions = {
  origin: (origin, callback) => {
    const allowedOrigins = [
      "http://localhost:3000",
      "http://localhost:3001",
      "https://test.tradeboard.in",
      "https://www.tradeboard.in",
      "https://tb-admin-01.vercel.app"
    ];
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true,
  optionsSuccessStatus: 200,
  maxAge: 86400,
};

// const limiter = rateLimit({
//   windowMs: 15 * 60 * 1000,
//   max: 100,
//   message: "Too many requests from this IP, please try again later.",
// });

app.use(helmet());
app.use(compression());
// app.use(morgan("combined"));
app.use(cors(corsOptions));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
// app.use(limiter);

app.get("/health", healthCheck);
app.get("/api/get-key", (req, res) => {
  res.status(200).json({ key: process.env.KEY_ID })
})

Object.entries(routes).forEach(([name, router]) => {
  app.use(`/api/${name}`, router);
});

app.use(errorHandler);

app.use((req, res) => {
  res.status(404).json({ error: "Not found" });
});

const PORT = process.env.PORT || 5000;
let server;


const startServer = async () => {
  try {
    await connectDB();
    console.log("Database connected successfully");

    server = app.listen(PORT, () => {
      console.info(`Server running on port ${PORT}`);

    });

    const shutdown = async (signal) => {
      console.log(`\n${signal} received. Starting graceful shutdown...`);

      server.close(async () => {
        console.log("HTTP server closed");
        try {
          await mongoose.connection.close();
          console.log("Database connection closed");
          process.exit(0);
        } catch (err) {
          console.error("Error during shutdown:", err);
          process.exit(1);
        }
      });

      setTimeout(() => {
        console.error(
          "Could not close connections in time, forcefully shutting down"
        );
        process.exit(1);
      }, 30000);
    };

    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
};

startServer();

module.exports = app;
