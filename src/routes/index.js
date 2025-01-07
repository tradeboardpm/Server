const authRoutes = require("./authRoutes");
const userRoutes = require("./userRoutes");
const journalRoutes = require("./journalRoutes");
const ruleRoutes = require("./ruleRoutes");
const tradeRoutes = require("./tradeRoutes");
const subscriptionRoutes = require("./subscriptionRoutes");
const metricsRoutes = require("./metricsRoutes");
const accountabilityPartnerRoutes = require("./accountabilityPartnerRoutes");
const adminRoutes = require("./adminRoutes");
const announcementRoutes = require("./announcementRoutes");
const test = require("./test_trade");

module.exports = {
  auth: authRoutes,
  user: userRoutes,
  journals: journalRoutes,
  rules: ruleRoutes,
  trades: tradeRoutes,
  subscription: subscriptionRoutes,
  metrics: metricsRoutes,
  "accountability-partner": accountabilityPartnerRoutes,
  admin: adminRoutes,
  announcement: announcementRoutes,
  test: test,
};
