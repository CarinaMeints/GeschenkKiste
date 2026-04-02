const path = require("path");

const ROOT_DIR = path.resolve(__dirname, "..", "..");
const PUBLIC_DIR = path.join(ROOT_DIR, "public");
const VIEWS_DIR = path.join(ROOT_DIR, "views");

module.exports = { ROOT_DIR, PUBLIC_DIR, VIEWS_DIR };
