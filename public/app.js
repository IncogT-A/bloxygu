const $ = s => document.querySelector(s);
let me = null, robloxCandidate = null, robloxChallengeId = null, currentGame = "dice", selectedChoice = "red", petData = [], activeMines = false, activeBlackjack = false, petLimit = 60, botMatch = null, duelColors = ["orange","yellow"];

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
  $("#accountButton").replaceChildren();
  if (me && me.avatarUrl) {
    const avatar = document.createElement("img"); avatar.src = me.avatarUrl; avatar.alt = ""; avatar.className = "account-avatar";
    $("#accountButton").append(avatar);
  }
  const accountLabel = document.createElement("span"); accountLabel.textContent = me ? (me.displayName || me.username) : "Log in";
  $("#accountButton").append(accountLabel);
  $("#adminNav")?.classList.toggle("hidden", !me?.isAdmin);
}
function showPage(page) {
  document.querySelectorAll(".page").forEach(p => p.classList.add("hidden"));
  $("#" + page + "Page").classList.remove("hidden");
  document.querySelectorAll(".nav-link").forEach(b => b.classList.toggle("active", b.dataset.page === page));
  if (page === "pets") loadPets();
  if (page === "leaderboard") loadLeaderboard();
  if (page === "games") loadDemoBots();
  if (page === "admin") loadAdminOverview();
  window.scrollTo({ top: 0, behavior: "smooth" });
}
document.querySelectorAll("[data-page]").forEach(b => b.addEventListener("click", () => showPage(b.dataset.page)));
document.querySelectorAll("[data-go]").forEach(b => b.addEventListener("click", () => showPage(b.dataset.go)));
document.querySelectorAll("[data-close]").forEach(b => b.addEventListener("click", () => b.closest(".modal").classList.add("hidden")));
document.querySelectorAll(".modal").forEach(m => m.addEventListener("click", e => { if (e.target === m) m.classList.add("hidden"); }));

function openAuth(mode = "login") {
  $("#authError").textContent = ""; robloxCandidate = null; robloxChallengeId = null;
  $("#robloxStep1").classList.remove("hidden"); $("#robloxStep2").classList.add("hidden"); $("#robloxStep3").classList.add("hidden");
  $("#robloxLookupName").value = ""; $("#authModal").classList.remove("hidden");
}
$("#accountButton").addEventListener("click", () => {
  if (!me) return openAuth("login");
  $("#profileName").textContent = me.displayName || me.username; $("#profileBalance").textContent = me.credits.toLocaleString() + " demo credits";
  $("#profileAvatar").replaceChildren();
  if (me.avatarUrl) { const img = document.createElement("img"); img.src = me.avatarUrl; img.alt = "Roblox avatar"; $("#profileAvatar").append(img); }
  $("#profileAvatar").classList.toggle("hidden", !me.avatarUrl);
  $("#profileRoblox").textContent = me.roblox ? "✓ Verified Roblox: @" + me.roblox : "No verified Roblox account"; $("#profileMessage").textContent = "";
  $("#profileModal").classList.remove("hidden");
  loadAccountActivity();
});
$("#logout").addEventListener("click", async () => { await api("/api/logout", { method: "POST", body: "{}" }); updateUser(null); $("#profileModal").classList.add("hidden"); toast("Logged out."); });
$("#dailyClaim").addEventListener("click", async () => {
  try { const data = await api("/api/daily", { method: "POST", body: "{}" }); updateUser(data.user); $("#profileBalance").textContent = me.credits.toLocaleString() + " demo credits"; toast("Daily bonus claimed: +1,000!"); }
  catch (e) { toast(e.message); }
});


$("#robloxLookup").addEventListener("click", async () => {
  $("#authError").textContent = "";
  const username = $("#robloxLookupName").value.trim();
  $("#robloxLookup").disabled = true; $("#robloxLookup").textContent = "Looking up...";
  try {
    const data = await api("/api/roblox/lookup", { method: "POST", body: JSON.stringify({ username }) });
    robloxCandidate = data.profile;
    $("#robloxPreview").innerHTML = (robloxCandidate.avatarUrl ? '<img src="' + escapeAttr(robloxCandidate.avatarUrl) + '" alt="Roblox avatar">' : '<div class="avatar-placeholder">R</div>') + '<div><b>' + escapeHtml(robloxCandidate.displayName) + '</b><span>@' + escapeHtml(robloxCandidate.username) + '</span><small>Roblox ID: ' + escapeHtml(robloxCandidate.userId) + '</small></div>';
    $("#robloxStep1").classList.add("hidden"); $("#robloxStep2").classList.remove("hidden");
    if (data.alreadyLinked) $("#authError").textContent = "This account is already linked. Confirm it to sign in.";
  } catch (e) { $("#authError").textContent = e.message; }
  finally { $("#robloxLookup").disabled = false; $("#robloxLookup").textContent = "Find my account"; }
});
$("#robloxBack").addEventListener("click", () => { $("#robloxStep2").classList.add("hidden"); $("#robloxStep1").classList.remove("hidden"); $("#authError").textContent = ""; });
$("#robloxConfirm").addEventListener("click", async () => {
  if (!robloxCandidate) return;
  $("#authError").textContent = ""; $("#robloxConfirm").disabled = true;
  try {
    const data = await api("/api/roblox/verify/start", { method: "POST", body: JSON.stringify({ username: robloxCandidate.username, userId: robloxCandidate.userId }) });
    robloxChallengeId = data.challengeId; $("#robloxPhrase").textContent = data.phrase;
    $("#robloxStep2").classList.add("hidden"); $("#robloxStep3").classList.remove("hidden");
  } catch (e) { $("#authError").textContent = e.message; }
  finally { $("#robloxConfirm").disabled = false; }
});
$("#copyRobloxPhrase").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText($("#robloxPhrase").textContent); toast("Verification code copied."); }
  catch { toast("Select and copy the code manually."); }
});
$("#robloxVerify").addEventListener("click", async () => {
  if (!robloxChallengeId) return;
  $("#robloxVerify").disabled = true; $("#authError").textContent = "";
  try {
    const data = await api("/api/roblox/verify/check", { method: "POST", body: JSON.stringify({ challengeId: robloxChallengeId }) });
    updateUser(data.user); $("#authModal").classList.add("hidden"); toast("Roblox verified. Welcome to Bloxygu!");
  } catch (e) { $("#authError").textContent = e.message; }
  finally { $("#robloxVerify").disabled = false; }
});
$("#robloxRestart").addEventListener("click", () => { robloxCandidate = null; robloxChallengeId = null; $("#robloxStep3").classList.add("hidden"); $("#robloxStep1").classList.remove("hidden"); $("#authError").textContent = ""; });



const DICE_COLORS = ["orange","yellow","blue","purple"];
const colorLabel = c => c[0].toUpperCase()+c.slice(1);
function renderDuelColorPicker() {
  return '<div class="duel-picker"><div><b>Choose your two colours</b><small>Pick exactly two. Your opponent gets the other two.</small></div><div class="duel-color-options">' + DICE_COLORS.map(c => '<button class="duel-color ' + (duelColors.includes(c) ? "picked " : "") + c + '" data-duel-color="' + c + '"><i></i>' + colorLabel(c) + (duelColors.includes(c) ? ' ✓' : '') + '</button>').join("") + '</div><label class="control-label">Demo wager</label><input id="duelBet" class="field" type="number" min="10" max="5000" value="100"></div>';
}
function bindDuelColorPicker(host) {
  host.querySelectorAll("[data-duel-color]").forEach(button => button.addEventListener("click", () => {
    const color = button.dataset.duelColor;
    if (duelColors.includes(color)) duelColors = duelColors.filter(c => c !== color);
    else if (duelColors.length < 2) duelColors.push(color);
    else { toast("You can select exactly two colours."); return; }
    loadDemoBots();
  }));
}
async function loadDemoBots() {
  const host = $("#botArena");
  if (!host) return;
  if (botMatch) return renderBotMatch();
  try {
    const data = await api("/api/arcade/bots");
    const diceBots = data.bots.filter(b => b.game === "dice");
    const otherBots = data.bots.filter(b => b.game !== "dice");
    host.innerHTML = renderDuelColorPicker() + '<div class="bot-lobby-heading"><b>Waiting opponents</b><span>' + diceBots.length + ' available</span></div>' + (diceBots.length ? diceBots.map(bot => '<article class="bot-card duel-lobby-card"><div class="bot-avatar">🐱</div><div class="bot-meta"><b>' + escapeHtml(bot.name) + ' <span class="demo-tag">DEMO BOT</span></b><small>Color Dice · First to 2 · Waiting for player</small><div class="mini-color-row">' + DICE_COLORS.map(c => '<i class="mini-color ' + c + '"></i>').join("") + '</div></div><button class="button button-primary bot-join" data-bot-join="' + escapeAttr(bot.id) + '">Join duel</button></article>').join("") : '<div class="empty-state"><span>🎲</span><b>No opponents waiting.</b><small>An admin can launch a demo opponent from the control room.</small></div>') + (otherBots.length ? '<div class="small-note">Other practice bots: ' + otherBots.map(b=>escapeHtml(b.name)).join(", ") + '</div>' : '');
    bindDuelColorPicker(host);
    host.querySelectorAll("[data-bot-join]").forEach(button => button.addEventListener("click", () => joinDemoBot(button.dataset.botJoin)));
  } catch (e) { host.textContent = e.message; }
}
async function joinDemoBot(id) {
  if (!me) return openAuth("login");
  if (duelColors.length !== 2) return toast("Choose exactly two colours first.");
  const bet = Number($("#duelBet")?.value || 100);
  try {
    const data = await api("/api/arcade/bots/" + encodeURIComponent(id) + "/join", { method: "POST", body: JSON.stringify({ colors: duelColors, bet }) });
    updateUser(data.user); botMatch = data.match; renderBotMatch("The duel is ready. Roll four dice!");
  } catch (e) { toast(e.message); loadDemoBots(); }
}
function colorPet(c, label) {
  const face = {orange:"🐱",yellow:"🐱",blue:"🐱",purple:"🐱"}[c] || "🐾";
  return '<span class="pet-die ' + c + '" title="' + label + '"><span>' + face + '</span></span>';
}
function renderBotMatch(message = "Ready to roll?") {
  const host = $("#botArena");
  if (!botMatch) return loadDemoBots();
  const history = botMatch.history || [];
  const done = botMatch.status === "completed";
  const winnerText = botMatch.winner === "player" ? "YOU WIN" : botMatch.winner === "bot" ? "BOT WINS" : "DRAW";
  host.innerHTML = '<div class="duel-match"><div class="duel-brand"><span>🐱</span><b>BLOXYGU</b><em>COLOR DICE</em><button id="leaveBotMatch" aria-label="Close duel">×</button></div><div class="duel-first">FIRST TO 2 <span>·</span> ROUND ' + Math.max(1,botMatch.rounds) + '</div><div class="duel-players"><div class="duel-player you"><div class="duel-pet-stack">' + botMatch.playerColors.map(c=>colorPet(c,"Your colour")).join("") + '</div><span class="player-tag">PLAYER 1</span><b>' + escapeHtml(me?.displayName || me?.username || "You") + '</b><div class="duel-swatches">' + botMatch.playerColors.map(c=>'<i class="mini-color '+c+'"></i>').join("") + '</div><strong>◆ ' + Number(botMatch.bet||0).toLocaleString() + '</strong></div><div class="duel-score"><small>YOU <span>VS</span> BOT</small><b>' + botMatch.playerScore + '<i>:</i>' + botMatch.botScore + '</b><small>FIRST TO 2</small></div><div class="duel-player opponent"><div class="duel-pet-stack">' + botMatch.botColors.map(c=>colorPet(c,"Bot colour")).join("") + '</div><span class="player-tag">PLAYER 2 · BOT</span><b>' + escapeHtml(botMatch.name) + '</b><div class="duel-swatches">' + botMatch.botColors.map(c=>'<i class="mini-color '+c+'"></i>').join("") + '</div><strong>DEMO OPPONENT</strong></div></div><div class="dice-stage"><div class="dice-stage-label">FOUR DICE <span>·</span> TIES RE-ROLL</div><div id="duelDice" class="duel-dice">' + (history[0]?.dice || ["?","?","?","?"]).map(c=>'<div class="dice-cube '+(DICE_COLORS.includes(c)?c:"")+'"><span>'+(DICE_COLORS.includes(c)?"🐱":"?")+'</span></div>').join("") + '</div><div id="duelRoundMessage" class="duel-round-message">' + escapeHtml(message) + '</div></div>' + (done ? '<div class="duel-victory ' + botMatch.winner + '"><b>' + winnerText + '</b><span>' + (botMatch.winner === "player" ? "◆ " + Number(botMatch.payout||0).toLocaleString() + " demo credits returned" : botMatch.winner === "draw" ? "Your demo wager was refunded" : "Better luck on the next duel") + '</span></div>' : '<button id="rollDuel" class="button button-primary full duel-roll">🎲 Roll four dice</button>') + '<div class="duel-history"><div class="duel-history-title">ROUND HISTORY <span>' + history.length + ' ROUNDS</span></div>' + (history.length ? history.map(r=>'<div class="duel-history-row"><b>R'+r.number+'</b><span class="history-dice">'+r.dice.map(c=>'<i class="mini-color '+c+'"></i>').join("")+'</span><span>'+(r.outcome==="player"?"YOU WON":r.outcome==="bot"?"BOT WON":"DRAW")+'</span><strong>'+r.playerHits+' : '+r.botHits+'</strong></div>').join("") : '<p class="small-note">Your first roll is waiting.</p>') + '</div><div class="duel-pot-note">DEMO CREDITS ONLY · NO REAL ITEMS · FIRST TO 2 ROUND WINS</div></div>';
  $("#leaveBotMatch").addEventListener("click", async () => {
    try { const data=await api("/api/arcade/bots/" + encodeURIComponent(botMatch.id) + "/leave", { method: "POST", body: "{}" }); if(data.user) updateUser(data.user); } catch {}
    botMatch = null; loadDemoBots();
  });
  $("#rollDuel")?.addEventListener("click", playBotRound);
}
const wait = ms => new Promise(resolve => setTimeout(resolve,ms));
async function playBotRound() {
  if (!botMatch) return;
  const button=$("#rollDuel"); if(button) {button.disabled=true;button.textContent="Rolling...";}
  const host=$("#duelDice");
  if(host){host.innerHTML=Array.from({length:4},()=>'<div class="dice-cube rolling"><span>🐱</span></div>').join("");}
  let data;
  try { data=await api("/api/arcade/bots/" + encodeURIComponent(botMatch.id) + "/round", { method: "POST", body: "{}" }); }
  catch(e){toast(e.message);if(button){button.disabled=false;button.textContent="🎲 Roll four dice";}return;}
  await wait(1350);
  botMatch=data.match; if(data.user) updateUser(data.user);
  const outcome=data.round.outcome;
  const note=outcome==="player"?"ROUND WON — more of your colours!":outcome==="bot"?"BOT TAKES THE ROUND": "ROUND DRAW";
  renderBotMatch(note + " · " + data.round.playerHits + " vs " + data.round.botHits + " matching dice");
  if(data.winner) toast(data.winner==="player"?"DUEL WON!":data.winner==="bot"?"Bot won the duel.":"Draw — wager refunded.");
}
async function loadAdminOverview() {
  if (!me?.isAdmin) { toast("Admin access is restricted."); showPage("home"); return; }
  try {
    const data = await api("/api/admin/overview");
    $("#adminStats").innerHTML = [['Players',data.stats.users],['Demo credits',Number(data.stats.demoCredits).toLocaleString()],['Pending requests',data.stats.pendingRequests],['Bot lobbies',data.stats.botLobbies]].map(x => '<div class="admin-stat"><small>' + x[0] + '</small><b>' + x[1] + '</b></div>').join("");
    $("#adminBots").innerHTML = data.bots.length ? data.bots.map(bot => '<div class="admin-row"><span><b>' + escapeHtml(bot.name) + '</b><small>' + escapeHtml(bot.game) + ' · ' + escapeHtml(bot.status) + '</small></span><span class="admin-actions"><button class="text-button" data-bot-action="' + (bot.status === "stopped" ? "start" : "stop") + '" data-bot-id="' + escapeAttr(bot.id) + '">' + (bot.status === "stopped" ? "Start" : "Stop") + '</button><button class="text-button danger-text" data-bot-action="delete" data-bot-id="' + escapeAttr(bot.id) + '">Delete</button></span></div>').join("") : '<p class="muted">No bots created yet.</p>';
    $("#adminRequests").innerHTML = data.requests.length ? data.requests.map(item => '<div class="admin-row"><span><b>' + escapeHtml(item.username) + ' · ' + escapeHtml(item.kind) + '</b><small>' + escapeHtml(item.details) + ' · ' + escapeHtml(item.status) + '</small></span><span class="admin-actions"><select class="field admin-status" data-request-id="' + escapeAttr(item.id) + '"><option ' + (item.status==="pending"?"selected":"") + '>pending</option><option ' + (item.status==="approved"?"selected":"") + '>approved</option><option ' + (item.status==="rejected"?"selected":"") + '>rejected</option><option ' + (item.status==="completed"?"selected":"") + '>completed</option></select></span></div>').join("") : '<p class="muted">No manual requests.</p>';
    $("#adminUsers").innerHTML = data.users.length ? data.users.map(u => '<div class="admin-row"><span><b>' + escapeHtml(u.username) + '</b><small>' + (u.roblox ? '@' + escapeHtml(u.roblox) : 'Roblox not linked') + ' · ' + new Date(u.createdAt).toLocaleDateString() + '</small></span><b>' + Number(u.credits).toLocaleString() + ' demo</b></div>').join("") : '<p class="muted">No accounts yet.</p>';
    $("#adminBots").querySelectorAll("[data-bot-action]").forEach(button => button.addEventListener("click", async () => {
      const action = button.dataset.botAction, id = button.dataset.botId;
      try {
        if (action === "delete") await api("/api/admin/bots/" + encodeURIComponent(id), { method: "DELETE" });
        else await api("/api/admin/bots/" + encodeURIComponent(id) + "/" + action, { method: "POST", body: "{}" });
        loadAdminOverview(); loadDemoBots();
      } catch (e) { toast(e.message); }
    }));
    $("#adminRequests").querySelectorAll("[data-request-id]").forEach(select => select.addEventListener("change", async () => {
      try { await api("/api/admin/requests/" + encodeURIComponent(select.dataset.requestId) + "/status", { method: "POST", body: JSON.stringify({ status: select.value }) }); toast("Request status updated. No item was transferred."); }
      catch (e) { toast(e.message); }
    }));
  } catch (e) { $("#adminNotice").textContent = e.message; }
}
$("#createBot")?.addEventListener("click", async () => {
  try {
    await api("/api/admin/bots", { method: "POST", body: JSON.stringify({ name: $("#botName").value, game: $("#botGame").value, style: $("#botStyle").value }) });
    toast("Demo bot is waiting in the public arena."); loadAdminOverview(); loadDemoBots();
  } catch (e) { toast(e.message); }
});
$("#refreshBots")?.addEventListener("click", loadDemoBots);
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
  $("#petGrid").innerHTML = items.slice(0, petLimit).map(p => {
    const image = (variant === "Golden" || variant === "Shiny Golden") && p.goldenImage ? p.goldenImage : p.image;
    const variantLabel = variant === "all" ? (p.variantsKnown ? (p.variants.length ? p.variants.join(" · ") : "No variant records") : "Variant data unavailable") : variant;
    return '<article class="pet-card"><div class="pet-image">' + (image ? '<img loading="lazy" src="' + escapeAttr(image) + '" alt="' + escapeAttr(p.name) + '">' : '<span>🐾</span>') + '</div><div class="pet-name">' + escapeHtml(p.name) + '</div><div class="pet-type">' + escapeHtml(p.type) + (p.rarity ? ' · ' + escapeHtml(p.rarity) : '') + '</div><div class="pet-type">' + escapeHtml(variantLabel) + '</div></article>';
  }).join("") || '<p class="muted">No pets found.</p>';
  const more = $("#loadMorePets");
  more.classList.toggle("hidden", items.length <= petLimit);
  more.textContent = "Load more pets (" + Math.min(petLimit, items.length) + "/" + items.length + ")";
  $("#petGrid").querySelectorAll("img").forEach(img => img.addEventListener("error", () => { img.parentElement.textContent = "🐾"; }, { once: true }));
}
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c])); }
function escapeAttr(s) { return escapeHtml(s); }
$("#petSearch").addEventListener("input", () => { petLimit = 60; renderPets(); });
$("#petType").addEventListener("change", () => { petLimit = 60; renderPets(); });
$("#petVariant").addEventListener("change", () => { petLimit = 60; renderPets(); });
$("#loadMorePets").addEventListener("click", () => { petLimit += 60; renderPets(); });

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

async function pickMineTile(tile, button) {
  if (!activeMines || button.disabled) return;
  button.disabled = true;
  try {
    const data = await api("/api/mines/pick", { method: "POST", body: JSON.stringify({ tile }) });
    if (data.hit) {
      activeMines = false;
      $("#gameOptions").querySelectorAll(".mine-tile").forEach((b,i) => {
        b.disabled = true;
        if (data.mines.includes(i)) b.textContent = "✹";
        else if (Number(b.dataset.tile) === tile) b.textContent = "✕";
      });
      $("#gameResult").textContent = "BOOM — mine hit. Your bet is lost.";
      $("#playGame").textContent = "Play round";
    } else {
      button.textContent = "✓"; button.classList.add("safe");
      $("#gameResult").textContent = data.safePicks + " safe picks · " + data.multiplier + "× current cashout";
    }
  } catch (e) { button.disabled = false; toast(e.message); }
}
async function loadRecentWins() {
  try {
    const data = await api("/api/recent-wins");
    $("#recentWins").innerHTML = data.wins.length ? data.wins.map(w => '<div class="recent-win"><span class="recent-game">' + escapeHtml(w.game) + '<small>' + escapeHtml(w.username) + ' · ' + new Date(w.createdAt).toLocaleString() + '</small></span><b>+' + Number(w.amount).toLocaleString() + ' <small>demo credits</small></b></div>').join("") : '<p class="muted">No wins yet. Be the first to play.</p>';
  } catch (e) { $("#recentWins").textContent = e.message; }
}
async function loadLeaderboard() {
  try {
    const data = await api("/api/leaderboard");
    $("#leaderboard").innerHTML = data.users.map((u, i) => '<div class="leader-row"><span class="rank">#' + (i + 1) + '</span><span class="leader-name">' + escapeHtml(u.username) + '</span><span class="leader-score">◆ ' + u.credits.toLocaleString() + '</span></div>').join("") || "No players yet.";
  } catch (e) { $("#leaderboard").textContent = e.message; }
}
const gameInfo = {
  dice: ["Color Dice Duel", "Choose two colours, challenge an opponent, and race to two round wins."],
  coinflip: ["Coinflip", "Call heads or tails. Correct calls pay 2×."],
  mines: ["Mines", "Pick safe tiles, avoid hidden mines, and cash out before you hit one."],
  upgrader: ["Upgrader", "Choose a multiplier. Higher targets have lower win chances."],
  blackjack: ["Blackjack", "Beat the dealer. Blackjack pays 3:2; dealer stands on 17."]
};
function setGame(game) {
  if (activeMines || activeBlackjack) { toast("Finish your current round before switching games."); return; }
  currentGame = game; if (game === "coinflip") selectedChoice = "heads"; if (game === "dice") selectedChoice = "red"; document.querySelectorAll(".game-tab").forEach(b => b.classList.toggle("active", b.dataset.game === game));
  const duelMode = game === "dice";
  document.querySelector(".game-panel").classList.toggle("hidden", duelMode);
  $("#botArena").parentElement.classList.toggle("hidden", !duelMode);
  $("#gameTitle").textContent = gameInfo[game][0]; $("#gameDescription").textContent = gameInfo[game][1];
  $("#gameResult").textContent = "Place a demo bet to play.";
  const opts = $("#gameOptions");
  if (game === "dice") opts.innerHTML = ["red","blue","green","purple"].map(c => '<button class="choice ' + (selectedChoice === c ? "selected" : "") + '" data-choice="' + c + '">' + c[0].toUpperCase() + c.slice(1) + '</button>').join("");
  if (game === "coinflip") opts.innerHTML = '<button class="choice selected" data-choice="heads">Heads</button><button class="choice" data-choice="tails">Tails</button>';
  $("#playGame").textContent = "Play round";
  if (game === "mines") opts.innerHTML = '<label class="control-label">Mine count</label><input id="mineCount" class="field" type="number" min="1" max="24" value="3"><p class="small-note">Pick safe tiles, then cash out.</p>';
  if (game === "upgrader") opts.innerHTML = '<label class="control-label">Target multiplier</label><input id="targetMultiplier" class="field" type="number" min="1.1" max="10" step=".1" value="2">';
  if (game === "blackjack") opts.innerHTML = '<p class="small-note">Hit to draw another card or stand to let the dealer play. Blackjack pays 3:2.</p>';
  opts.querySelectorAll("[data-choice]").forEach(b => b.addEventListener("click", () => { selectedChoice = b.dataset.choice; opts.querySelectorAll(".choice").forEach(x => x.classList.toggle("selected", x === b)); }));
  $("#gameDisplay").innerHTML = '<div class="dice-face">' + (game === "coinflip" ? "◐" : game === "mines" ? "✹" : game === "upgrader" ? "↑" : game === "blackjack" ? "21" : "?") + '</div>';
}
document.querySelectorAll(".game-tab").forEach(b => b.addEventListener("click", () => setGame(b.dataset.game)));
$("#playGame").addEventListener("click", async () => {
  if (!me) return openAuth("login");
  if (currentGame === "blackjack" && activeBlackjack) return playBlackjackAction("stand");
  if (currentGame === "mines" && activeMines) {
    try {
      const data = await api("/api/mines/cashout", { method: "POST", body: "{}" });
      updateUser(data.user); activeMines = false;
      $("#gameResult").textContent = "CASHED OUT +" + data.payout.toLocaleString() + " demo credits · " + data.multiplier + "×";
      $("#gameDisplay").innerHTML = '<div class="dice-face">✓</div>';
      $("#gameOptions").innerHTML = '<p class="small-note">Round finished. Start another round when ready.</p>';
      $("#playGame").textContent = "Play round";
    } catch (e) { toast(e.message); }
    return;
  }
  const bet = Number($("#bet").value);
  if (currentGame === "mines") {
    $("#playGame").disabled = true;
    try {
      const data = await api("/api/mines/start", { method: "POST", body: JSON.stringify({ bet, mines: Number($("#mineCount").value) }) });
      updateUser(data.user); activeMines = true;
      $("#gameResult").textContent = "Round started. Pick a tile.";
      $("#gameOptions").innerHTML = '<div class="mine-board">' + Array.from({length:25},(_,i)=>'<button class="mine-tile" data-tile="' + i + '">?</button>').join("") + '</div>';
      $("#gameOptions").querySelectorAll("[data-tile]").forEach(btn => btn.addEventListener("click", () => pickMineTile(Number(btn.dataset.tile), btn)));
      $("#playGame").textContent = "Cash out";
    } catch (e) { toast(e.message); }
    finally { $("#playGame").disabled = false; }
    return;
  }
  if (currentGame === "blackjack") return startBlackjack(bet);
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

function showBlackjack(round) {
  const cardText = card => card.hidden ? "🂠" : card.rank + card.suit;
  $("#gameDisplay").innerHTML = '<div class="blackjack-table"><div><small>DEALER</small><div class="playing-cards">' + round.dealer.map(c => '<span class="playing-card">' + cardText(c) + '</span>').join("") + '</div><b>' + (round.dealerValue == null ? "?" : round.dealerValue) + '</b></div><div><small>YOU</small><div class="playing-cards">' + round.player.map(c => '<span class="playing-card">' + cardText(c) + '</span>').join("") + '</div><b>' + round.playerValue + '</b></div></div>';
}
async function startBlackjack(bet) {
  $("#playGame").disabled = true;
  try {
    const data = await api("/api/blackjack/start", { method: "POST", body: JSON.stringify({ bet }) });
    updateUser(data.user); showBlackjack(data.round); activeBlackjack = !data.round.finished;
    if (data.round.finished) { $("#gameResult").textContent = "Natural blackjack! " + data.round.outcome + " · Payout " + data.payout.toLocaleString(); $("#playGame").textContent = "Play again"; }
    else { $("#gameResult").textContent = "Your move — hit or stand."; $("#gameOptions").innerHTML = '<button id="blackjackHit" class="choice selected">Hit</button><button id="blackjackStand" class="choice">Stand</button>'; bindBlackjackButtons(); $("#playGame").textContent = "Stand"; }
  } catch (e) { toast(e.message); }
  finally { $("#playGame").disabled = false; }
}
function bindBlackjackButtons() {
  $("#blackjackHit")?.addEventListener("click", () => playBlackjackAction("hit"));
  $("#blackjackStand")?.addEventListener("click", () => playBlackjackAction("stand"));
}
async function playBlackjackAction(action) {
  const controls = $("#gameOptions").querySelectorAll("button");
  controls.forEach(button => button.disabled = true);
  $("#playGame").disabled = true;
  try {
    const data = await api("/api/blackjack/" + action, { method: "POST", body: "{}" });
    updateUser(data.user); showBlackjack(data.round);
    if (data.round.finished) {
      activeBlackjack = false; $("#gameOptions").innerHTML = '<p class="small-note">Hand finished. Place another bet to play again.</p>';
      $("#gameResult").textContent = "Hand: " + data.round.outcome.toUpperCase() + " · Payout " + Number(data.payout || 0).toLocaleString() + " demo credits";
      $("#playGame").textContent = "Play again";
    } else {
      $("#gameResult").textContent = "Your total: " + data.round.playerValue + " · Hit or stand.";
    }
  } catch (e) { toast(e.message); }
  finally { $("#playGame").disabled = false; $("#gameOptions").querySelectorAll("button").forEach(button => button.disabled = false); }
}

async function init() {
  try { const data = await api("/api/me"); updateUser(data.user); } catch { updateUser(null); }
  setGame("dice");
  loadRecentWins();
  if (me) {
    try {
      const blackjackState = await api("/api/blackjack/state");
      if (blackjackState.active) {
        currentGame = "blackjack"; setGame("blackjack"); activeBlackjack = true; showBlackjack(blackjackState.round);
        $("#gameOptions").innerHTML = '<button id="blackjackHit" class="choice selected">Hit</button><button id="blackjackStand" class="choice">Stand</button>'; bindBlackjackButtons();
        $("#gameResult").textContent = "Your move — hit or stand."; $("#playGame").textContent = "Stand"; showPage("games"); return;
      }
      const state = await api("/api/mines/state");
      if (state.active) {
        setGame("mines"); activeMines = true;
        $("#gameOptions").innerHTML = '<div class="mine-board">' + Array.from({length:25},(_,i)=>'<button class="mine-tile" data-tile="' + i + '">?</button>').join("") + '</div>';
        $("#gameOptions").querySelectorAll("[data-tile]").forEach(btn => {
          const tile = Number(btn.dataset.tile);
          if (state.picks.includes(tile)) { btn.disabled = true; btn.textContent = "✓"; btn.classList.add("safe"); }
          else btn.addEventListener("click", () => pickMineTile(tile, btn));
        });
        $("#gameResult").textContent = state.safePicks + " safe picks · " + state.multiplier + "× current cashout";
        $("#playGame").textContent = "Cash out";
        showPage("games");
      }
    } catch {}
  }
}
init();
