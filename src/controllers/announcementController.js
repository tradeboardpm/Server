const Announcement = require("../models/Announcement");
const AnnouncementView = require("../models/AnnouncementView");
const moment = require("moment");
const User = require("../models/User");

exports.createAnnouncement = async (req, res) => {
  try {
    const announcement = new Announcement(req.body);
    await announcement.save();
    res.status(201).send(announcement);
  } catch (error) {
    res.status(400).send({ error: error.message });
  }
};

exports.getAnnouncements = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const announcements = await Announcement.find({})
      .skip(skip)
      .limit(limit);

    const total = await Announcement.countDocuments();
    
    const announcementsWithViews = await Promise.all(
      announcements.map(async (announcement) => {
        const viewCount = await calculateAnnouncementViews(announcement._id);
        return {
          ...announcement.toObject(),
          viewCount,
        };
      })
    );

    res.status(200).send({
      announcements: announcementsWithViews,
      total,
      page,
      pages: Math.ceil(total / limit)
    });
  } catch (error) {
    res.status(400).send({ error: error.message });
  }
};

exports.getAnnouncementById = async (req, res) => {
  try {
    const announcement = await Announcement.findById(req.params.id);
    if (!announcement) {
      return res.status(404).send({ error: "Announcement not found" });
    }
    const viewCount = await calculateAnnouncementViews(announcement._id);
    res.status(200).send({
      ...announcement.toObject(),
      viewCount,
    });
  } catch (error) {
    res.status(400).send({ error: error.message });
  }
};

exports.updateAnnouncement = async (req, res) => {
  const updates = Object.keys(req.body);
  const allowedUpdates = [
    "type",
    "title",
    "content",
    "validFrom",
    "validUntil",
    "visibility",
    "isActive",
  ];
  const isValidOperation = updates.every((update) =>
    allowedUpdates.includes(update)
  );

  if (!isValidOperation) {
    return res.status(400).send({ error: "Invalid updates!" });
  }

  try {
    const announcement = await Announcement.findById(req.params.id);
    if (!announcement) {
      return res.status(404).send({ error: "Announcement not found" });
    }

    updates.forEach((update) => (announcement[update] = req.body[update]));
    await announcement.save();

    res.send(announcement);
  } catch (error) {
    res.status(400).send({ error: error.message });
  }
};

exports.deleteAnnouncement = async (req, res) => {
  try {
    const announcement = await Announcement.findByIdAndDelete(req.params.id);
    if (!announcement) {
      return res.status(404).send({ error: "Announcement not found" });
    }
    res.send({ message: "Announcement deleted successfully" });
  } catch (error) {
    res.status(500).send({ error: error.message });
  }
};

exports.getActiveAnnouncementsForUser = async (req, res) => {
  try {
    const now = new Date();

    const activeAnnouncements = await Announcement.find({
      isActive: true,
      validFrom: { $lte: now },
      validUntil: { $gte: now },
    });

    const userId = req.user._id;
    const userViews = await AnnouncementView.find({ userId });

    const filteredAnnouncements = activeAnnouncements.filter((announcement) => {
      const userView = userViews.find((view) =>
        view.announcementId.equals(announcement._id)
      );

      if (!userView) return true;

      switch (announcement.visibility) {
        case "once":
          return false;
        case "daily":
          return moment(userView.viewedAt).isBefore(moment(now), "day");
        case "always":
          return true;
        default:
          return false;
      }
    });

    res.status(200).send(filteredAnnouncements);
  } catch (error) {
    res.status(400).send({ error: error.message });
  }
};

const calculateAnnouncementViews = async (announcementId) => {
  const views = await AnnouncementView.countDocuments({ announcementId });
  return views;
};

exports.viewAnnouncement = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;

    const announcement = await Announcement.findById(id);
    if (!announcement) {
      return res.status(404).send({ error: "Announcement not found" });
    }

    const now = new Date();
    if (
      now < announcement.validFrom ||
      now > announcement.validUntil ||
      !announcement.isActive
    ) {
      return res
        .status(400)
        .send({ error: "Announcement is not currently active" });
    }

    const view = new AnnouncementView({
      announcementId: id,
      userId: userId,
    });
    await view.save();

    res.status(200).send({ message: "Announcement viewed successfully" });
  } catch (error) {
    res.status(400).send({ error: error.message });
  }
};