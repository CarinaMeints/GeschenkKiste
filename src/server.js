require("dotenv").config();

const express = require("express");
const session = require("express-session");
const MongoStore = require("connect-mongo");
const methodOverride = require("method-override");
const { URL } = require("url");

const helmet = require("helmet");

const connectDB = require("./config/database");
const { startSchedulers } = require("./jobs/scheduler");
const indexRoutes = require("./routes/index");

const { PUBLIC_DIR, VIEWS_DIR } = require("./config/paths");

const app = express();
app.set("trust proxy", true);
app.disable("x-powered-by");

const PORT = process.env.PORT || 3000;

function getValidatedBaseUrl() {
  const raw = String(process.env.APP_BASE_URL || "").trim();
  if (!raw) return null;

  let u;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }

  if (u.protocol !== "http:" && u.protocol !== "https:") return null;

  u.pathname = "";
  u.search = "";
  u.hash = "";

  return u.toString().replace(/\/+$/, "");
}

const VALIDATED_APP_BASE_URL = getValidatedBaseUrl();

if (process.env.NODE_ENV === "production") {
  if (!VALIDATED_APP_BASE_URL) {
    throw new Error(
      "APP_BASE_URL fehlt/ungültig. In production MUSS APP_BASE_URL gesetzt sein (z.B. https://deine-domain.tld).",
    );
  }
  if (!VALIDATED_APP_BASE_URL.startsWith("https://")) {
    console.warn(
      "[SECURITY] APP_BASE_URL ist nicht https. In production sollte APP_BASE_URL https://... sein.",
    );
  }
}

app.use(
  helmet({
    crossOriginEmbedderPolicy: false,
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
    contentSecurityPolicy: {
      reportOnly: process.env.CSP_REPORT_ONLY === "true",
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "https://cdn.jsdelivr.net"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
        imgSrc: ["'self'", "data:", "blob:"],
        connectSrc: ["'self'", "https://cdn.jsdelivr.net"],
        fontSrc: ["'self'", "data:"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        frameAncestors: ["'none'"],
        formAction: ["'self'"],
      },
    },
  }),
);

app.set("view engine", "ejs");
app.set("views", VIEWS_DIR);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(express.static(PUBLIC_DIR));

app.use(
  methodOverride((req) => {
    if (
      req.method === "POST" &&
      req.body &&
      typeof req.body._method === "string"
    ) {
      const m = req.body._method.toUpperCase().trim();
      if (m === "PUT" || m === "PATCH" || m === "DELETE") return m;
    }
    return undefined;
  }),
);

if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI fehlt in .env");
if (!process.env.SESSION_SECRET)
  throw new Error("SESSION_SECRET fehlt in .env");

app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
      mongoUrl: process.env.MONGODB_URI,
      collectionName: "sessions",
      touchAfter: 24 * 3600,
    }),
    cookie: {
      maxAge: 1000 * 60 * 60 * 24 * 7,
      httpOnly: true,
      sameSite: process.env.NODE_ENV === "production" ? "strict" : "lax",
      secure: process.env.NODE_ENV === "production",
    },
  }),
);

function expectedBase(req) {
  return (
    VALIDATED_APP_BASE_URL ||
    `${req.protocol}://${req.get("host")}`.replace(/\/+$/, "")
  );
}

function isSameOrigin(req) {
  const base = expectedBase(req);
  const origin = req.get("origin");
  const referer = req.get("referer");

  if (origin && origin !== "null") return origin === base;

  if (referer)
    return String(referer).startsWith(base + "/") || referer === base;

  if (process.env.NODE_ENV !== "production") return true;

  return false;
}

app.use((req, res, next) => {
  const m = req.method.toUpperCase();
  if (m === "GET" || m === "HEAD" || m === "OPTIONS") return next();

  if (!isSameOrigin(req)) {
    return res.status(403).send("CSRF protection: invalid origin");
  }
  return next();
});

app.use((req, res, next) => {
  res.locals.currentUser = req.session.user || null;
  res.locals.error = req.session.error || null;
  res.locals.success = req.session.success || null;

  delete req.session.error;
  delete req.session.success;
  next();
});

app.use("/", indexRoutes);

app.use((req, res) => {
  res.status(404).render("error", { title: "404" });
});

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).render("error", { title: "Fehler", error: err });
});

(async () => {
  try {
    await connectDB();
    startSchedulers();
    app.listen(PORT, () => {
      console.log(`Server läuft auf http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error("Fehler beim Starten der App:", err);
    process.exit(1);
  }
})();

module.exports = app;
