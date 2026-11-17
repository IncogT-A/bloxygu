const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const FileStore = require("session-file-store")(session);
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const DB_FILE = path.join(DATA_DIR, "db.json");
const { Pool } = require("pg");
const pool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 5 })
  : null;
const EMPTY_DB = { users: [], transactions: [], requests: [] };
let dbCache = null;

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(path.join(DATA_DIR, "sessions"), { recursive: true });
if (!pool && !fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, JSON.stringify(EMPTY_DB, null, 2));

function readDB() {
  if (dbCache) return dbCache;
  try { return JSON.parse(fs.readFileSync(DB_FILE, "utf8")); }
  catch { return { users: [], transactions: [], requests: [] }; }
}
async function writeDB(db) {
  dbCache = db;
  if (pool) {
    await pool.query(
      "INSERT INTO bloxygu_state (id, state) VALUES (1, $1::jsonb) ON CONFLICT (id) DO UPDATE SET state = EXCLUDED.state",
      [JSON.stringify(db)]
    );
    return;
  }
  const temp = DB_FILE + ".tmp";
  fs.writeFileSync(temp, JSON.stringify(db, null, 2));
  fs.renameSync(temp, DB_FILE);
}
async function initDB() {
  if (pool) {
    await pool.query("CREATE TABLE IF NOT EXISTS bloxygu_state (id integer PRIMARY KEY, state jsonb NOT NULL)");
    const result = await pool.query("SELECT state FROM bloxygu_state WHERE id = 1");
    if (result.rows.length) dbCache = result.rows[0].state;
    else {
      dbCache = EMPTY_DB;
      await pool.query("INSERT INTO bloxygu_state (id, state) VALUES (1, $1::jsonb)", [JSON.stringify(dbCache)]);
    }
    console.log("Bloxygu database: PostgreSQL");
  } else {
    dbCache = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
    console.log("Bloxygu database: local JSON (development only)");
  }
}
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
if (process.env.NODE_ENV === "production" && !process.env.SESSION_SECRET) throw new Error("SESSION_SECRET must be configured in production.");
app.set("trust proxy", 1);
app.use(session({
  store: new FileStore({ path: path.join(DATA_DIR, "sessions"), ttl: 7 * 24 * 60 * 60, retries: 1 }),
  name: "bloxygu.sid",
  secret: process.env.SESSION_SECRET || "bloxygu-local-development-secret-only",
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 7 * 24 * 60 * 60 * 1000 }
}));

const authAttempts = new Map();
function limitAuth(req, res, next) {
  const key = req.ip + ":" + req.path;
  const now = Date.now();
  const entry = authAttempts.get(key) || { count: 0, start: now };
  if (now - entry.start > 15 * 60 * 1000) { entry.count = 0; entry.start = now; }
  entry.count += 1; authAttempts.set(key, entry);
  if (entry.count > 12) return res.status(429).json({ error: "Too many attempts. Wait 15 minutes and try again." });
  next();
}
app.get("/api/health", (req, res) => res.json({ ok: true, service: "bloxygu", time: new Date().toISOString() }));
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/me", (req, res) => {
  if (!req.session.userId) return res.json({ user: null });
  const db = readDB();
  const user = db.users.find(u => u.id === req.session.userId);
  res.json({ user: user ? cleanUser(user) : null });
});

app.post("/api/register", limitAuth, async (req, res) => {
  const username = String(req.body.username || "").trim();
  const password = String(req.body.password || "");
  if (!/^[a-zA-Z0-9_]{3,18}$/.test(username)) return res.status(400).json({ error: "Username must be 3–18 letters, numbers or underscores." });
  if (password.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters." });
  const db = readDB();
  if (db.users.some(u => u.username.toLowerCase() === username.toLowerCase())) return res.status(409).json({ error: "That username is already taken." });
  const user = { id: require("crypto").randomUUID(), username, passwordHash: await bcrypt.hash(password, 12), credits: 25000, roblox: "", lastDaily: null, createdAt: new Date().toISOString() };
  db.users.push(user);
  transaction(db, user, "bonus", 25000, "Welcome bonus — demo credits");
  await writeDB(db);
  req.session.userId = user.id;
  res.json({ user: cleanUser(user) });
});

app.post("/api/login", limitAuth, async (req, res) => {
  const username = String(req.body.username || "").trim();
  const password = String(req.body.password || "");
  const db = readDB();
  const user = db.users.find(u => u.username.toLowerCase() === username.toLowerCase());
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) return res.status(401).json({ error: "Incorrect username or password." });
  req.session.userId = user.id;
  res.json({ user: cleanUser(user) });
});

app.post("/api/logout", (req, res) => req.session.destroy(() => { res.clearCookie("bloxygu.sid"); res.json({ ok: true }); }));

app.post("/api/daily", auth, async (req, res) => {
  const now = Date.now();
  if (req.user.lastDaily && now - new Date(req.user.lastDaily).getTime() < 20 * 60 * 60 * 1000) return res.status(429).json({ error: "Your daily bonus is still cooling down." });
  req.user.credits += 1000;
  req.user.lastDaily = new Date(now).toISOString();
  transaction(req.db, req.user, "daily", 1000, "Daily demo credit bonus");
  await writeDB(req.db);
  res.json({ user: cleanUser(req.user) });
});

app.get("/api/transactions", auth, (req, res) => {
  res.json({ transactions: req.db.transactions.filter(t => t.userId === req.user.id).slice(0, 100) });
});

app.get("/api/requests", auth, (req, res) => {
  res.json({ requests: req.db.requests.filter(item => item.userId === req.user.id).slice(0, 50) });
});

app.post("/api/profile", auth, async (req, res) => {
  const roblox = String(req.body.roblox || "").trim();
  if (roblox && !/^[a-zA-Z0-9_]{3,20}$/.test(roblox)) return res.status(400).json({ error: "Roblox username must be 3–20 letters, numbers or underscores." });
  req.user.roblox = roblox;
  await writeDB(req.db);
  res.json({ user: cleanUser(req.user), note: "Roblox username saved. This does not verify account ownership." });
});

app.get("/api/leaderboard", (req, res) => {
  const db = readDB();
  res.json({ users: db.users.slice().sort((a, b) => b.credits - a.credits).slice(0, 10).map(u => ({ username: u.username, credits: u.credits })) });
});

app.post("/api/game", auth, async (req, res) => {
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
  await writeDB(req.db);
  res.json({ win, payout, net: payout - bet, result, user: cleanUser(req.user) });
});

// Mines is a server-managed round: the client never receives mine positions before cashout.
const mineRounds = new Map();
app.post("/api/mines/start", auth, async (req, res) => {
  const bet = Math.floor(Number(req.body.bet));
  const mines = Math.floor(Number(req.body.mines));
  if (!Number.isFinite(bet) || bet < 10 || bet > 5000) return res.status(400).json({ error: "Bet must be between 10 and 5,000 demo credits." });
  if (!Number.isInteger(mines) || mines < 1 || mines > 24) return res.status(400).json({ error: "Choose 1–24 mines." });
  if (req.user.credits < bet) return res.status(400).json({ error: "Not enough demo credits." });
  if (mineRounds.has(req.user.id)) return res.status(409).json({ error: "Finish or cash out your current Mines round first." });
  const positions = new Set();
  while (positions.size < mines) positions.add(Math.floor(Math.random() * 25));
  mineRounds.set(req.user.id, { bet, mines, positions, picks: new Set(), multiplier: 1 });
  req.user.credits -= bet;
  transaction(req.db, req.user, "mines-start", -bet, "Started Mines round");
  await writeDB(req.db);
  res.json({ user: cleanUser(req.user), safePicks: 0, multiplier: 1, active: true });
});
app.get("/api/mines/state", auth, (req, res) => {
  const round = mineRounds.get(req.user.id);
  if (!round) return res.json({ active: false });
  res.json({ active: true, bet: round.bet, mines: round.mines, safePicks: round.picks.size, picks: Array.from(round.picks), multiplier: Number(round.multiplier.toFixed(3)) });
});
app.post("/api/mines/pick", auth, async (req, res) => {
  const round = mineRounds.get(req.user.id);
  if (!round) return res.status(400).json({ error: "Start a Mines round first." });
  const tile = Number(req.body.tile);
  if (!Number.isInteger(tile) || tile < 0 || tile > 24 || round.picks.has(tile)) return res.status(400).json({ error: "Choose an unpicked tile." });
  round.picks.add(tile);
  if (round.positions.has(tile)) {
    mineRounds.delete(req.user.id);
    transaction(req.db, req.user, "mines-loss", 0, "Hit a mine");
    await writeDB(req.db);
    return res.json({ hit: true, tile, mines: Array.from(round.positions), user: cleanUser(req.user), ended: true });
  }
  const previousSafePicks = round.picks.size - 1;
  round.multiplier *= ((25 - previousSafePicks) / (25 - round.mines - previousSafePicks)) * 0.97;
  res.json({ hit: false, tile, safePicks: round.picks.size, multiplier: Number(round.multiplier.toFixed(3)), ended: false });
});
app.post("/api/mines/cashout", auth, async (req, res) => {
  const round = mineRounds.get(req.user.id);
  if (!round || round.picks.size < 1) return res.status(400).json({ error: "Pick at least one safe tile before cashing out." });
  const payout = Math.floor(round.bet * round.multiplier);
  req.user.credits += payout;
  mineRounds.delete(req.user.id);
  transaction(req.db, req.user, "mines-cashout", payout, "Cashed out Mines round");
  await writeDB(req.db);
  res.json({ payout, multiplier: Number(round.multiplier.toFixed(3)), user: cleanUser(req.user), ended: true });
});

app.post("/api/requests", auth, async (req, res) => {
  const kind = String(req.body.kind || "");
  const details = String(req.body.details || "").trim().slice(0, 300);
  if (!["deposit", "withdrawal"].includes(kind) || !details) return res.status(400).json({ error: "Choose a request type and enter the details." });
  const request = { id: require("crypto").randomUUID(), userId: req.user.id, username: req.user.username, kind, details, status: "pending", createdAt: new Date().toISOString() };
  req.db.requests.unshift(request);
  await writeDB(req.db);
  res.json({ request, message: "Request saved as pending. No pet or item has been transferred." });
});

function petImageUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const asset = raw.match(/(?:rbxassetid:\/\/|^)(\d+)$/i);
  if (asset) return "https://ps99.biggamesapi.io/image/" + asset[1];
  if (/^https:\/\//i.test(raw)) return raw;
  return "";
}

let petCache = null;
let petCacheAt = 0;
app.get("/api/pets", async (req, res) => {
  if (petCache && Date.now() - petCacheAt < 60 * 1000) {
    res.set("Cache-Control", "public, max-age=60");
    return res.json(petCache);
  }
  try {
    const response = await fetch("https://ps99.biggamesapi.io/api/collection/Pets");
    if (!response.ok) throw new Error("Pet collection unavailable");
    const payload = await response.json();
    if (!Array.isArray(payload.data)) throw new Error("Invalid pet collection response");

    // BIG Games exposes actual variant flags through /api/exists:
    // pt=1 Golden, pt=2 Rainbow, sh=1 Shiny. Shiny combines with pt.
    let variantsByPet = new Map();
    let variantsKnown = false;
    try {
      const existsResponse = await fetch("https://ps99.biggamesapi.io/api/exists");
      if (existsResponse.ok) {
        const existsPayload = await existsResponse.json();
        if (Array.isArray(existsPayload.data)) {
          variantsKnown = true;
          for (const item of existsPayload.data) {
            if (item.category !== "Pet" || !item.configData || !item.configData.id) continue;
            const id = String(item.configData.id);
            const pt = Number(item.configData.pt || 0);
            const shiny = item.configData.sh === 1 || item.configData.sh === true;
            const base = pt === 1 ? "Golden" : pt === 2 ? "Rainbow" : "Normal";
            const variant = shiny ? (base === "Normal" ? "Shiny" : "Shiny " + base) : base;
            if (!variantsByPet.has(id)) variantsByPet.set(id, new Set());
            variantsByPet.get(id).add(variant);
          }
        }
      }
    } catch { /* Keep catalog usable if variant lookup is temporarily unavailable. */ }

    const pets = payload.data.map(p => {
      const id = String(p.configName || p.name || p.id || "");
      const config = p.configData || {};
      const knownVariants = variantsByPet.get(id);
      return {
        id,
        name: config.name || p.configName || p.name || "Unknown pet",
        type: p.category || config.category || "Pet",
        rarity: config.rarity || "",
        image: petImageUrl(config.thumbnail || p.thumbnail || p.icon || ""),
        goldenImage: petImageUrl(config.goldenThumbnail || p.goldenThumbnail || ""),
        variants: variantsKnown ? Array.from(knownVariants || []) : [],
        variantsKnown
      };
    });
    petCache = { pets, variantsKnown };
    petCacheAt = Date.now();
    res.set("Cache-Control", "public, max-age=60");
    res.json(petCache);
  } catch {
    res.status(502).json({ error: "The live pet catalog is temporarily unavailable.", pets: [] });
  }
});

app.get("*", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
initDB()
  .then(() => app.listen(PORT, "0.0.0.0", () => console.log("Bloxygu running on port " + PORT)))
  .catch(error => {
    console.error("Bloxygu database startup failed:", error);
    process.exit(1);
  });
