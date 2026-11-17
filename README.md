# Bloxygu

A fan-made Pet Simulator 99 community hub with a live pet catalogue, player accounts, demo-credit arcade games, leaderboard, transaction history, and manual item-request inbox.

## Features

- Responsive mobile-first interface.
- Roblox username lookup, avatar confirmation, and public profile About-code ownership verification. No Roblox password or security cookie is requested.
- PostgreSQL-backed session storage when `DATABASE_URL` is configured; local development uses file-backed sessions.
- PostgreSQL-backed persistent player data when `DATABASE_URL` is configured; local JSON remains available for development.
- Demo-credit wallet, welcome balance, and daily bonus.
- Color Dice, Coinflip, Upgrader, server-managed Mines, and server-managed Blackjack with hit/stand and 3:2 natural blackjack payout.
- Pet index loaded from the public BIG Games API, with search and type/variant filters when source metadata is available.
- Leaderboard, recent wins feed, and per-account transaction history.
- Admin console protected by an explicit allowlist of verified Roblox user IDs.
- Admin-managed demo bot lobbies for Color Dice and Coinflip; opponents wait for a player, play five-round matches, and are clearly labelled as demo bots.
- Manual request inbox for historical requests; new deposit/withdrawal submissions are locked in production.

## Local setup

Requires Node.js 20 or newer.

\`\`\`sh
npm install
npm run check
npm start
\`\`\`

Open http://localhost:3000.

## Required production environment

- \`SESSION_SECRET\`: a long, random secret. The server refuses to start in production without it.
- \`NODE_ENV=production\`
- \`DATA_DIR\`: a writable persistent directory mounted by your host. The JSON database and file-backed sessions are stored here.
- \`PORT\`: supplied by most hosting providers.

**Use PostgreSQL for hosted deployments.** The Render free filesystem is ephemeral; Neon PostgreSQL keeps player accounts, balances, requests, transaction history, and sessions across restarts.

## GitHub checks

GitHub Actions runs Node syntax checks on pushes and pull requests to \`main\`.

## Important limitations

- All credits are fictional demo credits. They cannot be bought, sold, withdrawn, or redeemed.
- No real-money wagering is implemented.
- Pet values are intentionally not included yet.
- The pet catalogue depends on the public BIG Games API. Some categories, variant flags, and separate variant images may be absent or change upstream; the UI should not invent missing records.
- Deposits and withdrawals are locked in production. The admin request-status controls only update labels on any historical/manual records; they do not connect to Roblox, move pets, or verify ownership.
- Demo bot lobbies are simulated opponents for Color Dice and Coinflip only. They do not log into Roblox, control a Roblox account, or place demo-credit wagers. They wait for a signed-in user and play a short head-to-head demo match.
- Roblox ownership is verified by checking for a short-lived random phrase in the public Roblox profile description. Roblox API availability and profile visibility can affect verification.
- Before opening this publicly, configure Neon backups, a strong session secret, HTTPS, and operational monitoring. Production password login and unverified profile linking are disabled; Roblox bio verification is required.

Bloxygu is an independent fan project and is not affiliated with Roblox or BIG Games.
