const mongoose = require("mongoose");

const Event = require("../models/Event");
const Person = require("../models/Person");
const Task = require("../models/Task");
const Gift = require("../models/Gift");
const GiftAssignment = require("../models/GiftAssignment");
const PersonOccasion = require("../models/PersonOccasion");

function asObjectId(id) {
  if (!id) return null;
  return typeof id === "string" ? new mongoose.Types.ObjectId(id) : id;
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

function stateOrder(state) {
  if (state === "no_gift") return 1;
  if (state === "planning") return 2;
  return 3;
}

function normalizeEventFilter(f) {
  const x = String(f || "all").toLowerCase();
  const allowed = new Set(["all", "open", "no_gift", "planning", "done"]);
  return allowed.has(x) ? x : "all";
}

const DashboardController = {
  async index(req, res) {
    try {
      const userIdRaw = req.session.user._id;
      const userIdObj = asObjectId(userIdRaw);

      const todoMonths = req.session.user.todoHorizonMonths || 3;
      const eventFilter = normalizeEventFilter(req.query.eventFilter);

      const now = startOfDay(new Date());
      const until = startOfDay(addMonths(now, todoMonths));

      const yearsInRange = [];
      for (let y = now.getFullYear(); y <= until.getFullYear(); y++)
        yearsInRange.push(y);

      const [personCount, giftCount] = await Promise.all([
        Person.countDocuments({ createdBy: userIdRaw }),
        Gift.countDocuments({
          $or: [{ createdBy: userIdRaw }, { isPublic: true }],
        }),
      ]);

      const dateTasksOpen = await Task.find({
        createdBy: userIdRaw,
        isDone: false,
        $or: [{ year: { $in: yearsInRange } }, { year: { $exists: false } }],
      })
        .populate({
          path: "personOccasion",
          populate: [{ path: "person" }, { path: "occasion" }],
        })
        .sort({ createdAt: 1 })
        .lean();

      const dateTasksPreview = dateTasksOpen.slice(0, 5);

      const eventsRaw = await Event.find({
        createdBy: userIdRaw,
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

      const eventsWithState = events.map((e) => {
        const assignmentCount = countByEventId.get(String(e._id)) || 0;

        let giftState = "no_gift";
        if (e.status === "abgeschlossen") giftState = "done";
        else if (assignmentCount > 0) giftState = "planning";

        return {
          ...e,
          assignmentCount,
          giftState,
          daysUntil: daysUntil(e.date),
        };
      });

      const eventCountHorizon = eventsWithState.length;

      const eventCounts = {
        all: eventsWithState.length,
        open: eventsWithState.filter((e) => e.giftState !== "done").length,
        no_gift: eventsWithState.filter((e) => e.giftState === "no_gift")
          .length,
        planning: eventsWithState.filter((e) => e.giftState === "planning")
          .length,
        done: eventsWithState.filter((e) => e.giftState === "done").length,
      };

      let filteredForPreview = eventsWithState;
      if (eventFilter === "open") {
        filteredForPreview = eventsWithState.filter(
          (e) => e.giftState !== "done",
        );
      } else if (eventFilter !== "all") {
        filteredForPreview = eventsWithState.filter(
          (e) => e.giftState === eventFilter,
        );
      }

      const eventsPreview = [...filteredForPreview]
        .sort((a, b) => {
          const da = new Date(a.date).getTime();
          const db = new Date(b.date).getTime();
          if (da !== db) return da - db;

          const sa = stateOrder(a.giftState);
          const sb = stateOrder(b.giftState);
          if (sa !== sb) return sa - sb;

          const nameA =
            `${a.personOccasion.person.name} ${a.personOccasion.occasion.name}`.toLowerCase();
          const nameB =
            `${b.personOccasion.person.name} ${b.personOccasion.occasion.name}`.toLowerCase();
          return nameA.localeCompare(nameB);
        })
        .slice(0, 8);

      return res.render("dashboard", {
        todoMonths,

        personCount,
        eventCountHorizon,
        giftCount,

        dateTasksPreview,
        dateTasksCount: dateTasksOpen.length,

        eventsPreview,
        eventFilter,
        eventCounts,
      });
    } catch (err) {
      console.error(err);
      req.session.error = "Fehler beim Laden des Dashboards";
      return res.render("dashboard", {
        todoMonths: req.session.user?.todoHorizonMonths || 3,
        personCount: 0,
        eventCountHorizon: 0,
        giftCount: 0,
        dateTasksPreview: [],
        dateTasksCount: 0,
        eventsPreview: [],
        eventFilter: "all",
        eventCounts: { all: 0, open: 0, no_gift: 0, planning: 0, done: 0 },
      });
    }
  },
};

module.exports = DashboardController;
