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

async function flashAndRedirect(req, res, path, { error, success } = {}) {
  if (error) req.session.error = error;
  if (success) req.session.success = success;

  try {
    await sessionSave(req);
  } catch (e) {
    console.error("Session save failed:", e);
  }
  return res.redirect(path);
}

function setSessionUser(req, userDoc) {
  req.session.user = {
    _id: String(userDoc._id),
    username: String(userDoc.username || ""),
    email: String(userDoc.email || ""),
    todoHorizonMonths: userDoc.todoHorizonMonths ?? 3,
  };
}

function isMongoDuplicateKeyError(err) {
  return err && (err.code === 11000 || err.code === 11001);
}

function getDuplicateKeyField(err) {
  const pattern = err?.keyPattern || {};
  const keys = Object.keys(pattern);
  if (keys.length) return keys[0];

  const value = err?.keyValue || {};
  const keys2 = Object.keys(value);
  return keys2.length ? keys2[0] : null;
}

function getFirstMongooseValidationMessage(err) {
  if (!err || err.name !== "ValidationError" || !err.errors) return null;
  const first = Object.values(err.errors)[0];
  return first?.message || "Eingaben sind ungültig";
}

const AuthController = {
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
        return flashAndRedirect(req, res, "/register", {
          error: "Username muss mindestens 3 Zeichen lang sein",
        });
      }

      if (!email) {
        return flashAndRedirect(req, res, "/register", {
          error: "Bitte gültige E-Mail-Adresse angeben",
        });
      }

      if (!password || password.length < 6) {
        return flashAndRedirect(req, res, "/register", {
          error: "Passwort muss mindestens 6 Zeichen lang sein",
        });
      }

      if (password !== passwordConfirm) {
        return flashAndRedirect(req, res, "/register", {
          error: "Passwörter stimmen nicht überein",
        });
      }

      const existing = await User.findOne({
        $or: [{ email }, { username }],
      }).select("_id email username");

      if (existing) {
        if (existing.email === email) {
          return flashAndRedirect(req, res, "/register", {
            error:
              "Ein Account mit dieser E-Mail existiert bereits. Bitte logge dich ein oder nutze eine andere E-Mail.",
          });
        }
        if (existing.username === username) {
          return flashAndRedirect(req, res, "/register", {
            error:
              "Dieser Username ist bereits vergeben. Bitte wähle einen anderen.",
          });
        }
        return flashAndRedirect(req, res, "/register", {
          error: "Account konnte nicht erstellt werden. Bitte Eingaben prüfen.",
        });
      }

      const user = await User.create({ username, email, password });

      await sessionRegenerate(req);
      setSessionUser(req, user);

      return flashAndRedirect(req, res, "/dashboard", {
        success: "Registrierung erfolgreich",
      });
    } catch (err) {
      console.error(err);

      if (isMongoDuplicateKeyError(err)) {
        const field = getDuplicateKeyField(err);

        if (field === "email") {
          return flashAndRedirect(req, res, "/register", {
            error:
              "Ein Account mit dieser E-Mail existiert bereits. Bitte logge dich ein oder nutze eine andere E-Mail.",
          });
        }
        if (field === "username") {
          return flashAndRedirect(req, res, "/register", {
            error:
              "Dieser Username ist bereits vergeben. Bitte wähle einen anderen.",
          });
        }

        return flashAndRedirect(req, res, "/register", {
          error: "Diese Angaben werden bereits verwendet. Bitte ändere sie.",
        });
      }

      const validationMsg = getFirstMongooseValidationMessage(err);
      if (validationMsg) {
        return flashAndRedirect(req, res, "/register", {
          error: validationMsg,
        });
      }

      return flashAndRedirect(req, res, "/register", {
        error: "Registrierung fehlgeschlagen. Bitte versuche es erneut.",
      });
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
        return flashAndRedirect(req, res, "/login", {
          error: "E-Mail oder Passwort fehlt",
        });
      }

      const user = await User.authenticate(email, password);

      if (!user) {
        return flashAndRedirect(req, res, "/login", {
          error: "E-Mail oder Passwort falsch",
        });
      }

      await sessionRegenerate(req);
      setSessionUser(req, user);

      return flashAndRedirect(req, res, "/dashboard", {
        success: "Erfolgreich eingeloggt",
      });
    } catch (err) {
      console.error(err);

      return flashAndRedirect(req, res, "/login", {
        error:
          "Login ist gerade nicht möglich. Bitte versuche es in ein paar Minuten erneut.",
      });
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
