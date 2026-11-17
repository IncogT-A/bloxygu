const $ = s => document.querySelector(s);
let me = null, authMode = "login", currentGame = "dice", selectedChoice = "red", petData = [], activeMines = false;

function toast(message) {
  const el = $("#toast"); el.textContent = message; el.classList.add("show");
  clearTimeout(toast.timer); toast.timer = setTimeout(() => el.classList.remove("show"), 2600);
}
async function api(url, options = {}) {
  const response = await fetch(url, { credentials: "same-origin", headers: { "Content-Type": "application/json" }, ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Something went wrong.");
  return data;
}
function updateUser(user) {
  me = user;
  $("#balance").classList.toggle("hidden", !me);
  $("#balance").textContent = me ? "◆ " + me.credits.toLocaleString() : "";
  $("#accountButton").textContent = me ? me.username : "Log in";
}
function showPage(page) {
  document.querySelectorAll(".page").forEach(p => p.classList.add("hidden"));
  $("#" + page + "Page").classList.remove("hidden");
  document.querySelectorAll(".nav-link").forEach(b => b.classList.toggle("active", b.dataset.page === page));
  if (page === "pets") loadPets();
  if (page === "leaderboard") loadLeaderboard();
  window.scrollTo({ top: 0, behavior: "smooth" });
}
document.querySelectorAll("[data-page]").forEach(b => b.addEventListener("click", () => showPage(b.dataset.page)));
document.querySelectorAll("[data-go]").forEach(b => b.addEventListener("click", () => showPage(b.dataset.go)));
document.querySelectorAll("[data-close]").forEach(b => b.addEventListener("click", () => b.closest(".modal").classList.add("hidden")));
document.querySelectorAll(".modal").forEach(m => m.addEventListener("click", e => { if (e.target === m) m.classList.add("hidden"); }));

function openAuth(mode = "login") {
  authMode = mode; $("#authTitle").textContent = mode === "login" ? "Log in" : "Create account";
  $("#authSubmit").textContent = mode === "login" ? "Log in" : "Create account";
  $("#authSwitch").textContent = mode === "login" ? "Need an account? Sign up" : "Already have an account? Log in";
  $("#authError").textContent = ""; $("#authModal").classList.remove("hidden");
}
$("#accountButton").addEventListener("click", () => {
  if (!me) return openAuth("login");
  $("#profileName").textContent = me.username; $("#profileBalance").textContent = me.credits.toLocaleString() + " demo credits";
  $("#robloxName").value = me.roblox || ""; $("#profileMessage").textContent = "";
  $("#profileModal").classList.remove("hidden");
  loadAccountActivity();
});
$("#authSwitch").addEventListener("click", () => openAuth(authMode === "login" ? "register" : "login"));
$("#authForm").addEventListener("submit", async e => {
  e.preventDefault(); $("#authError").textContent = "";
  try {
    const data = await api("/api/" + (authMode === "login" ? "login" : "register"), { method: "POST", body: JSON.stringify({ username: $("#authUsername").value, password: $("#authPassword").value }) });
    updateUser(data.user); $("#authModal").classList.add("hidden"); $("#authForm").reset(); toast("Welcome to Bloxygu, " + me.username + "!");
  } catch (err) { $("#authError").textContent = err.message; }
});
$("#logout").addEventListener("click", async () => { await api("/api/logout", { method: "POST", body: "{}" }); updateUser(null); $("#profileModal").classList.add("hidden"); toast("Logged out."); });
$("#dailyClaim").addEventListener("click", async () => {
  try { const data = await api("/api/daily", { method: "POST", body: "{}" }); updateUser(data.user); $("#profileBalance").textContent = me.credits.toLocaleString() + " demo credits"; toast("Daily bonus claimed: +1,000!"); }
  catch (e) { toast(e.message); }
});
$("#saveProfile").addEventListener("click", async () => {
  try { const data = await api("/api/profile", { method: "POST", body: JSON.stringify({ roblox: $("#robloxName").value }) }); updateUser(data.user); $("#profileMessage").textContent = data.note; }
  catch (e) { toast(e.message); }
});

async function loadPets() {
  if (petData.length) return renderPets();
  $("#petStatus").textContent = "Loading live pet catalog...";
  try {
    const data = await api("/api/pets"); petData = data.pets || [];
    $("#petStatus").textContent = petData.length
      ? petData.length.toLocaleString() + " catalog entries · " + (data.variantsKnown ? "variant availability from BIG Games" : "variant availability temporarily unavailable") + " · Values coming later"
      : "Catalog unavailable right now. Try again later.";
    renderPets();
  } catch (e) { $("#petStatus").textContent = e.message; }
}
function renderPets() {
  const q = $("#petSearch").value.toLowerCase(), type = $("#petType").value, variant = $("#petVariant").value;
  const items = petData.filter(p => p.name.toLowerCase().includes(q)
    && (type === "all" || String(p.type).toLowerCase().includes(type.toLowerCase()))
    && (variant === "all" || (p.variantsKnown && p.variants.includes(variant))));
  $("#petStatus").textContent = items.length + " matching pets · Values coming later";
  $("#petGrid").innerHTML = items.slice(0, 120).map(p => {
    const image = (variant === "Golden" || variant === "Shiny Golden") && p.goldenImage ? p.goldenImage : p.image;
    const variantLabel = variant === "all" ? (p.variantsKnown ? (p.variants.length ? p.variants.join(" · ") : "No variant records") : "Variant data unavailable") : variant;
    return '<article class="pet-card"><div class="pet-image">' + (image ? '<img loading="lazy" src="' + escapeAttr(image) + '" alt="' + escapeAttr(p.name) + '">' : '<span>🐾</span>') + '</div><div class="pet-name">' + escapeHtml(p.name) + '</div><div class="pet-type">' + escapeHtml(p.type) + (p.rarity ? ' · ' + escapeHtml(p.rarity) : '') + '</div><div class="pet-type">' + escapeHtml(variantLabel) + '</div></article>';
  }).join("") || '<p class="muted">No pets found.</p>';
}
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c])); }
function escapeAttr(s) { return escapeHtml(s); }
$("#petSearch").addEventListener("input", renderPets);
$("#petType").addEventListener("change", renderPets);
$("#petVariant").addEventListener("change", renderPets);

async function loadAccountActivity() {
  try {
    const [tx, req] = await Promise.all([api("/api/transactions"), api("/api/requests")]);
    $("#transactionList").innerHTML = tx.transactions.length ? tx.transactions.map(t => '<div class="history-row"><span>' + escapeHtml(t.note) + '<small>' + new Date(t.createdAt).toLocaleString() + '</small></span><b class="' + (t.amount >= 0 ? 'positive' : 'negative') + '">' + (t.amount > 0 ? '+' : '') + Number(t.amount).toLocaleString() + '</b></div>').join("") : '<p class="small-note">No transactions yet.</p>';
    $("#requestList").innerHTML = req.requests.length ? req.requests.map(x => '<div class="history-row"><span>' + escapeHtml(x.kind) + '<small>' + escapeHtml(x.details) + '</small></span><b>' + escapeHtml(x.status) + '</b></div>').join("") : '<p class="small-note">No requests yet.</p>';
  } catch (e) { $("#transactionList").textContent = e.message; }
}
$("#sendRequest").addEventListener("click", async () => {
  const details = $("#requestDetails").value.trim();
  if (!details) return toast("Add the pet details first.");
  try {
    const data = await api("/api/requests", { method: "POST", body: JSON.stringify({ kind: $("#requestKind").value, details }) });
    $("#requestDetails").value = "";
    $("#profileMessage").textContent = data.message;
    await loadAccountActivity();
  } catch (e) { toast(e.message); }
});

async function loadLeaderboard() {
  try {
    const data = await api("/api/leaderboard");
    $("#leaderboard").innerHTML = data.users.map((u, i) => '<div class="leader-row"><span class="rank">#' + (i + 1) + '</span><span class="leader-name">' + escapeHtml(u.username) + '</span><span class="leader-score">◆ ' + u.credits.toLocaleString() + '</span></div>').join("") || "No players yet.";
  } catch (e) { $("#leaderboard").textContent = e.message; }
}
const gameInfo = {
  dice: ["Color Dice Duel", "Pick a color. Match the roll and win 3× your bet."],
  coinflip: ["Coinflip", "Call heads or tails. Correct calls pay 2×."],
  mines: ["Mines", "A quick demo round: the server checks a randomly selected tile."],
  upgrader: ["Upgrader", "Choose a multiplier. Higher targets have lower win chances."]
};
function setGame(game) {
  currentGame = game; document.querySelectorAll(".game-tab").forEach(b => b.classList.toggle("active", b.dataset.game === game));
  $("#gameTitle").textContent = gameInfo[game][0]; $("#gameDescription").textContent = gameInfo[game][1];
  $("#gameResult").textContent = "Place a demo bet to play.";
  const opts = $("#gameOptions");
  if (game === "dice") opts.innerHTML = ["red","blue","green","purple"].map(c => '<button class="choice ' + (selectedChoice === c ? "selected" : "") + '" data-choice="' + c + '">' + c[0].toUpperCase() + c.slice(1) + '</button>').join("");
  if (game === "coinflip") opts.innerHTML = '<button class="choice selected" data-choice="heads">Heads</button><button class="choice" data-choice="tails">Tails</button>';
  if (game === "mines") opts.innerHTML = '<label class="control-label">Mine count</label><input id="mineCount" class="field" type="number" min="1" max="20" value="3">';
  if (game === "upgrader") opts.innerHTML = '<label class="control-label">Target multiplier</label><input id="targetMultiplier" class="field" type="number" min="1.1" max="10" step=".1" value="2">';
  opts.querySelectorAll("[data-choice]").forEach(b => b.addEventListener("click", () => { selectedChoice = b.dataset.choice; opts.querySelectorAll(".choice").forEach(x => x.classList.toggle("selected", x === b)); }));
  $("#gameDisplay").innerHTML = '<div class="dice-face">' + (game === "coinflip" ? "◐" : game === "mines" ? "✹" : game === "upgrader" ? "↑" : "?") + '</div>';
}
document.querySelectorAll(".game-tab").forEach(b => b.addEventListener("click", () => setGame(b.dataset.game)));
$("#playGame").addEventListener("click", async () => {
  if (!me) return openAuth("login");
  const bet = Number($("#bet").value);
  const payload = { game: currentGame, bet };
  if (currentGame === "dice" || currentGame === "coinflip") payload.choice = selectedChoice;
  if (currentGame === "mines") payload.mines = Number($("#mineCount").value);
  if (currentGame === "upgrader") payload.target = Number($("#targetMultiplier").value);
  $("#playGame").disabled = true; $("#playGame").textContent = "Rolling...";
  try {
    const data = await api("/api/game", { method: "POST", body: JSON.stringify(payload) });
    updateUser(data.user);
    let detail = "";
    if (currentGame === "dice") detail = "Landed: " + data.result.landed;
    if (currentGame === "coinflip") detail = "Landed: " + data.result.landed;
    if (currentGame === "mines") detail = "Tile " + (data.result.pick + 1) + (data.win ? " was safe." : " had a mine.");
    if (currentGame === "upgrader") detail = "Target " + data.result.target + "× · " + data.result.chance + "% chance";
    $("#gameDisplay").innerHTML = '<div class="dice-face">' + (data.win ? "✓" : "×") + '</div>';
    $("#gameResult").textContent = (data.win ? "YOU WON +" : "YOU LOST ") + Math.abs(data.net).toLocaleString() + " demo credits · " + detail;
  } catch (e) { toast(e.message); }
  finally { $("#playGame").disabled = false; $("#playGame").innerHTML = 'Play round <span>↗</span>'; }
});
async function init() {
  try { const data = await api("/api/me"); updateUser(data.user); } catch { updateUser(null); }
  setGame("dice");
}
init();
