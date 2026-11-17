# Bloxygu

A fan-made Pet Simulator 99 community hub with a live pet catalogue, player accounts, demo-credit arcade games, leaderboard, transaction history, and manual item-request inbox.

## Features

- Responsive mobile-first interface.
- Registration and login with bcrypt password hashing.
- Session cookies stored on disk (sessions may reset when a free host restarts; players can log in again).
- PostgreSQL-backed persistent player data when `DATABASE_URL` is configured; local JSON remains available for development.
- Demo-credit wallet, welcome balance, and daily bonus.
- Color Dice, Coinflip, Upgrader, and server-managed Mines game.
- Pet index loaded from the public BIG Games API, with search and type/variant filters when source metadata is available.
- Leaderboard and per-account transaction history.
- Deposit/withdrawal request submission saved as pending for manual handling.

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

**Persistent storage is mandatory.** If the host deletes local files on redeploy/restart, player accounts, balances, requests, transaction history, and sessions can be lost. Mount a persistent disk before accepting users. For larger traffic, migrate the JSON data store to PostgreSQL.

## GitHub checks

GitHub Actions runs Node syntax checks on pushes and pull requests to \`main\`.

## Important limitations

- All credits are fictional demo credits. They cannot be bought, sold, withdrawn, or redeemed.
- No real-money wagering is implemented.
- Pet values are intentionally not included yet.
- The pet catalogue depends on the public BIG Games API. Some categories, variant flags, and separate variant images may be absent or change upstream; the UI should not invent missing records.
- Deposit/withdrawal forms only create pending requests. They do not connect to Roblox, move pets, or verify ownership.
- A Roblox username saved to a profile is not proof of account ownership. Never request a Roblox password or security cookie.
- Before opening this publicly, configure a persistent data disk, a strong session secret, HTTPS, backups, and operational monitoring. The JSON file store is suitable for a small prototype, not a high-concurrency production service.

Bloxygu is an independent fan project and is not affiliated with Roblox or BIG Games.
