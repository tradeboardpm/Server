const mongoose = require("mongoose");
const User = require("../models/User");
const Journal = require("../models/Journal");
const RuleState = require("../models/RuleState");
const Trade = require("../models/Trade");
const moment = require("moment");
const { normalizeDate } = require("./dateHelper");

const updateUserPointsForToday = async (userId, session = null) => {
  // console.log(`[POINTS] Starting updateUserPointsForToday for user ${userId}`);
  
  const today = normalizeDate(new Date()); // UTC midnight of today
  const todayStart = moment.utc().startOf("day").toDate();
  const todayEnd = moment.utc().endOf("day").toDate();

  // console.log(`[POINTS] Today's date range: ${todayStart.toISOString()} to ${todayEnd.toISOString()}`);

  // Find all documents created or updated TODAY
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

  // console.log(`[POINTS] Found ${journals.length} journals, ${ruleStates.length} rule states, ${trades.length} trades created/updated today`);

  // Group by calendar date (.date field)
  const calendarDates = new Set();
  
  journals.forEach(j => {
    if (j.date) calendarDates.add(normalizeDate(j.date).getTime());
  });
  
  ruleStates.forEach(rs => {
    if (rs.date) calendarDates.add(normalizeDate(rs.date).getTime());
  });
  
  trades.forEach(t => {
    if (t.date) calendarDates.add(normalizeDate(t.date).getTime());
  });

  // console.log(`[POINTS] Unique calendar dates touched today: ${calendarDates.size}`);

  // Check each calendar date and count individual actions
  let totalPoints = 0;

  for (const dateTimestamp of calendarDates) {
    const calendarDate = new Date(dateTimestamp);
    const calendarDateStr = calendarDate.toISOString().split('T')[0];
    
    // console.log(`[POINTS] Checking calendar date: ${calendarDateStr}`);

    // Find all data for this specific calendar date
    const journalsForDate = journals.filter(j => 
      j.date && normalizeDate(j.date).getTime() === dateTimestamp
    );
    
    const ruleStatesForDate = ruleStates.filter(rs => 
      rs.date && normalizeDate(rs.date).getTime() === dateTimestamp
    );
    
    const tradesForDate = trades.filter(t => 
      t.date && normalizeDate(t.date).getTime() === dateTimestamp
    );

    // Count points for each action (1 point each)
    let datePoints = 0;
    
    if (journalsForDate.some(j => j.note?.trim())) {
      datePoints += 1;
      // console.log(`[POINTS]   ${calendarDateStr} - Note: +1 point`);
    }
    
    if (journalsForDate.some(j => j.mistake?.trim())) {
      datePoints += 1;
      // console.log(`[POINTS]   ${calendarDateStr} - Mistake: +1 point`);
    }
    
    if (journalsForDate.some(j => j.lesson?.trim())) {
      datePoints += 1;
      // console.log(`[POINTS]   ${calendarDateStr} - Lesson: +1 point`);
    }
    
    if (ruleStatesForDate.some(rs => rs.isFollowed)) {
      datePoints += 1;
      // console.log(`[POINTS]   ${calendarDateStr} - Rule followed: +1 point`);
    }
    
    if (tradesForDate.length > 0) {
      datePoints += 1;
      // console.log(`[POINTS]   ${calendarDateStr} - Trade(s): +1 point`);
    }

    // console.log(`[POINTS]   ${calendarDateStr} total: ${datePoints} points`);
    totalPoints += datePoints;
  }

  // console.log(`[POINTS] Total points from all dates: ${totalPoints}`);

  // Update user points
  const user = await User.findById(userId).session(session);
  const pointsEntry = user.pointsHistory.find(
    (entry) => entry.date.getTime() === today.getTime()
  );

  let pointsChange = 0;
  if (pointsEntry) {
    // Replace previous points for today with new calculation
    pointsChange = totalPoints - pointsEntry.pointsChange;
    // console.log(`[POINTS] Updating existing entry: previous=${pointsEntry.pointsChange}, new=${totalPoints}, change=${pointsChange}`);
    pointsEntry.pointsChange = totalPoints;
  } else {
    // Create new entry for today
    pointsChange = totalPoints;
    // console.log(`[POINTS] Creating new entry: points=${totalPoints}`);
    user.pointsHistory.push({ date: today, pointsChange: totalPoints });
  }

  user.points += pointsChange;
  // console.log(`[POINTS] User total points updated: ${user.points - pointsChange} → ${user.points} (${pointsChange >= 0 ? '+' : ''}${pointsChange})`);
  
  await user.save({ session });

  // console.log(`[POINTS] ✓ Complete - awarded ${pointsChange} points`);
  return pointsChange;
};

module.exports = { updateUserPointsForToday, normalizeDate };