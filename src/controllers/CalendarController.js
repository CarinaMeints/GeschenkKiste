const mongoose = require("mongoose");

const Event = require("../models/Event");
const GiftAssignment = require("../models/GiftAssignment");

const { ensureEventsForYears } = require("../lib/ensureEvents");

function asObjectId(id) {
  if (!id) return null;
  return typeof id === "string" ? new mongoose.Types.ObjectId(id) : id;
}

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfDay(d) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

function toISODateLocal(d) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function getGridRange(year, month1to12) {
  const monthIndex = month1to12 - 1;

  const first = new Date(year, monthIndex, 1);
  const startDayOfWeek = (first.getDay() + 6) % 7;
  const gridStart = new Date(year, monthIndex, 1 - startDayOfWeek);

  const last = new Date(year, monthIndex + 1, 0);
  const endDayOfWeek = (last.getDay() + 6) % 7;
  const gridEnd = new Date(
    year,
    monthIndex,
    last.getDate() + (6 - endDayOfWeek),
  );

  return {
    gridStart: startOfDay(gridStart),
    gridEnd: endOfDay(gridEnd),
  };
}

const CalendarController = {
  async month(req, res) {
    try {
      const userIdRaw = req.session.user._id;
      const userIdObj = asObjectId(userIdRaw);

      const year = parseInt(req.query.year, 10);
      const month = parseInt(req.query.month, 10);

      if (!year || year < 2000 || year > 9999) {
        return res.status(400).json({ error: "invalid_year" });
      }
      if (!month || month < 1 || month > 12) {
        return res.status(400).json({ error: "invalid_month" });
      }

      const { gridStart, gridEnd } = getGridRange(year, month);

      const yearsToEnsure = [
        ...new Set([gridStart.getFullYear(), gridEnd.getFullYear()]),
      ];

      await ensureEventsForYears(userIdRaw, yearsToEnsure);

      const eventsRaw = await Event.find({
        createdBy: userIdRaw,
        date: { $gte: gridStart, $lte: gridEnd },
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

      const payload = events.map((e) => {
        const assignmentCount = countByEventId.get(String(e._id)) || 0;

        let giftState = "no_gift";
        if (e.status === "abgeschlossen") giftState = "done";
        else if (assignmentCount > 0) giftState = "planning";

        return {
          _id: e._id,
          date: e.date,
          status: e.status,
          giftState,
          assignmentCount,
          personOccasion: {
            person: {
              _id: e.personOccasion.person._id,
              name: e.personOccasion.person.name,
            },
            occasion: {
              name: e.personOccasion.occasion.name,
              icon: e.personOccasion.occasion.icon,
            },
          },
        };
      });

      return res.json({
        year,
        month,
        rangeStart: toISODateLocal(gridStart),
        rangeEnd: toISODateLocal(gridEnd),
        events: payload,
      });
    } catch (err) {
      console.error("Calendar month API error:", err);
      return res.status(500).json({ error: "server_error" });
    }
  },
};

module.exports = CalendarController;
