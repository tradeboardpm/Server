const mongoose = require("mongoose");
const os = require("os");

const healthCheck = async (req, res) => {
  const healthcheck = {
    uptime: process.uptime(),
    message: "OK",
    timestamp: Date.now(),
  };

  try {
    const dbState = mongoose.connection.readyState;
    switch (dbState) {
      case 0:
        healthcheck.database = "Disconnected";
        break;
      case 1:
        healthcheck.database = "Connected";
        break;
      case 2:
        healthcheck.database = "Connecting";
        break;
      case 3:
        healthcheck.database = "Disconnecting";
        break;
      default:
        healthcheck.database = "Unknown";
    }

    healthcheck.memory = {
      total: os.totalmem(),
      free: os.freemem(),
      used: os.totalmem() - os.freemem(),
      usagePercentage: (
        ((os.totalmem() - os.freemem()) / os.totalmem()) *
        100
      ).toFixed(2),
    };

    healthcheck.cpu = {
      model: os.cpus()[0].model,
      cores: os.cpus().length,
      speed: os.cpus()[0].speed,
    };

    res.status(200).json(healthcheck);
  } catch (error) {
    console.error("Health check failed:", error);
    healthcheck.message = error;
    healthcheck.error = "Health check failed";
    res.status(503).json(healthcheck);
  }
};

module.exports = healthCheck;
