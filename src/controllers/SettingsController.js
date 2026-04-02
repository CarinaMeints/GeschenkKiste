const User = require("../models/User");
const { invalidateHorizonSync } = require("../middleware/ensureHorizonEvents");

const ALLOWED = [1, 2, 3, 4, 6, 9, 12];

const SettingsController = {
  async index(req, res) {
    try {
      const userId = req.session.user._id;

      const user = await User.findById(userId);
      if (!user) {
        req.session.error = "User nicht gefunden";
        return res.redirect("/dashboard");
      }

      return res.render("settings/index", {
        todoHorizonMonths: user.todoHorizonMonths ?? 3,
        allowedOptions: ALLOWED,
      });
    } catch (err) {
      console.error(err);
      req.session.error = "Fehler beim Laden der Einstellungen";
      return res.redirect("/dashboard");
    }
  },

  async update(req, res) {
    try {
      const userId = req.session.user._id;
      const todoHorizonMonths = parseInt(req.body.todoHorizonMonths, 10);

      if (!ALLOWED.includes(todoHorizonMonths)) {
        req.session.error = "Ungültige Auswahl";
        return res.redirect("/settings");
      }

      const user = await User.findById(userId);
      if (!user) {
        req.session.error = "User nicht gefunden";
        return res.redirect("/dashboard");
      }

      user.todoHorizonMonths = todoHorizonMonths;
      await user.save();
      invalidateHorizonSync(userId);

      req.session.user.todoHorizonMonths = todoHorizonMonths;

      req.session.success = "Einstellungen gespeichert";
      return res.redirect("/settings");
    } catch (err) {
      console.error(err);
      req.session.error = "Speichern fehlgeschlagen";
      return res.redirect("/settings");
    }
  },
};

module.exports = SettingsController;
