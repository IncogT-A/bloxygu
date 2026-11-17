const express = require("express");
const router = express.Router();
router.get("/api/health", (req, res) => res.json({ ok: true, service: "bloxygu", time: new Date().toISOString() }));
module.exports = router;
