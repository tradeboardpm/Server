const authRoutes = require("./authRoutes");
const userRoutes = require("./userRoutes");
const journalRoutes = require("./journalRoutes");
const ruleRoutes = require("./ruleRoutes");
const tradeRoutes = require("./tradeRoutes");
const capitalRoutes = require("./capitalRoutes");
const subscriptionRoutes = require("./subscriptionRoutes");
const metricsRoutes = require("./metricsRoutes");
const accountabilityPartnerRoutes = require("./accountabilityPartnerRoutes");
const adminRoutes = require("./adminRoutes");

module.exports = {
  auth: authRoutes,
  user: userRoutes,
  journals: journalRoutes,
  rules: ruleRoutes,
  trades: tradeRoutes,
  capital: capitalRoutes,
  subscription: subscriptionRoutes,
  metrics: metricsRoutes,
  accountabilityPartner: accountabilityPartnerRoutes,
  admin: adminRoutes,
};
