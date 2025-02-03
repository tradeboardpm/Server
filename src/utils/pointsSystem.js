const User = require("../models/User");
const Journal = require("../models/Journal");
const Trade = require("../models/Trade");
const RuleFollowed = require("../models/RuleFollowed");
const moment = require("moment");

async function addPointsToUser(userId, date, journalUpdate) {
  try {
    const user = await User.findById(userId);
    if (!user) {
      throw new Error("User not found");
    }

    // Ensure we're using the start of the day for consistency
    const startOfDay = moment.utc(date).startOf("day").toDate();

    // Initialize or get the existing points breakdown for the day
    if (!user.dailyPointsBreakdown) {
      user.dailyPointsBreakdown = {};
    }
    const dailyBreakdown = user.dailyPointsBreakdown[startOfDay.toISOString()] || {
      notes: false,
      mistakes: false,
      lessons: false,
      rules: false,
      trades: false,
    };

    let pointsToAdd = 0;

    // Check and update points for journal entries
    if (journalUpdate) {
      if (journalUpdate.note && !dailyBreakdown.notes) {
        dailyBreakdown.notes = true;
        pointsToAdd++;
      }
      if (journalUpdate.mistake && !dailyBreakdown.mistakes) {
        dailyBreakdown.mistakes = true;
        pointsToAdd++;
      }
      if (journalUpdate.lesson && !dailyBreakdown.lessons) {
        dailyBreakdown.lessons = true;
        pointsToAdd++;
      }
    }

    // Check for trades if not already awarded
    if (!dailyBreakdown.trades) {
      const trades = await Trade.find({
        user: userId,
        date: {
          $gte: startOfDay,
          $lte: moment.utc(startOfDay).endOf("day").toDate(),
        },
      });
      if (trades.length > 0) {
        dailyBreakdown.trades = true;
        pointsToAdd++;
      }
    }

    // Check for rules followed if not already awarded
    if (!dailyBreakdown.rules) {
      const rulesFollowed = await RuleFollowed.find({
        user: userId,
        date: {
          $gte: startOfDay,
          $lte: moment.utc(startOfDay).endOf("day").toDate(),
        },
        isFollowed: true,
      });
      if (rulesFollowed.length > 0) {
        dailyBreakdown.rules = true;
        pointsToAdd++;
      }
    }

    // Update the user's points and daily breakdown
    if (pointsToAdd > 0) {
      user.points += pointsToAdd;
      user.dailyPointsBreakdown[startOfDay.toISOString()] = dailyBreakdown;
      await user.save();

      // console.log(`Points added: ${pointsToAdd}`);
      // console.log("Updated Daily Points Breakdown:", dailyBreakdown);
    } else {
      // console.log("No new points added");
    }

    return pointsToAdd;
  } catch (error) {
    console.error("Error adding points to user:", error);
    throw error;
  }
}

module.exports = { addPointsToUser };
