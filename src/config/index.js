const path = require("path");
const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "..", "data");
const DB_FILE = path.join(DATA_DIR, "db.json");
module.exports = { PORT, DATA_DIR, DB_FILE };
