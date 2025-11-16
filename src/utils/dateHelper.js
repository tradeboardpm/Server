// utils/dateHelper.js
/**
 * Normalise any input to **00:00:00.000 IST** → UTC Date.
 * Works with string, Date, or timestamp.
 */
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000; // +05:30

const normalizeIST = (input) => {
  let d;
  if (typeof input === "string" || typeof input === "number") {
    d = new Date(input);
  } else {
    d = new Date(input);
  }

  if (Number.isNaN(d.getTime())) {
    throw new Error("Invalid date");
  }

  // 1. Convert to IST milliseconds (local + offset)
  const utcMs = d.getTime() + d.getTimezoneOffset() * 60 * 1000;
  const istMs = utcMs + IST_OFFSET_MS;

  // 2. Start of IST day
  const istDayStartMs = Math.floor(istMs / 86400000) * 86400000;

  // 3. Back to UTC
  return new Date(istDayStartMs - IST_OFFSET_MS);
};

/**
 * Format UTC Date → YYYY-MM-DD (string)
 */
const formatDate = (date) => {
  const d = new Date(date);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

module.exports = { normalizeIST, formatDate };