const User = require("../models/User");
const Journal = require("../models/Journal");
const Trade = require("../models/Trade");
const RuleFollowed = require("../models/RuleFollowed");
const moment = require("moment");

async function addPointsToUser(userId, date) {
  try {
    const user = await User.findById(userId);
    if (!user) {
      throw new Error("User not found");
    }

    // Ensure we're using the start of the day for consistency
    const startOfDay = moment.utc(date).startOf("day").toDate();

    // Check if points have already been added for this day
    if (
      user.lastPointsUpdate &&
      moment.utc(user.lastPointsUpdate).isSame(startOfDay, "day")
    ) {
      console.log("Points already added for this day");
      return 0;
    }

    // Find entries for the specific day
    const journal = await Journal.findOne({
      user: userId,
      date: startOfDay,
    });

    const trades = await Trade.find({
      user: userId,
      date: {
        $gte: moment.utc(date).startOf("day").toDate(),
        $lte: moment.utc(date).endOf("day").toDate(),
      },
    });

    const rulesFollowed = await RuleFollowed.find({
      user: userId,
      date: {
        $gte: moment.utc(date).startOf("day").toDate(),
        $lte: moment.utc(date).endOf("day").toDate(),
      },
      isFollowed: true,
    });

    const pointsBreakdown = {
      notes: 0,
      mistakes: 0,
      lessons: 0,
      rules: 0,
      trades: 0,
    };

    let pointsToAdd = 0;

    // Points for journal entries
    if (journal) {
      // Check for notes
      if (journal.note && journal.note.trim() !== "") {
        pointsBreakdown.notes = 1;
        pointsToAdd++;
      }

      // Check for mistakes
      if (journal.mistake && journal.mistake.trim() !== "") {
        pointsBreakdown.mistakes = 1;
        pointsToAdd++;
      }

      // Check for lessons
      if (journal.lesson && journal.lesson.trim() !== "") {
        pointsBreakdown.lessons = 1;
        pointsToAdd++;
      }
    }

    // Points for trades
    if (trades && trades.length > 0) {
      pointsBreakdown.trades = 1;
      pointsToAdd++;
    }

    // Points for followed rules
    if (rulesFollowed && rulesFollowed.length > 0) {
      pointsBreakdown.rules = 1;
      pointsToAdd++;
    }

    // Limit points to a maximum of 5 per day
    pointsToAdd = Math.min(pointsToAdd, 5);

    // Update points and last points update only if points are to be added
    if (pointsToAdd > 0) {
      user.points += pointsToAdd;
      user.lastPointsUpdate = startOfDay;
      await user.save();

      console.log(`Total points added: ${pointsToAdd}`);
      console.log("Points Breakdown:", pointsBreakdown);

      return pointsToAdd;
    }

    console.log("No points added this time");
    return 0;
  } catch (error) {
    console.error("Error adding points to user:", error);
    throw error;
  }
}

module.exports = { addPointsToUser };
