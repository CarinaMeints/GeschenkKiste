const Interest = require("../models/Interest");
const Person = require("../models/Person");
const Gift = require("../models/Gift");

function normalizeIds(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

const InterestController = {
  async index(req, res) {
    try {
      const userId = req.session.user._id;
      const interests = await Interest.findForUser(userId);
      return res.render("interests/index", { interests });
    } catch (err) {
      console.error(err);
      req.session.error = "Fehler beim Laden";
      return res.redirect("/dashboard");
    }
  },

  async options(req, res) {
    try {
      const userId = req.session.user._id;

      const interests = await Interest.find({
        $or: [{ createdBy: userId }, { isPublic: true }],
      })
        .select("_id name icon")
        .sort({ name: 1 })
        .lean();

      return res.json({ interests });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: "server_error" });
    }
  },

  async show(req, res) {
    try {
      const userId = req.session.user._id;

      const interest = await Interest.findOne({
        _id: req.params.id,
        $or: [{ createdBy: userId }, { isPublic: true }],
      }).lean();

      if (!interest) {
        req.session.error = "Interesse nicht gefunden";
        return res.redirect("/interests");
      }

      const canEdit =
        interest.createdBy &&
        String(interest.createdBy) === String(userId) &&
        interest.isPublic !== true;

      const [persons, gifts] = await Promise.all([
        Person.find({ createdBy: userId, interests: interest._id })
          .sort({ name: 1 })
          .lean(),

        Gift.find({
          $or: [{ createdBy: userId }, { isPublic: true }],
          interests: interest._id,
        })
          .sort({ usageCount: -1, createdAt: -1 })
          .lean(),
      ]);

      return res.render("interests/show", {
        interest,
        persons,
        gifts,
        canEdit,
      });
    } catch (err) {
      console.error(err);
      req.session.error = "Fehler beim Laden";
      return res.redirect("/interests");
    }
  },

  async new(req, res) {
    try {
      const userId = req.session.user._id;

      const [persons, gifts] = await Promise.all([
        Person.find({ createdBy: userId }).sort({ name: 1 }).lean(),
        Gift.find({ $or: [{ createdBy: userId }, { isPublic: true }] })
          .sort({ usageCount: -1, createdAt: -1 })
          .lean(),
      ]);

      return res.render("interests/new", { persons, gifts });
    } catch (err) {
      console.error(err);
      req.session.error = "Fehler beim Laden";
      return res.redirect("/interests");
    }
  },

  async create(req, res) {
    try {
      const userId = req.session.user._id;
      const { name, description, icon, isPublic } = req.body;

      const makePublic = isPublic === "true" || isPublic === true;

      const interest = await Interest.create({
        name,
        description,
        icon: icon || "🎁",
        isPublic: makePublic,
        createdBy: userId,
      });

      const personIds = normalizeIds(req.body.personIds);
      if (personIds.length) {
        await Person.updateMany(
          { createdBy: userId, _id: { $in: personIds } },
          { $addToSet: { interests: interest._id } },
        );
      }

      const giftIds = normalizeIds(req.body.giftIds);
      if (giftIds.length) {
        await Gift.updateMany(
          { createdBy: userId, _id: { $in: giftIds } },
          { $addToSet: { interests: interest._id } },
        );
      }

      req.session.success = makePublic
        ? "Interesse als öffentlich angelegt"
        : "Interesse angelegt";
      return res.redirect(`/interests/${interest._id}`);
    } catch (err) {
      console.error(err);
      req.session.error = err.message;
      return res.redirect("/interests/new");
    }
  },

  async edit(req, res) {
    try {
      const userId = req.session.user._id;

      const [interest, persons, gifts] = await Promise.all([
        Interest.findOne({
          _id: req.params.id,
          createdBy: userId,
          isPublic: { $ne: true },
        }).lean(),

        Person.find({ createdBy: userId }).sort({ name: 1 }).lean(),

        Gift.find({ $or: [{ createdBy: userId }, { isPublic: true }] })
          .sort({ usageCount: -1, createdAt: -1 })
          .lean(),
      ]);

      if (!interest) {
        req.session.error =
          "Interesse nicht gefunden oder nicht bearbeitbar (Katalog)";
        return res.redirect("/interests");
      }

      const [assignedPersonIds, assignedGiftIds] = await Promise.all([
        Person.find({ createdBy: userId, interests: interest._id }).distinct(
          "_id",
        ),
        Gift.find({ createdBy: userId, interests: interest._id }).distinct(
          "_id",
        ),
      ]);

      return res.render("interests/edit", {
        interest,
        persons,
        gifts,
        assignedPersonIds: new Set(assignedPersonIds.map(String)),
        assignedGiftIds: new Set(assignedGiftIds.map(String)),
      });
    } catch (err) {
      console.error(err);
      req.session.error = "Fehler beim Laden";
      return res.redirect("/interests");
    }
  },

  async update(req, res) {
    try {
      const userId = req.session.user._id;

      const interest = await Interest.findOne({
        _id: req.params.id,
        createdBy: userId,
        isPublic: { $ne: true },
      });

      if (!interest) {
        req.session.error =
          "Interesse nicht gefunden oder nicht bearbeitbar (Katalog)";
        return res.redirect("/interests");
      }

      const { name, description, icon } = req.body;

      interest.name = name;
      interest.description = description;
      interest.icon = icon || "🎁";
      await interest.save();

      const selectedPersonIds = normalizeIds(req.body.personIds).map(String);

      await Person.updateMany(
        { createdBy: userId },
        { $pull: { interests: interest._id } },
      );

      if (selectedPersonIds.length) {
        await Person.updateMany(
          { createdBy: userId, _id: { $in: selectedPersonIds } },
          { $addToSet: { interests: interest._id } },
        );
      }

      const selectedGiftIds = normalizeIds(req.body.giftIds).map(String);

      await Gift.updateMany(
        { createdBy: userId },
        { $pull: { interests: interest._id } },
      );

      if (selectedGiftIds.length) {
        await Gift.updateMany(
          { createdBy: userId, _id: { $in: selectedGiftIds } },
          { $addToSet: { interests: interest._id } },
        );
      }

      req.session.success = "Gespeichert";
      return res.redirect(`/interests/${interest._id}`);
    } catch (err) {
      console.error(err);
      req.session.error = err.message;
      return res.redirect(`/interests/${req.params.id}/edit`);
    }
  },

  async destroy(req, res) {
    try {
      const userId = req.session.user._id;

      const interest = await Interest.findOneAndDelete({
        _id: req.params.id,
        createdBy: userId,
        isPublic: { $ne: true },
      });

      if (!interest) {
        req.session.error =
          "Interesse nicht gefunden oder nicht löschbar (Katalog)";
        return res.redirect("/interests");
      }

      await Promise.all([
        Person.updateMany(
          { createdBy: userId },
          { $pull: { interests: interest._id } },
        ),
        Gift.updateMany(
          { createdBy: userId },
          { $pull: { interests: interest._id } },
        ),
      ]);

      req.session.success = "Interesse gelöscht";
      return res.redirect("/interests");
    } catch (err) {
      console.error(err);
      req.session.error = "Löschen fehlgeschlagen";
      return res.redirect("/interests");
    }
  },
};

module.exports = InterestController;
