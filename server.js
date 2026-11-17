const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, "data");
const DB_FILE = path.join(DATA_DIR, "db.json");

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, JSON.stringify({ users: [], transactions: [], requests: [] }, null, 2));

function readDB() {
  try { return JSON.parse(fs.readFileSync(DB_FILE, "utf8")); }
  catch { return { users: [], transactions: [], requests: [] }; }
}
function writeDB(db) { fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2)); }
function cleanUser(user) {
  return { id: user.id, username: user.username, credits: user.credits, roblox: user.roblox || "", createdAt: user.createdAt };
}
function auth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: "Please log in first." });
  const db = readDB();
  const user = db.users.find(u => u.id === req.session.userId);
  if (!user) { req.session.destroy(() => {}); return res.status(401).json({ error: "Session expired. Log in again." }); }
  req.user = user;
  req.db = db;
  next();
}
function transaction(db, user, type, amount, note) {
  db.transactions.unshift({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7), userId: user.id, username: user.username, type, amount, note, createdAt: new Date().toISOString() });
  db.transactions = db.transactions.slice(0, 2000);
}

app.use(express.json({ limit: "1mb" }));
app.use(session({
  name: "bloxygu.sid",
  secret: process.env.SESSION_SECRET || "change-this-before-production-bloxygu",
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 7 * 24 * 60 * 60 * 1000 }
}));
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/me", (req, res) => {
  if (!req.session.userId) return res.json({ user: null });
  const db = readDB();
  const user = db.users.find(u => u.id === req.session.userId);
  res.json({ user: user ? cleanUser(user) : null });
});

app.post("/api/register", async (req, res) => {
  const username = String(req.body.username || "").trim();
  const password = String(req.body.password || "");
  if (!/^[a-zA-Z0-9_]{3,18}$/.test(username)) return res.status(400).json({ error: "Username must be 3–18 letters, numbers or underscores." });
  if (password.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters." });
  const db = readDB();
  if (db.users.some(u => u.username.toLowerCase() === username.toLowerCase())) return res.status(409).json({ error: "That username is already taken." });
  const user = { id: require("crypto").randomUUID(), username, passwordHash: await bcrypt.hash(password, 12), credits: 25000, roblox: "", lastDaily: null, createdAt: new Date().toISOString() };
  db.users.push(user);
  transaction(db, user, "bonus", 25000, "Welcome bonus — demo credits");
  writeDB(db);
  req.session.userId = user.id;
  res.json({ user: cleanUser(user) });
});

app.post("/api/login", async (req, res) => {
  const username = String(req.body.username || "").trim();
  const password = String(req.body.password || "");
  const db = readDB();
  const user = db.users.find(u => u.username.toLowerCase() === username.toLowerCase());
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) return res.status(401).json({ error: "Incorrect username or password." });
  req.session.userId = user.id;
  res.json({ user: cleanUser(user) });
});

app.post("/api/logout", (req, res) => req.session.destroy(() => res.json({ ok: true })));

app.post("/api/daily", auth, (req, res) => {
  const now = Date.now();
  if (req.user.lastDaily && now - new Date(req.user.lastDaily).getTime() < 20 * 60 * 60 * 1000) return res.status(429).json({ error: "Your daily bonus is still cooling down." });
  req.user.credits += 1000;
  req.user.lastDaily = new Date(now).toISOString();
  transaction(req.db, req.user, "daily", 1000, "Daily demo credit bonus");
  writeDB(req.db);
  res.json({ user: cleanUser(req.user) });
});

app.get("/api/transactions", auth, (req, res) => {
  res.json({ transactions: req.db.transactions.filter(t => t.userId === req.user.id).slice(0, 50) });
});

app.post("/api/profile", auth, (req, res) => {
  const roblox = String(req.body.roblox || "").trim().slice(0, 20);
  req.user.roblox = roblox;
  writeDB(req.db);
  res.json({ user: cleanUser(req.user), note: "Roblox username saved. This does not verify account ownership." });
});

app.get("/api/leaderboard", (req, res) => {
  const db = readDB();
  res.json({ users: db.users.slice().sort((a, b) => b.credits - a.credits).slice(0, 10).map(u => ({ username: u.username, credits: u.credits })) });
});

app.post("/api/game", auth, (req, res) => {
  const game = String(req.body.game || "");
  const bet = Math.floor(Number(req.body.bet));
  if (!Number.isFinite(bet) || bet < 10 || bet > 5000) return res.status(400).json({ error: "Bet must be between 10 and 5,000 demo credits." });
  if (req.user.credits < bet) return res.status(400).json({ error: "Not enough demo credits." });

  let win = false, payout = 0, result = {};
  if (game === "dice") {
    const colors = ["red", "blue", "green", "purple"];
    const choice = String(req.body.choice || "");
    if (!colors.includes(choice)) return res.status(400).json({ error: "Choose a valid dice color." });
    const landed = colors[Math.floor(Math.random() * colors.length)];
    win = landed === choice;
    payout = win ? bet * 3 : 0;
    result = { landed, choice, multiplier: 3 };
  } else if (game === "coinflip") {
    const choice = String(req.body.choice || "");
    if (!["heads", "tails"].includes(choice)) return res.status(400).json({ error: "Choose heads or tails." });
    const landed = Math.random() < 0.5 ? "heads" : "tails";
    win = landed === choice;
    payout = win ? bet * 2 : 0;
    result = { landed, choice, multiplier: 2 };
  } else if (game === "mines") {
    const mines = Math.max(1, Math.min(20, Math.floor(Number(req.body.mines) || 3)));
    const pick = Math.floor(Math.random() * 25);
    win = pick >= mines;
    payout = win ? Math.floor(bet * (1 + mines / 10)) : 0;
    result = { pick, mines, multiplier: win ? (1 + mines / 10) : 0 };
  } else if (game === "upgrader") {
    const target = Number(req.body.target);
    if (!Number.isFinite(target) || target < 1.1 || target > 10) return res.status(400).json({ error: "Multiplier must be between 1.1x and 10x." });
    win = Math.random() < (0.96 / target);
    payout = win ? Math.floor(bet * target) : 0;
    result = { target, chance: (0.96 / target * 100).toFixed(1) };
  } else {
    return res.status(400).json({ error: "Unknown game." });
  }

  req.user.credits = req.user.credits - bet + payout;
  transaction(req.db, req.user, game, payout - bet, win ? "Won demo game" : "Lost demo game");
  writeDB(req.db);
  res.json({ win, payout, net: payout - bet, result, user: cleanUser(req.user) });
});

app.post("/api/requests", auth, (req, res) => {
  const kind = String(req.body.kind || "");
  const details = String(req.body.details || "").trim().slice(0, 300);
  if (!["deposit", "withdrawal"].includes(kind) || !details) return res.status(400).json({ error: "Choose a request type and enter the details." });
  const request = { id: require("crypto").randomUUID(), userId: req.user.id, username: req.user.username, kind, details, status: "pending", createdAt: new Date().toISOString() };
  req.db.requests.unshift(request);
  writeDB(req.db);
  res.json({ request, message: "Request saved as pending. No pet or item has been transferred." });
});

app.get("/api/pets", async (req, res) => {
  try {
    const response = await fetch("https://ps99.biggamesapi.io/api/collection/Pets");
    if (!response.ok) throw new Error("Pet API unavailable");
    const payload = await response.json();
    const pets = (payload.data || []).map(p => ({
      id: p.configName || p.name || String(p.id || ""),
      name: p.configName || p.name || "Unknown pet",
      type: p.category || p.rarity || "Pet",
      image: p.thumbnail || p.icon || "",
      goldenImage: p.goldenThumbnail || "",
      variants: ["Normal", ...(p.goldenThumbnail ? ["Golden"] : [])]
    }));
    res.set("Cache-Control", "public, max-age=3600");
    res.json({ pets });
  } catch {
    res.status(502).json({ error: "The live pet catalog is temporarily unavailable.", pets: [] });
  }
});

app.get("*", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
app.listen(PORT, () => console.log("Bloxygu running on port " + PORT));
