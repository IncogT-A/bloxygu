const attempts = new Map();
function limitAuth(req, res, next) {
  const key = req.ip + ":" + req.path;
  const now = Date.now();
  const entry = attempts.get(key) || { count: 0, start: now };
  if (now - entry.start > 15 * 60 * 1000) { entry.count = 0; entry.start = now; }
  entry.count += 1; attempts.set(key, entry);
  if (entry.count > 12) return res.status(429).json({ error: "Too many attempts. Wait 15 minutes and try again." });
  next();
}
module.exports = { limitAuth };
