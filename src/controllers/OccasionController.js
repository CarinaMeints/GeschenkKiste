const mongoose = require("mongoose");

const Occasion = require("../models/Occasion");
const Person = require("../models/Person");
const PersonOccasion = require("../models/PersonOccasion");

const Event = require("../models/Event");
const GiftAssignment = require("../models/GiftAssignment");
const Task = require("../models/Task");

const { invalidateHorizonSync } = require("../middleware/ensureHorizonEvents");

function asObjectId(id) {
  if (!id) return null;
  return typeof id === "string" ? new mongoose.Types.ObjectId(id) : id;
}

function normalizeIds(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function addMonths(date, months) {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

function daysUntil(date) {
  if (!date) return null;
  const today = startOfDay(new Date());
  const d = startOfDay(new Date(date));
  const diff = d.getTime() - today.getTime();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

function deriveGiftState(eventStatus, assignmentCount) {
  if (eventStatus === "abgeschlossen") return "done";
  if (assignmentCount > 0) return "planning";
  return "no_gift";
}

function isMovableOccasion(occasion) {
  const hasFixedDate = occasion.day != null && occasion.month != null;
  const isBirthday = occasion.isBirthday === true;
  return !hasFixedDate && !isBirthday;
}

const OccasionController = {
  async index(req, res) {
    try {
      const occasions = await Occasion.findForUser(req.session.user._id);
      return res.render("occasions/index", { occasions });
    } catch (err) {
      console.error(err);
      req.session.error = "Fehler beim Laden";
      return res.redirect("/dashboard");
    }
  },

  new(req, res) {
    return res.render("occasions/new");
  },

  async show(req, res) {
    try {
      const userId = req.session.user._id;
      const userIdObj = asObjectId(userId);

      const occasion = await Occasion.findOne({
        _id: req.params.id,
        $or: [{ createdBy: userId }, { isPublic: true }],
      }).lean();

      if (!occasion) {
        req.session.error = "Anlass nicht gefunden";
        return res.redirect("/occasions");
      }

      const canEdit =
        occasion.createdBy &&
        String(occasion.createdBy) === String(userId) &&
        !occasion.isPublic;

      const personOccasions = await PersonOccasion.find({
        createdBy: userId,
        occasion: occasion._id,
      })
        .populate("person")
        .sort({ "person.name": 1, createdAt: 1 })
        .lean();

      const personOccasionCount = personOccasions.length;

      const personsAll = await Person.find({ createdBy: userId })
        .sort({ name: 1 })
        .lean();

      const assignedPersonIds = new Set(
        personOccasions
          .map((po) =>
            po.person?._id ? String(po.person._id) : String(po.person),
          )
          .filter(Boolean),
      );

      const horizonMonths = req.session.user.todoHorizonMonths || 3;
      const now = startOfDay(new Date());
      const until = startOfDay(addMonths(now, horizonMonths));

      const poIds = personOccasions.map((po) => po._id);

      const eventsRaw = poIds.length
        ? await Event.find({
            createdBy: userId,
            personOccasion: { $in: poIds },
            date: { $gte: now, $lte: until },
          })
            .populate({
              path: "personOccasion",
              populate: [{ path: "person" }, { path: "occasion" }],
            })
            .sort({ date: 1 })
            .lean()
        : [];

      const events = (eventsRaw || []).filter(
        (e) => e?.personOccasion?.person && e?.personOccasion?.occasion,
      );
      const eventIds = events.map((e) => e._id);

      const countsAgg =
        eventIds.length && userIdObj
          ? await GiftAssignment.aggregate([
              { $match: { createdBy: userIdObj, event: { $in: eventIds } } },
              { $group: { _id: "$event", count: { $sum: 1 } } },
            ])
          : [];

      const countByEventId = new Map(
        countsAgg.map((r) => [String(r._id), r.count]),
      );

      const upcomingEvents = events.map((e) => {
        const assignmentCount = countByEventId.get(String(e._id)) || 0;
        return {
          ...e,
          assignmentCount,
          giftState: deriveGiftState(e.status, assignmentCount),
          daysUntil: daysUntil(e.date),
        };
      });

      return res.render("occasions/show", {
        occasion,
        canEdit,

        personOccasions,
        personOccasionCount,

        personsAll,
        assignedPersonIds,

        horizonMonths,
        upcomingEvents,
      });
    } catch (err) {
      console.error(err);
      req.session.error = "Fehler beim Laden des Anlasses";
      return res.redirect("/occasions");
    }
  },

  async updatePeople(req, res) {
    try {
      const userId = req.session.user._id;

      const occasion = await Occasion.findOne({
        _id: req.params.id,
        $or: [{ createdBy: userId }, { isPublic: true }],
      }).lean();

      if (!occasion) {
        req.session.error = "Anlass nicht gefunden";
        return res.redirect("/occasions");
      }

      const selectedRaw = normalizeIds(req.body.personIds)
        .map(String)
        .map((s) => s.trim())
        .filter(Boolean);

      const selectedUnique = Array.from(new Set(selectedRaw));

      const validPersons = selectedUnique.length
        ? await Person.find({ createdBy: userId, _id: { $in: selectedUnique } })
            .select("_id")
            .lean()
        : [];

      const selectedSet = new Set(validPersons.map((p) => String(p._id)));

      const existingLinks = await PersonOccasion.find({
        createdBy: userId,
        occasion: occasion._id,
      })
        .select("_id person")
        .lean();

      const existingPersonSet = new Set(
        existingLinks.map((l) => String(l.person)),
      );

      const toAdd = Array.from(selectedSet).filter(
        (pid) => !existingPersonSet.has(pid),
      );
      const toRemove = existingLinks
        .filter((l) => !selectedSet.has(String(l.person)))
        .map((l) => String(l.person));

      if (toRemove.length) {
        await PersonOccasion.deleteWithDependents({
          userId,
          filter: { occasion: occasion._id, person: { $in: toRemove } },
        });
      }

      for (const pid of toAdd) {
        const person = await Person.findOne({ _id: pid, createdBy: userId })
          .select("_id")
          .lean();
        if (!person) continue;

        try {
          const startYear = new Date().getFullYear();
          const endYear =
            occasion.isRecurring === false ? startYear : undefined;

          await PersonOccasion.create({
            person: pid,
            occasion: occasion._id,
            createdBy: userId,
            startYear,
            endYear,
          });
        } catch (e) {
          if (e && e.code === 11000) continue;
          throw e;
        }
      }

      invalidateHorizonSync(userId);

      req.session.success = "Personen-Zuordnung gespeichert";
      return res.redirect(`/occasions/${occasion._id}`);
    } catch (err) {
      console.error(err);
      req.session.error = err.message || "Fehler beim Speichern";
      return res.redirect(`/occasions/${req.params.id}`);
    }
  },

  async create(req, res) {
    try {
      const userId = req.session.user._id;

      const { name, description, day, month, isRecurring, icon, isPublic } =
        req.body;

      const makePublic = isPublic === "true" || isPublic === true;

      const doc = await Occasion.create({
        name,
        description,
        day: day ? parseInt(day, 10) : undefined,
        month: month ? parseInt(month, 10) : undefined,
        isRecurring: isRecurring === "true" || isRecurring === true,
        icon: icon || "🎉",
        isPublic: makePublic,
        createdBy: userId,
      });

      req.session.success = makePublic
        ? "Anlass als öffentlich angelegt"
        : "Anlass angelegt";
      return res.redirect(`/occasions/${doc._id}`);
    } catch (err) {
      console.error(err);
      req.session.error = err.message;
      return res.redirect("/occasions/new");
    }
  },

  async edit(req, res) {
    try {
      const userId = req.session.user._id;

      const occasion = await Occasion.findOne({
        _id: req.params.id,
        createdBy: userId,
        isPublic: { $ne: true },
      }).lean();

      if (!occasion) {
        req.session.error =
          "Anlass nicht gefunden oder nicht bearbeitbar (Katalog)";
        return res.redirect("/occasions");
      }

      const [persons, assignedPersonIds] = await Promise.all([
        Person.find({ createdBy: userId }).sort({ name: 1 }).lean(),
        PersonOccasion.find({
          createdBy: userId,
          occasion: occasion._id,
        }).distinct("person"),
      ]);

      return res.render("occasions/edit", {
        occasion,
        persons,
        assignedPersonIds: new Set(assignedPersonIds.map(String)),
      });
    } catch (err) {
      console.error(err);
      req.session.error = "Fehler beim Laden";
      return res.redirect("/occasions");
    }
  },

  async update(req, res) {
    try {
      const userId = req.session.user._id;

      const occasion = await Occasion.findOne({
        _id: req.params.id,
        createdBy: userId,
        isPublic: { $ne: true },
      });

      if (!occasion) {
        req.session.error =
          "Anlass nicht gefunden oder nicht bearbeitbar (Katalog)";
        return res.redirect("/occasions");
      }

      const { name, description, day, month, isRecurring, icon } = req.body;

      occasion.name = name;
      occasion.description = description;
      occasion.day = day ? parseInt(day, 10) : undefined;
      occasion.month = month ? parseInt(month, 10) : undefined;
      occasion.isRecurring = isRecurring === "true" || isRecurring === true;
      occasion.icon = icon || "🎉";

      await occasion.save();

      const selectedRaw = normalizeIds(req.body.personIds)
        .map(String)
        .map((s) => s.trim())
        .filter(Boolean);

      const validPersons = selectedRaw.length
        ? await Person.find({ createdBy: userId, _id: { $in: selectedRaw } })
            .select("_id")
            .lean()
        : [];

      const selectedSet = new Set(validPersons.map((p) => String(p._id)));

      const existingLinks = await PersonOccasion.find({
        createdBy: userId,
        occasion: occasion._id,
      })
        .select("_id person")
        .lean();

      const existingPersonSet = new Set(
        existingLinks.map((l) => String(l.person)),
      );

      const toAdd = Array.from(selectedSet).filter(
        (pid) => !existingPersonSet.has(pid),
      );
      const toRemove = existingLinks
        .filter((l) => !selectedSet.has(String(l.person)))
        .map((l) => String(l.person));

      if (toRemove.length) {
        await PersonOccasion.deleteWithDependents({
          userId,
          filter: { occasion: occasion._id, person: { $in: toRemove } },
        });
      }

      for (const pid of toAdd) {
        try {
          const startYear = new Date().getFullYear();
          const endYear =
            occasion.isRecurring === false ? startYear : undefined;

          await PersonOccasion.create({
            person: pid,
            occasion: occasion._id,
            createdBy: userId,
            startYear,
            endYear,
          });
        } catch (e) {
          if (e && e.code === 11000) continue;
          throw e;
        }
      }

      invalidateHorizonSync(userId);

      req.session.success = "Gespeichert";
      return res.redirect(`/occasions/${occasion._id}`);
    } catch (err) {
      console.error(err);
      req.session.error = err.message || "Fehler beim Speichern";
      return res.redirect(`/occasions/${req.params.id}/edit`);
    }
  },

  async destroy(req, res) {
    try {
      const userId = req.session.user._id;

      const occasion = await Occasion.findOneAndDelete({
        _id: req.params.id,
        createdBy: userId,
        isPublic: { $ne: true },
      });

      if (!occasion) {
        req.session.error =
          "Anlass nicht gefunden oder nicht löschbar (Katalog)";
        return res.redirect("/occasions");
      }

      req.session.success = "Anlass gelöscht";
      return res.redirect("/occasions");
    } catch (err) {
      console.error(err);
      req.session.error = "Löschen fehlgeschlagen";
      return res.redirect("/occasions");
    }
  },
};

module.exports = OccasionController;
