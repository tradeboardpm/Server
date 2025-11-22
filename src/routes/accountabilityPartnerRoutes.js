const express = require("express");
const accountabilityPartnerController = require("../controllers/accountabilityPartnerController");
const auth = require("../middleware/auth");
const apAuth = require("../middleware/apAuth"); // Middleware to verify AP token

const router = express.Router();

// =======================================================================
// USER ROUTES (require login)
// =======================================================================

// Add new accountability partner + send welcome email
router.post("/", auth, accountabilityPartnerController.addAccountabilityPartner);

// List all partners
router.get("/", auth, accountabilityPartnerController.getAccountabilityPartners);

// Update partner
router.patch("/:id", auth, accountabilityPartnerController.updateAccountabilityPartner);

// Delete partner
router.delete("/:id", auth, accountabilityPartnerController.deleteAccountabilityPartner);

// =======================================================================
// ACCOUNTABILITY PARTNER ROUTES (no login, token-based)
// =======================================================================

// Partner views shared data via link (e.g. /ap-data?token=...)
router.get(
  "/shared-data",
  apAuth,
  accountabilityPartnerController.getSharedData
);

// Partner verifies invitation
router.post(
  "/verify",
  accountabilityPartnerController.verifyAccountabilityPartner
);

module.exports = router;