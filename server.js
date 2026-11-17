const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const FileStore = require("session-file-store")(session);
const PgSession = require("connect-pg-simple")(session);
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
const EMPTY_DB = { users: [], transactions: [], requests: [], activeMines: {}, activeBlackjack: {}, verificationChallenges: [] };
let dbCache = null;

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(path.join(DATA_DIR, "sessions"), { recursive: true });
if (!pool && !fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, JSON.stringify(EMPTY_DB, null, 2));

function readDB() {
  if (dbCache) return dbCache;
  try { return JSON.parse(fs.readFileSync(DB_FILE, "utf8")); }
  catch { return { users: [], transactions: [], requests: [], activeMines: {}, activeBlackjack: {}, verificationChallenges: [] }; }
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
    dbCache.activeMines ||= {};
    dbCache.verificationChallenges ||= [];
    dbCache.activeBlackjack ||= {};
    mineRounds = new Map(Object.entries(dbCache.activeMines).map(([userId, round]) => [userId, {
      ...round, positions: new Set(round.positions || []), picks: new Set(round.picks || [])
    }]));
    console.log("Bloxygu database: PostgreSQL");
  } else {
    dbCache = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
    dbCache.activeMines ||= {};
    dbCache.verificationChallenges ||= [];
    dbCache.activeBlackjack ||= {};
    mineRounds = new Map(Object.entries(dbCache.activeMines).map(([userId, round]) => [userId, {
      ...round, positions: new Set(round.positions || []), picks: new Set(round.picks || [])
    }]));
    console.log("Bloxygu database: local JSON (development only)");
  }
}
function cleanUser(user) {
  return { id: user.id, username: user.username, credits: user.credits, roblox: user.robloxId ? (user.robloxUsername || user.roblox || "") : "", robloxId: user.robloxId || null, displayName: user.displayName || user.username, avatarUrl: user.avatarUrl || "", verifiedAt: user.verifiedAt || null, createdAt: user.createdAt };
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
  store: pool ? new PgSession({ pool, tableName: "bloxygu_sessions", createTableIfMissing: true }) : new FileStore({ path: path.join(DATA_DIR, "sessions"), ttl: 7 * 24 * 60 * 60, retries: 1 }),
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


const crypto = require("crypto");
const challengeWords = ["amber","blox","comet","daisy","dragon","ember","frost","galaxy","glimmer","jade","lucky","meadow","nebula","nova","pixel","quest","rainbow","rocket","shadow","spark","tiger","velvet","willow","zen"];
async function robloxProfile(username) {
  const lookup = await fetch("https://users.roblox.com/v1/usernames/users", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ usernames: [username], excludeBannedUsers: true })
  });
  if (!lookup.ok) throw new Error("Roblox lookup is temporarily unavailable. Try again.");
  const found = (await lookup.json()).data?.[0];
  if (!found) return null;
  const [profileResponse, avatarResponse] = await Promise.all([
    fetch("https://users.roblox.com/v1/users/" + encodeURIComponent(found.id)),
    fetch("https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=" + encodeURIComponent(found.id) + "&size=150x150&format=Png&isCircular=false")
  ]);
  if (!profileResponse.ok) throw new Error("Could not read that Roblox profile. Try again.");
  const profile = await profileResponse.json();
  const avatarData = avatarResponse.ok ? await avatarResponse.json() : {};
  return { id: String(found.id), username: profile.name || found.name, displayName: profile.displayName || found.displayName || found.name, description: String(profile.description || ""), avatarUrl: avatarData.data?.[0]?.imageUrl || "" };
}
app.post("/api/roblox/lookup", limitAuth, async (req, res) => {
  const username = String(req.body.username || "").trim();
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) return res.status(400).json({ error: "Enter a valid Roblox username." });
  try {
    const profile = await robloxProfile(username);
    if (!profile) return res.status(404).json({ error: "We couldn't find that Roblox account." });
    const existing = readDB().users.find(u => String(u.robloxId || "") === profile.id);
    res.json({ profile: { userId: profile.id, username: profile.username, displayName: profile.displayName, avatarUrl: profile.avatarUrl }, alreadyLinked: Boolean(existing) });
  } catch (error) { res.status(502).json({ error: error.message || "Roblox lookup failed." }); }
});
app.post("/api/roblox/verify/start", limitAuth, async (req, res) => {
  const userId = String(req.body.userId || "");
  const username = String(req.body.username || "");
  if (!/^\d{1,20}$/.test(userId)) return res.status(400).json({ error: "Look up your Roblox account first." });
  try {
    const profile = await robloxProfile(username);
    if (!profile || profile.id !== userId) return res.status(409).json({ error: "That Roblox account changed. Look it up again." });
    const db = readDB();
    const existing = db.users.find(u => String(u.robloxId || "") === userId);
    db.verificationChallenges = (db.verificationChallenges || []).filter(c => c.expiresAt > Date.now() && c.userId !== userId);
    const phrase = Array.from({ length: 5 }, () => challengeWords[crypto.randomInt(challengeWords.length)]).join(" ");
    const challenge = { id: crypto.randomUUID(), userId, username: profile.username, displayName: profile.displayName, avatarUrl: profile.avatarUrl, phraseHash: crypto.createHash("sha256").update(phrase).digest("hex"), phrase, expiresAt: Date.now() + 10 * 60 * 1000, attempts: 0 };
    db.verificationChallenges.push(challenge);
    await writeDB(db);
    res.json({ challengeId: challenge.id, phrase, expiresAt: challenge.expiresAt, profile: { userId, username: profile.username, displayName: profile.displayName, avatarUrl: profile.avatarUrl } });
  } catch (error) { res.status(502).json({ error: error.message || "Could not start verification." }); }
});
app.post("/api/roblox/verify/check", limitAuth, async (req, res) => {
  const challengeId = String(req.body.challengeId || "");
  const db = readDB();
  const challenge = (db.verificationChallenges || []).find(c => c.id === challengeId);
  if (!challenge || challenge.expiresAt < Date.now()) return res.status(400).json({ error: "Your code expired. Start verification again." });
  if (challenge.attempts >= 8) return res.status(429).json({ error: "Too many checks. Start a new verification." });
  challenge.attempts += 1;
  try {
    const profile = await robloxProfile(challenge.username);
    if (!profile || profile.id !== challenge.userId) return res.status(409).json({ error: "Could not confirm that Roblox profile. Try again." });
    const phrase = challenge.phrase;
    if (!phrase || crypto.createHash("sha256").update(phrase).digest("hex") !== challenge.phraseHash) return res.status(400).json({ error: "Verification expired. Start again." });
    if (!profile.description.toLowerCase().includes(phrase.toLowerCase())) {
      await writeDB(db);
      return res.status(400).json({ error: "Code not found in your Roblox About yet. Save it there, then try again." });
    }
    let user = db.users.find(u => String(u.robloxId || "") === profile.id);
    if (!user) {
      user = { id: crypto.randomUUID(), username: profile.username, roblox: profile.username, robloxId: profile.id, robloxUsername: profile.username, displayName: profile.displayName, avatarUrl: profile.avatarUrl, verifiedAt: new Date().toISOString(), credits: 25000, lastDaily: null, createdAt: new Date().toISOString() };
      db.users.push(user);
      transaction(db, user, "bonus", 25000, "Welcome bonus — demo credits");
    } else {
      user.roblox = profile.username; user.robloxUsername = profile.username; user.displayName = profile.displayName; user.avatarUrl = profile.avatarUrl; user.verifiedAt ||= new Date().toISOString();
    }
    db.verificationChallenges = db.verificationChallenges.filter(c => c.id !== challenge.id);
    await writeDB(db);
    req.session.userId = user.id;
    res.json({ user: cleanUser(user) });
  } catch (error) { res.status(502).json({ error: error.message || "Roblox verification failed." }); }
});

app.post("/api/register", limitAuth, async (req, res) => {
  if (process.env.NODE_ENV === "production") return res.status(410).json({ error: "Password registration is disabled. Sign in with Roblox verification." });
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
  if (process.env.NODE_ENV === "production") return res.status(410).json({ error: "Password login is disabled. Sign in with Roblox verification." });
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

app.post("/api/profile", auth, (req, res) => res.status(410).json({ error: "Roblox accounts can only be linked through profile verification." }));

app.get("/api/leaderboard", (req, res) => {
  const db = readDB();
  res.json({ users: db.users.slice().sort((a, b) => b.credits - a.credits).slice(0, 10).map(u => ({ username: u.username, credits: u.credits })) });
});

app.post("/api/game", auth, async (req, res) => {
  const game = String(req.body.game || "");
  const bet = Math.floor(Number(req.body.bet));
  if (!Number.isFinite(bet) || bet < 10 || bet > 5000) return res.status(400).json({ error: "Bet must be between 10 and 5,000 demo credits." });
  if (req.db.activeMines?.[req.user.id] || req.db.activeBlackjack?.[req.user.id]) return res.status(409).json({ error: "Finish your active game round first." });
  if (req.user.credits < bet) return res.status(400).json({ error: "Not enough demo credits." });

  let win = false, payout = 0, result = {};
  if (game === "dice") {
    const colors = ["red", "blue", "green", "purple"];
    const choice = String(req.body.choice || "");
    if (!colors.includes(choice)) return res.status(400).json({ error: "Choose a valid dice color." });
    const landed = colors[crypto.randomInt(colors.length)];
    win = landed === choice;
    payout = win ? bet * 3 : 0;
    result = { landed, choice, multiplier: 3 };
  } else if (game === "coinflip") {
    const choice = String(req.body.choice || "");
    if (!["heads", "tails"].includes(choice)) return res.status(400).json({ error: "Choose heads or tails." });
    const landed = crypto.randomInt(2) === 0 ? "heads" : "tails";
    win = landed === choice;
    payout = win ? bet * 2 : 0;
    result = { landed, choice, multiplier: 2 };
  } else if (game === "mines") {
    const mines = Math.max(1, Math.min(20, Math.floor(Number(req.body.mines) || 3)));
    const pick = crypto.randomInt(25);
    win = pick >= mines;
    payout = win ? Math.floor(bet * (1 + mines / 10)) : 0;
    result = { pick, mines, multiplier: win ? (1 + mines / 10) : 0 };
  } else if (game === "upgrader") {
    const target = Number(req.body.target);
    if (!Number.isFinite(target) || target < 1.1 || target > 10) return res.status(400).json({ error: "Multiplier must be between 1.1x and 10x." });
    win = crypto.randomInt(1000000) < Math.floor((0.96 / target) * 1000000);
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
let mineRounds = new Map();
app.post("/api/mines/start", auth, async (req, res) => {
  const bet = Math.floor(Number(req.body.bet));
  const mines = Math.floor(Number(req.body.mines));
  if (!Number.isFinite(bet) || bet < 10 || bet > 5000) return res.status(400).json({ error: "Bet must be between 10 and 5,000 demo credits." });
  if (!Number.isInteger(mines) || mines < 1 || mines > 24) return res.status(400).json({ error: "Choose 1–24 mines." });
  if (req.user.credits < bet) return res.status(400).json({ error: "Not enough demo credits." });
  if (mineRounds.has(req.user.id) || req.db.activeBlackjack?.[req.user.id]) return res.status(409).json({ error: "Finish your active game round first." });
  const positions = new Set();
  while (positions.size < mines) positions.add(crypto.randomInt(25));
  const round = { bet, mines, positions, picks: new Set(), multiplier: 1 };
  mineRounds.set(req.user.id, round);
  req.db.activeMines[req.user.id] = { bet, mines, positions: Array.from(positions), picks: [], multiplier: 1 };
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
    delete req.db.activeMines[req.user.id];
    transaction(req.db, req.user, "mines-loss", 0, "Hit a mine");
    await writeDB(req.db);
    return res.json({ hit: true, tile, mines: Array.from(round.positions), user: cleanUser(req.user), ended: true });
  }
  const previousSafePicks = round.picks.size - 1;
  round.multiplier *= ((25 - previousSafePicks) / (25 - round.mines - previousSafePicks)) * 0.97;
  req.db.activeMines[req.user.id] = { bet: round.bet, mines: round.mines, positions: Array.from(round.positions), picks: Array.from(round.picks), multiplier: round.multiplier };
  await writeDB(req.db);
  res.json({ hit: false, tile, safePicks: round.picks.size, multiplier: Number(round.multiplier.toFixed(3)), ended: false });
});
app.post("/api/mines/cashout", auth, async (req, res) => {
  const round = mineRounds.get(req.user.id);
  if (!round || round.picks.size < 1) return res.status(400).json({ error: "Pick at least one safe tile before cashing out." });
  const payout = Math.floor(round.bet * round.multiplier);
  req.user.credits += payout;
  mineRounds.delete(req.user.id);
  delete req.db.activeMines[req.user.id];
  transaction(req.db, req.user, "mines-cashout", payout, "Cashed out Mines round");
  await writeDB(req.db);
  res.json({ payout, multiplier: Number(round.multiplier.toFixed(3)), user: cleanUser(req.user), ended: true });
});


function blackjackDeck() {
  const suits = ["♠","♥","♦","♣"], ranks = ["A","2","3","4","5","6","7","8","9","10","J","Q","K"];
  const cards = suits.flatMap(suit => ranks.map(rank => ({ rank, suit, value: rank === "A" ? 11 : (["J","Q","K"].includes(rank) ? 10 : Number(rank)) })));
  for (let i = cards.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [cards[i], cards[j]] = [cards[j], cards[i]]; }
  return cards;
}
function blackjackValue(cards) {
  let total = cards.reduce((sum, card) => sum + card.value, 0), aces = cards.filter(card => card.rank === "A").length;
  while (total > 21 && aces > 0) { total -= 10; aces--; }
  return total;
}
function publicBlackjack(round) {
  return { player: round.player, dealer: round.finished ? round.dealer : [round.dealer[0], { hidden: true }], playerValue: blackjackValue(round.player), dealerValue: round.finished ? blackjackValue(round.dealer) : null, finished: round.finished, outcome: round.outcome || null };
}
async function finishBlackjack(req, round, outcome, payout) {
  round.finished = true; round.outcome = outcome;
  req.user.credits += payout;
  delete req.db.activeBlackjack[req.user.id];
  transaction(req.db, req.user, "blackjack", payout, "Blackjack " + outcome);
  await writeDB(req.db);
  return { round: publicBlackjack(round), payout, user: cleanUser(req.user) };
}
app.post("/api/blackjack/start", auth, async (req, res) => {
  const bet = Math.floor(Number(req.body.bet));
  if (!Number.isInteger(bet) || bet < 10 || bet > 5000) return res.status(400).json({ error: "Bet must be between 10 and 5,000 demo credits." });
  if (req.user.credits < bet) return res.status(400).json({ error: "Not enough demo credits." });
  if (req.db.activeBlackjack[req.user.id] || req.db.activeMines?.[req.user.id]) return res.status(409).json({ error: "Finish your active game round first." });
  const deck = blackjackDeck();
  const round = { bet, deck, player: [deck.pop(), deck.pop()], dealer: [deck.pop(), deck.pop()], finished: false, outcome: null };
  req.user.credits -= bet;
  transaction(req.db, req.user, "blackjack-start", -bet, "Started Blackjack hand");
  const natural = blackjackValue(round.player) === 21;
  if (natural) {
    const dealerNatural = blackjackValue(round.dealer) === 21;
    const result = await finishBlackjack(req, round, dealerNatural ? "push" : "blackjack", dealerNatural ? bet : Math.floor(bet * 2.5));
    return res.json({ ...result, natural: true });
  }
  req.db.activeBlackjack[req.user.id] = round;
  await writeDB(req.db);
  res.json({ round: publicBlackjack(round), user: cleanUser(req.user) });
});
app.get("/api/blackjack/state", auth, (req, res) => {
  const round = req.db.activeBlackjack[req.user.id];
  res.json({ active: Boolean(round), round: round ? publicBlackjack(round) : null });
});
app.post("/api/blackjack/hit", auth, async (req, res) => {
  const round = req.db.activeBlackjack[req.user.id];
  if (!round || round.finished) return res.status(400).json({ error: "No active Blackjack hand." });
  round.player.push(round.deck.pop());
  const total = blackjackValue(round.player);
  if (total > 21) return res.json(await finishBlackjack(req, round, "bust", 0));
  await writeDB(req.db);
  res.json({ round: publicBlackjack(round), user: cleanUser(req.user) });
});
app.post("/api/blackjack/stand", auth, async (req, res) => {
  const round = req.db.activeBlackjack[req.user.id];
  if (!round || round.finished) return res.status(400).json({ error: "No active Blackjack hand." });
  while (blackjackValue(round.dealer) < 17) round.dealer.push(round.deck.pop());
  const player = blackjackValue(round.player), dealer = blackjackValue(round.dealer);
  const outcome = dealer > 21 || player > dealer ? "win" : player === dealer ? "push" : "loss";
  const payout = outcome === "win" ? round.bet * 2 : outcome === "push" ? round.bet : 0;
  res.json(await finishBlackjack(req, round, outcome, payout));
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
