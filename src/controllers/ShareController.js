const ShareToken = require("../models/ShareToken");
const Event = require("../models/Event");
const Person = require("../models/Person");
const GiftAssignment = require("../models/GiftAssignment");
const PersonOccasion = require("../models/PersonOccasion");
const Interest = require("../models/Interest");
const { URL } = require("url");

function getValidatedBaseUrlFromEnv() {
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

function getBaseUrl(req) {
  const envBase = getValidatedBaseUrlFromEnv();

  if (process.env.NODE_ENV === "production") {
    if (!envBase) {
      throw new Error(
        "APP_BASE_URL fehlt/ungültig. In production MUSS APP_BASE_URL gesetzt sein.",
      );
    }
    return envBase;
  }

  if (envBase) return envBase;
  return `${req.protocol}://${req.get("host")}`.replace(/\/+$/, "");
}

const ShareController = {
  async createEventShare(req, res) {
    try {
      const userId = req.session.user._id;
      const eventId = req.params.eventId;

      const event = await Event.findOne({ _id: eventId, createdBy: userId });
      if (!event) {
        return res.status(404).json({
          success: false,
          error: "Event nicht gefunden",
        });
      }

      const shareToken = await ShareToken.findOrCreate(
        "event",
        eventId,
        userId,
      );
      const shareUrl = `${getBaseUrl(req)}/share/event/${shareToken.token}`;

      return res.json({
        success: true,
        shareUrl,
        token: shareToken.token,
      });
    } catch (err) {
      console.error("Error creating event share:", err);
      return res.status(500).json({
        success: false,
        error: "Serverfehler",
      });
    }
  },

  async viewSharedEvent(req, res) {
    try {
      const token = req.params.token;

      const shareToken = await ShareToken.findOne({
        token,
        type: "event",
      });

      if (!shareToken || !shareToken.isValid()) {
        return res.status(404).render("error", {
          error: "Dieser Link ist ungültig oder abgelaufen.",
          currentUser: req.session.user || null,
        });
      }

      shareToken.accessCount += 1;
      await shareToken.save();

      const ownerUserId = shareToken.createdBy;

      const event = await Event.findById(shareToken.targetId).populate({
        path: "personOccasion",
        populate: [
          { path: "person", populate: "interests" },
          { path: "occasion" },
        ],
      });

      if (!event) {
        return res.status(404).render("error", {
          error: "Event nicht gefunden.",
          currentUser: req.session.user || null,
        });
      }

      const assignments = await GiftAssignment.find({
        event: event._id,
        createdBy: ownerUserId,
      })
        .populate({
          path: "gift",
          populate: "interests",
        })
        .sort({ createdAt: 1 });

      const personId = event.personOccasion.person._id;

      const giftHistory = await GiftAssignment.findGiftedForPerson(
        personId,
        ownerUserId,
      );

      const poIds = await PersonOccasion.find({
        person: personId,
        createdBy: ownerUserId,
      }).distinct("_id");

      const evIds = poIds.length
        ? await Event.find({
            createdBy: ownerUserId,
            personOccasion: { $in: poIds },
          }).distinct("_id")
        : [];

      const allAssign = evIds.length
        ? await GiftAssignment.find({
            createdBy: ownerUserId,
            event: { $in: evIds },
          })
            .populate({ path: "gift", populate: { path: "interests" } })
            .lean()
        : [];

      const explicitIds = new Set(
        (event.personOccasion.person.interests || []).map((i) =>
          String(i._id || i),
        ),
      );

      const inferredIds = new Set();
      for (const a of allAssign) {
        for (const i of a.gift?.interests || []) {
          const id = String(i._id || i);
          if (!explicitIds.has(id)) inferredIds.add(id);
        }
      }

      const inferredInterests = inferredIds.size
        ? await Interest.find({
            _id: { $in: Array.from(inferredIds) },
            $or: [{ createdBy: ownerUserId }, { isPublic: true }],
          })
            .select("_id name icon")
            .sort({ name: 1 })
            .lean()
        : [];

      return res.render("share/event", {
        event,
        assignments,
        giftHistory,
        inferredInterests,
        currentUser: req.session.user || null,
        isSharedView: true,
      });
    } catch (err) {
      console.error("Error viewing shared event:", err);
      return res.status(500).render("error", {
        error: "Fehler beim Laden",
        currentUser: req.session.user || null,
      });
    }
  },

  async createPersonShare(req, res) {
    try {
      const userId = req.session.user._id;
      const personId = req.params.personId;

      const person = await Person.findOne({ _id: personId, createdBy: userId });
      if (!person) {
        return res.status(404).json({
          success: false,
          error: "Person nicht gefunden",
        });
      }

      const shareToken = await ShareToken.findOrCreate(
        "person",
        personId,
        userId,
      );

      const shareUrl = `${getBaseUrl(req)}/share/person/${shareToken.token}`;

      return res.json({
        success: true,
        shareUrl,
        token: shareToken.token,
      });
    } catch (err) {
      console.error("Error creating person share:", err);
      return res.status(500).json({
        success: false,
        error: "Serverfehler",
      });
    }
  },

  async viewSharedPerson(req, res) {
    try {
      const mongoose = require("mongoose");

      const token = req.params.token;

      const shareToken = await ShareToken.findOne({
        token,
        type: "person",
      });

      if (!shareToken || !shareToken.isValid()) {
        return res.status(404).render("error", {
          error: "Dieser Link ist ungültig oder abgelaufen.",
          currentUser: req.session.user || null,
        });
      }

      shareToken.accessCount += 1;
      await shareToken.save();

      const ownerUserId = shareToken.createdBy;

      const person = await Person.findById(shareToken.targetId).populate(
        "interests",
      );

      if (!person) {
        return res.status(404).render("error", {
          error: "Person nicht gefunden.",
          currentUser: req.session.user || null,
        });
      }

      const personOccasions = await PersonOccasion.find({
        person: person._id,
        createdBy: ownerUserId,
      })
        .populate("occasion")
        .sort({ "occasion.name": 1 })
        .lean();

      const poIds = personOccasions.map((po) => po._id);

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
        const today = startOfDay(new Date());
        const d = startOfDay(new Date(date));
        const diff = d.getTime() - today.getTime();
        return Math.ceil(diff / (1000 * 60 * 60 * 24));
      }
      function deriveGiftState(eventStatus, assignmentCount) {
        if (eventStatus === "abgeschlossen") return "done";
        if (!assignmentCount || assignmentCount <= 0) return "no_gift";
        return "planning";
      }

      const horizonMonths = 12;
      const now = startOfDay(new Date());
      const until = startOfDay(addMonths(now, horizonMonths));

      const upcomingEventsRaw = await Event.find({
        createdBy: ownerUserId,
        personOccasion: { $in: poIds },
        date: { $gte: now, $lte: until },
      })
        .populate({
          path: "personOccasion",
          populate: [{ path: "person" }, { path: "occasion" }],
        })
        .sort({ date: 1 })
        .lean();

      const upcomingEvents = (upcomingEventsRaw || []).filter(
        (e) => e?.personOccasion?.person && e?.personOccasion?.occasion,
      );

      const upcomingEventIds = upcomingEvents.map((e) => e._id);

      const assignmentsRaw = upcomingEventIds.length
        ? await GiftAssignment.find({
            createdBy: ownerUserId,
            event: { $in: upcomingEventIds },
          })
            .populate({
              path: "gift",
              populate: { path: "interests" },
            })
            .sort({ createdAt: 1 })
            .lean()
        : [];

      const assignmentsByEventId = new Map();
      for (const a of assignmentsRaw) {
        const key = String(a.event);
        if (!assignmentsByEventId.has(key)) assignmentsByEventId.set(key, []);
        assignmentsByEventId.get(key).push(a);
      }

      const ownerUserIdObj =
        typeof ownerUserId === "string"
          ? new mongoose.Types.ObjectId(ownerUserId)
          : ownerUserId;

      const countsAgg = upcomingEventIds.length
        ? await GiftAssignment.aggregate([
            {
              $match: {
                createdBy: ownerUserIdObj,
                event: { $in: upcomingEventIds },
              },
            },
            { $group: { _id: "$event", count: { $sum: 1 } } },
          ])
        : [];

      const assignmentCountByEventId = new Map(
        countsAgg.map((r) => [String(r._id), r.count]),
      );

      const upcomingEventsEnriched = upcomingEvents.map((e) => {
        const count = assignmentCountByEventId.get(String(e._id)) || 0;
        const assignments = assignmentsByEventId.get(String(e._id)) || [];
        return {
          ...e,
          assignmentCount: count,
          giftState: deriveGiftState(e.status, count),
          daysUntil: daysUntil(e.date),
          assignments,
        };
      });

      const giftHistory = await GiftAssignment.findGiftedForPerson(
        person._id,
        ownerUserId,
      );

      const allPersonEventIds = poIds.length
        ? await Event.find({
            createdBy: ownerUserId,
            personOccasion: { $in: poIds },
          }).distinct("_id")
        : [];

      const allAssignmentsForPerson = allPersonEventIds.length
        ? await GiftAssignment.find({
            createdBy: ownerUserId,
            event: { $in: allPersonEventIds },
          })
            .populate({ path: "gift", populate: { path: "interests" } })
            .lean()
        : [];

      const explicitInterestIds = new Set(
        (person.interests || [])
          .map((i) => String(i?._id || i))
          .filter(Boolean),
      );

      const inferredInterestIds = new Set();
      for (const a of allAssignmentsForPerson) {
        for (const i of a?.gift?.interests || []) {
          const id = String(i?._id || i);
          if (!id) continue;
          if (!explicitInterestIds.has(id)) inferredInterestIds.add(id);
        }
      }

      const inferredInterests = inferredInterestIds.size
        ? await Interest.find({
            _id: { $in: Array.from(inferredInterestIds) },
            $or: [{ createdBy: ownerUserId }, { isPublic: true }],
          })
            .select("_id name icon description")
            .sort({ name: 1 })
            .lean()
        : [];

      return res.render("share/person", {
        currentUser: req.session.user || null,
        isSharedView: true,

        person,
        personOccasions,
        upcomingEvents: upcomingEventsEnriched,
        horizonMonths,

        giftHistory,
        inferredInterests,
      });
    } catch (err) {
      console.error("Error viewing shared person:", err);
      return res.status(500).render("error", {
        error: "Fehler beim Laden",
        currentUser: req.session.user || null,
      });
    }
  },

  async revokeShare(req, res) {
    try {
      const userId = req.session.user._id;
      const { type, token } = req.params;

      const shareToken = await ShareToken.findOne({
        token,
        type,
        createdBy: userId,
      });

      if (!shareToken) {
        req.session.error = "Share-Link nicht gefunden";
        return res.redirect("/dashboard");
      }

      await shareToken.deactivate();

      req.session.success = "Share-Link deaktiviert";
      return res.redirect("/dashboard");
    } catch (err) {
      console.error("Error revoking share:", err);
      req.session.error = "Fehler beim Deaktivieren";
      return res.redirect("/dashboard");
    }
  },
};

module.exports = ShareController;
