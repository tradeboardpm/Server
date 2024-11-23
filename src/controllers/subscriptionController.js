const User = require("../models/User");

exports.updateSubscription = async (req, res) => {
  try {
    const { subscription, validUntil } = req.body;

    req.user.subscription = subscription;
    req.user.subscriptionValidUntil = validUntil;
    await req.user.save();

    res.send(req.user);
  } catch (error) {
    res.status(400).send(error);
  }
};

exports.getSubscription = async (req, res) => {
  try {
    res.send({
      subscription: req.user.subscription,
      validUntil: req.user.subscriptionValidUntil,
    });
  } catch (error) {
    res.status(500).send();
  }
};
