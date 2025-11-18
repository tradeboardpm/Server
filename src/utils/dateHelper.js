// utils/dateHelper.js
const moment = require("moment");

const normalizeDate = (input) => {
  return moment.utc(input).startOf("day").toDate();
};

const formatDate = (date) => moment.utc(date).format("YYYY-MM-DD");

module.exports = { normalizeDate, formatDate };