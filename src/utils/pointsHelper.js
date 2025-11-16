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

// Updated to award points based on actions performed today (ignoring entry dates)
const updateUserPointsForToday = async (userId, session = null) => {
  const todayStart = moment.utc().startOf("day").toDate();
  const todayEnd = moment.utc().endOf("day").toDate();
  const today = normalizeDate(new Date());

  const query = {
    user: userId,
    $or: [
      { createdAt: { $gte: todayStart, $lte: todayEnd } },
      { updatedAt: { $gte: todayStart, $lte: todayEnd } },
    ],
  };

  const [journals, ruleStates, trades] = await Promise.all([
    Journal.find(query).session(session),
    RuleState.find({ ...query, isActive: true }).session(session),
    Trade.find(query).session(session),
  ]);

  // Calculate points based on actions performed TODAY (via timestamps)
  let newPoints = 0;
  if (journals.some(j => j.note?.trim())) newPoints += 1; // 1 point if any note was added/updated today
  if (journals.some(j => j.mistake?.trim())) newPoints += 1; // 1 point if any mistake was added/updated today
  if (journals.some(j => j.lesson?.trim())) newPoints += 1; // 1 point if any lesson was added/updated today
  if (ruleStates.some(rs => rs.isFollowed)) newPoints += 1; // 1 point if any rule was marked followed today
  if (trades.length > 0) newPoints += 1; // 1 point if any trade was added/updated today

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

module.exports = { updateUserPointsForToday, normalizeDate };