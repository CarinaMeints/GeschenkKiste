const User = require("../models/User");

function asTrimmedString(v) {
  return typeof v === "string" ? v.trim() : "";
}

function normalizeEmail(v) {
  return asTrimmedString(v).toLowerCase();
}

function sessionRegenerate(req) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => (err ? reject(err) : resolve()));
  });
}

function sessionSave(req) {
  return new Promise((resolve, reject) => {
    req.session.save((err) => (err ? reject(err) : resolve()));
  });
}

function setSessionUser(req, userDoc) {
  // Session bewusst minimal halten
  req.session.user = {
    _id: String(userDoc._id),
    username: String(userDoc.username || ""),
    email: String(userDoc.email || ""),
    todoHorizonMonths: userDoc.todoHorizonMonths ?? 3,
  };
}

const AuthController = {
  // ── GET /register ───────────────────────────────────────────────────────────
  showRegister(req, res) {
    res.render("auth/register");
  },

  async register(req, res) {
    try {
      const username = asTrimmedString(req.body.username);
      const email = normalizeEmail(req.body.email);
      const password =
        typeof req.body.password === "string" ? req.body.password : "";
      const passwordConfirm =
        typeof req.body.passwordConfirm === "string"
          ? req.body.passwordConfirm
          : "";

      if (!username || username.length < 3) {
        req.session.error = "Username muss mindestens 3 Zeichen lang sein";
        return res.redirect("/register");
      }

      if (!email) {
        req.session.error = "Bitte gültige E-Mail-Adresse angeben";
        return res.redirect("/register");
      }

      if (!password || password.length < 6) {
        req.session.error = "Passwort muss mindestens 6 Zeichen lang sein";
        return res.redirect("/register");
      }

      if (password !== passwordConfirm) {
        req.session.error = "Passwörter stimmen nicht überein";
        return res.redirect("/register");
      }

      const user = await User.create({ username, email, password });

      await sessionRegenerate(req);
      setSessionUser(req, user);
      req.session.success = "Registrierung erfolgreich";
      await sessionSave(req);

      return res.redirect("/dashboard");
    } catch (err) {
      console.error(err);
      req.session.error = err?.message || "Registrierung fehlgeschlagen";
      return res.redirect("/register");
    }
  },

  showLogin(req, res) {
    res.render("auth/login");
  },

  async login(req, res) {
    try {
      const email = normalizeEmail(req.body.email);
      const password =
        typeof req.body.password === "string" ? req.body.password : "";

      if (!email || !password) {
        req.session.error = "E-Mail oder Passwort fehlt";
        return res.redirect("/login");
      }

      const user = await User.authenticate(email, password);

      if (!user) {
        req.session.error = "E-Mail oder Passwort falsch";
        return res.redirect("/login");
      }

      await sessionRegenerate(req);
      setSessionUser(req, user);
      req.session.success = "Erfolgreich eingeloggt";
      await sessionSave(req);

      return res.redirect("/dashboard");
    } catch (err) {
      console.error(err);
      req.session.error = "Login fehlgeschlagen";
      return res.redirect("/login");
    }
  },

  logout(req, res) {
    req.session.destroy((err) => {
      if (err) console.error(err);
      res.clearCookie("connect.sid");
      res.redirect("/login");
    });
  },
};

module.exports = AuthController;
