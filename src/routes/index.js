const authRoutes = require("./authRoutes");
const userRoutes = require("./userRoutes");
const journalRoutes = require("./journalRoutes");
const ruleRoutes = require("./ruleRoutes");
const tradeRoutes = require("./tradeRoutes");
const metricsRoutes = require("./metricsRoutes");
const accountabilityPartnerRoutes = require("./accountabilityPartnerRoutes");
const adminRoutes = require("./adminRoutes");
const announcementRoutes = require("./announcementRoutes");
const paymentRoutes = require("./paymentRoutes");
const planRoutes = require("./planRoutes");
const couponRoutes = require("./couponRoutes");

module.exports = {
  auth: authRoutes,
  user: userRoutes,
  journals: journalRoutes,
  rules: ruleRoutes,
  trades: tradeRoutes,
  metrics: metricsRoutes,
  "accountability-partner": accountabilityPartnerRoutes,
  admin: adminRoutes,
  announcement: announcementRoutes,
  payment: paymentRoutes,
  plans: planRoutes,
  coupon:couponRoutes
};
