const mongoose = require("mongoose");

const Task = require("../models/Task");
const Event = require("../models/Event");
const GiftAssignment = require("../models/GiftAssignment");
const PersonOccasion = require("../models/PersonOccasion");

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

function normalizeGiftFilter(f) {
  const x = String(f || "all").toLowerCase();
  const allowed = new Set(["all", "no_gift", "planning"]);
  return allowed.has(x) ? x : "all";
}

function asObjectId(id) {
  if (!id) return null;
  return typeof id === "string" ? new mongoose.Types.ObjectId(id) : id;
}

const ToDoController = {
  async index(req, res) {
    try {
      const userIdRaw = req.session.user._id;
      const userIdObj = asObjectId(userIdRaw);

      const months = req.session.user.todoHorizonMonths || 3;
      const giftFilter = normalizeGiftFilter(req.query.giftFilter);

      const now = startOfDay(new Date());
      const until = startOfDay(addMonths(now, months));

      const yearsInRange = [];
      for (let y = now.getFullYear(); y <= until.getFullYear(); y++)
        yearsInRange.push(y);

      const dateTasksOpen = await Task.find({
        createdBy: userIdRaw,
        isDone: false,
        $or: [{ year: { $in: yearsInRange } }, { year: { $exists: false } }],
      })
        .populate({
          path: "personOccasion",
          populate: [{ path: "person" }, { path: "occasion" }],
        })
        .sort({ year: 1, createdAt: 1 });

      const eventsRaw = await Event.find({
        createdBy: userIdRaw,
        status: { $ne: "abgeschlossen" },
        date: { $gte: now, $lte: until },
      })
        .populate({
          path: "personOccasion",
          populate: [{ path: "person" }, { path: "occasion" }],
        })
        .sort({ date: 1 })
        .lean();

      const events = eventsRaw.filter(
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

      const giftTodosAll = events.map((e) => {
        const assignmentCount = countByEventId.get(String(e._id)) || 0;
        const giftState = assignmentCount === 0 ? "no_gift" : "planning";

        return {
          ...e,
          assignmentCount,
          giftState,
          daysUntil: daysUntil(e.date),
        };
      });

      const counts = {
        all: giftTodosAll.length,
        no_gift: giftTodosAll.filter((e) => e.giftState === "no_gift").length,
        planning: giftTodosAll.filter((e) => e.giftState === "planning").length,
      };

      let giftTodos = giftTodosAll;
      if (giftFilter === "no_gift")
        giftTodos = giftTodosAll.filter((e) => e.giftState === "no_gift");
      if (giftFilter === "planning")
        giftTodos = giftTodosAll.filter((e) => e.giftState === "planning");

      giftTodos.sort((a, b) => {
        const da = new Date(a.date).getTime();
        const db = new Date(b.date).getTime();
        if (da !== db) return da - db;

        const sa = a.giftState === "no_gift" ? 1 : 2;
        const sb = b.giftState === "no_gift" ? 1 : 2;
        if (sa !== sb) return sa - sb;

        const nameA =
          `${a.personOccasion.person.name} ${a.personOccasion.occasion.name}`.toLowerCase();
        const nameB =
          `${b.personOccasion.person.name} ${b.personOccasion.occasion.name}`.toLowerCase();
        return nameA.localeCompare(nameB);
      });

      return res.render("todos/index", {
        months,
        dateTasksOpen,
        giftTodos,
        giftFilter,
        counts,
      });
    } catch (err) {
      console.error(err);
      req.session.error = "Fehler beim Laden der To-Dos";
      return res.redirect("/dashboard");
    }
  },
};

module.exports = ToDoController;
