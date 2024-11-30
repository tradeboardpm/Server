const User = require("../models/User");
const Announcement = require("../models/Announcement");

// ... (previous code remains unchanged)

exports.getActiveAnnouncements = async (req, res) => {
  try {
    const currentDate = new Date();
    const announcements = await Announcement.find({
      isActive: true,
      expirationTime: { $gt: currentDate },
    }).sort({ priority: -1, createdAt: -1 });
    res.status(200).send(announcements);
  } catch (error) {
    res.status(400).send({ error: error.message });
  }
};

// ... (rest of the file remains unchanged)
