const mongoose = require("mongoose");
const User = require("../models/User");
const Journal = require("../models/Journal");
const RuleState = require("../models/RuleState");
const Trade = require("../models/Trade");
const moment = require("moment");

const normalizeDate = (date) => {
  const utcDate = new Date(date);
  utcDate.setUTCHours(0, 0, 0, 0);
  return utcDate;
};

// Updated to award points only for actions taken today
const updateUserPointsForActionToday = async (userId, actionDate, session = null) => {
  const today = normalizeDate(new Date()); // Current date: March 15, 2025
  const actionUtcDate = normalizeDate(actionDate);

  // Only award points if the action is performed today
  if (actionUtcDate.getTime() !== today.getTime()) {
    return 0; // No points for past/future action dates
  }

  // Fetch all actions performed today
  const [journals, ruleStates, trades] = await Promise.all([
    Journal.find({ user: userId, date: { $gte: today, $lt: moment(today).add(1, "day") } }).session(session),
    RuleState.find({ user: userId, date: { $gte: today, $lt: moment(today).add(1, "day") }, isActive: true }).session(session),
    Trade.find({ user: userId, date: { $gte: today, $lt: moment(today).add(1, "day") } }).session(session),
  ]);

  // Calculate points based on actions TODAY
  let newPoints = 0;
  if (journals.some(j => j.note?.trim())) newPoints += 1; // 1 point for any note today
  if (journals.some(j => j.mistake?.trim())) newPoints += 1; // 1 point for any mistake today
  if (journals.some(j => j.lesson?.trim())) newPoints += 1; // 1 point for any lesson today
  if (ruleStates.some(rs => rs.isFollowed)) newPoints += 1; // 1 point if any rule followed today
  if (trades.length > 0) newPoints += 1; // 1 point for any trade today

  // Cap at 5 points
  newPoints = Math.min(newPoints, 5);

  // Update user points
  const user = await User.findById(userId).session(session);
  const pointsEntry = user.pointsHistory.find(
    (entry) => entry.date.getTime() === today.getTime()
  );

  let pointsChange = 0;
  if (pointsEntry) {
    pointsChange = newPoints - pointsEntry.pointsChange; // Adjust based on previous points
    pointsEntry.pointsChange = newPoints;
  } else {
    pointsChange = newPoints;
    user.pointsHistory.push({ date: today, pointsChange: newPoints });
  }

  user.points += pointsChange;
  await user.save({ session });

  return pointsChange;
};

module.exports = { updateUserPointsForActionToday, normalizeDate };