const Announcement = require("../models/Announcement");

exports.createAnnouncement = async (req, res) => {
  try {
    const announcement = new Announcement({
      ...req.body,
      createdBy: req.admin._id,
    });
    await announcement.save();
    res.status(201).send(announcement);
  } catch (error) {
    res.status(400).send({ error: error.message });
  }
};

exports.listAnnouncements = async (req, res) => {
  try {
    const announcements = await Announcement.find().sort({ createdAt: -1 });
    res.status(200).send(announcements);
  } catch (error) {
    res.status(400).send({ error: error.message });
  }
};

exports.editAnnouncement = async (req, res) => {
  try {
    const announcement = await Announcement.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    );
    if (!announcement) {
      return res.status(404).send({ error: "Announcement not found" });
    }
    res.status(200).send(announcement);
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
    res.status(200).send({ message: "Announcement deleted successfully" });
  } catch (error) {
    res.status(400).send({ error: error.message });
  }
};

exports.toggleAnnouncement = async (req, res) => {
  try {
    const announcement = await Announcement.findById(req.params.id);
    if (!announcement) {
      return res.status(404).send({ error: "Announcement not found" });
    }
    announcement.isActive = !announcement.isActive;
    await announcement.save();
    res.status(200).send(announcement);
  } catch (error) {
    res.status(400).send({ error: error.message });
  }
};
