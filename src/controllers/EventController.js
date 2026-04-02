const mongoose = require("mongoose");

const Event = require("../models/Event");
const PersonOccasion = require("../models/PersonOccasion");
const Interest = require("../models/Interest");
const Gift = require("../models/Gift");
const GiftAssignment = require("../models/GiftAssignment");
const { normalizeHttpUrl } = require("../lib/normalizeHttpUrl");

function asObjectId(id) {
  if (!id) return null;
  return typeof id === "string" ? new mongoose.Types.ObjectId(id) : id;
}

function safeReturnTo(req, fallback = "/events") {
  const rt = req.query.returnTo;

  if (typeof rt === "string" && rt.startsWith("/")) return rt;
  return fallback;
}

function parseBool(v) {
  return v === "true" || v === true;
}

async function resolveAllowedInterestIds(rawIds, userId) {
  const Interest = require("../models/Interest");
  const mongoose = require("mongoose");

  const arr = Array.isArray(rawIds) ? rawIds : rawIds ? [rawIds] : [];

  const normalized = arr.map((x) => String(x).trim()).filter(Boolean);

  const valid = normalized.filter((id) => mongoose.Types.ObjectId.isValid(id));
  if (!valid.length) return [];

  const docs = await Interest.find({
    _id: { $in: valid },
    $or: [{ createdBy: userId }, { isPublic: true }],
  })
    .select("_id")
    .lean();

  return Array.from(new Set(docs.map((d) => String(d._id))));
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

function normalizeEventFilter(f) {
  const x = String(f || "all").toLowerCase();
  const allowed = new Set(["all", "open", "no_gift", "planning", "done"]);
  return allowed.has(x) ? x : "all";
}

function stateOrder(state) {
  if (state === "no_gift") return 1;
  if (state === "planning") return 2;
  return 3;
}

function deriveGiftState(eventStatus, assignmentCount) {
  if (eventStatus === "abgeschlossen") return "done";
  if (assignmentCount > 0) return "planning";
  return "no_gift";
}

const EventController = {
  async index(req, res) {
    try {
      const userIdRaw = req.session.user._id;
      const userIdObj = asObjectId(userIdRaw);

      const months = req.session.user.todoHorizonMonths || 3;
      const filter = normalizeEventFilter(req.query.filter);

      const now = startOfDay(new Date());
      const until = startOfDay(addMonths(now, months));

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
        const giftState = deriveGiftState(e.status, assignmentCount);

        return {
          ...e,
          assignmentCount,
          giftState,
          daysUntil: daysUntil(e.date),
        };
      });

      const counts = {
        all: eventsWithState.length,
        open: eventsWithState.filter((e) => e.giftState !== "done").length,
        no_gift: eventsWithState.filter((e) => e.giftState === "no_gift")
          .length,
        planning: eventsWithState.filter((e) => e.giftState === "planning")
          .length,
        done: eventsWithState.filter((e) => e.giftState === "done").length,
      };

      let filtered = eventsWithState;
      switch (filter) {
        case "open":
          filtered = eventsWithState.filter((e) => e.giftState !== "done");
          break;
        case "no_gift":
          filtered = eventsWithState.filter((e) => e.giftState === "no_gift");
          break;
        case "planning":
          filtered = eventsWithState.filter((e) => e.giftState === "planning");
          break;
        case "done":
          filtered = eventsWithState.filter((e) => e.giftState === "done");
          break;
        default:
          filtered = eventsWithState;
      }

      filtered.sort((a, b) => {
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
      });

      return res.render("events/index", {
        months,
        filter,
        counts,
        events: filtered,
      });
    } catch (err) {
      console.error(err);
      req.session.error = "Fehler beim Laden der Events";
      return res.redirect("/dashboard");
    }
  },

  async calendar(req, res) {
    try {
      return res.render("events/calendar", { calendarEvents: [] });
    } catch (err) {
      console.error(err);
      req.session.error = "Fehler beim Laden des Kalenders";
      return res.redirect("/events");
    }
  },

  async show(req, res) {
    try {
      const userId = req.session.user._id;

      const event = await Event.findOne({
        _id: req.params.id,
        createdBy: userId,
      }).populate({
        path: "personOccasion",
        populate: [
          { path: "person", populate: "interests" },
          { path: "occasion" },
        ],
      });

      if (
        !event ||
        !event.personOccasion?.person ||
        !event.personOccasion?.occasion
      ) {
        req.session.error = "Event nicht gefunden oder Verknüpfung ungültig";
        return res.redirect("/events");
      }

      const person = event.personOccasion.person;
      const personId = person._id;

      const giftHistoryPromise = GiftAssignment.findGiftedForPerson(
        personId,
        userId,
      );

      const explicitInterestDocs = Array.isArray(person.interests)
        ? person.interests
        : [];
      const explicitInterestIds = new Set(
        explicitInterestDocs.map((i) => String(i?._id)).filter(Boolean),
      );

      const poIds = await PersonOccasion.find({
        person: personId,
        createdBy: userId,
      }).distinct("_id");

      const personEventIds = poIds.length
        ? await Event.find({
            createdBy: userId,
            personOccasion: { $in: poIds },
          }).distinct("_id")
        : [];

      const personAssignmentsAll = personEventIds.length
        ? await GiftAssignment.find({
            createdBy: userId,
            event: { $in: personEventIds },
          })
            .populate({
              path: "gift",
              select: "interests",
              populate: { path: "interests", select: "_id name icon" },
            })
            .lean()
        : [];

      const inferredInterestIds = new Set();
      for (const a of personAssignmentsAll) {
        const ints = a?.gift?.interests || [];
        for (const it of ints) {
          const id = String(it?._id || it);
          if (!id) continue;
          if (!explicitInterestIds.has(id)) inferredInterestIds.add(id);
        }
      }

      const inferredInterests = inferredInterestIds.size
        ? await Interest.find({
            _id: { $in: Array.from(inferredInterestIds) },
            $or: [{ createdBy: userId }, { isPublic: true }],
          })
            .select("_id name icon")
            .sort({ name: 1 })
            .lean()
        : [];

      const interestMetaMap = new Map();

      for (const i of explicitInterestDocs) {
        if (!i?._id) continue;
        interestMetaMap.set(String(i._id), {
          _id: i._id,
          name: i.name,
          icon: i.icon,
          source: "person",
        });
      }

      for (const i of inferredInterests) {
        if (!i?._id) continue;
        const key = String(i._id);
        if (!interestMetaMap.has(key)) {
          interestMetaMap.set(key, {
            _id: i._id,
            name: i.name,
            icon: i.icon,
            source: "inferred",
          });
        }
      }

      const interestMeta = Array.from(interestMetaMap.values());

      const [
        assignmentsRaw,
        suggestions,
        availableGifts,
        giftHistory,
        availableInterests,
      ] = await Promise.all([
        event.getAssignments(),
        Gift.recommendForEvent(event._id, userId, 10),
        Gift.findForUser(userId),
        giftHistoryPromise,
        Interest.findForUser(userId)
          .select("_id name icon isPublic createdBy")
          .lean(),
      ]);

      const assignments = assignmentsRaw || [];
      const assignmentCount = assignments.length;

      const giftState = deriveGiftState(event.status, assignmentCount);

      const returnTo = safeReturnTo(req, "/events");

      return res.render("events/show", {
        event,
        assignments,
        suggestions,
        availableGifts,
        availableInterests,
        interestMeta,
        giftHistory,
        giftState,
        assignmentCount,
        daysUntil: daysUntil(event.date),
        returnTo,
      });
    } catch (err) {
      console.error(err);
      req.session.error = "Fehler beim Laden des Events";
      return res.redirect("/events");
    }
  },

  async markComplete(req, res) {
    try {
      const userId = req.session.user._id;

      const event = await Event.findOne({
        _id: req.params.id,
        createdBy: userId,
      });
      if (!event) {
        req.session.error = "Event nicht gefunden";
        return res.redirect("/events");
      }

      event.status = "abgeschlossen";
      await event.save();

      req.session.success = "Event als abgeschlossen markiert";

      return res.redirect(safeReturnTo(req, `/events/${event._id}`));
    } catch (err) {
      console.error(err);
      req.session.error = "Fehler beim Aktualisieren";
      return res.redirect("/events");
    }
  },

  async completeWithGift(req, res) {
    try {
      const userId = req.session.user._id;

      const event = await Event.findOne({
        _id: req.params.id,
        createdBy: userId,
      });
      if (!event) {
        req.session.error = "Event nicht gefunden";
        return res.redirect("/events");
      }

      const giftId = (req.body.giftId || "").trim();

      const newGiftTitle = (req.body.newGiftTitle || "").trim();
      const newGiftDescription = (req.body.newGiftDescription || "").trim();
      const newGiftLink = (req.body.newGiftLink || "").trim();

      const safeNewGiftLink = normalizeHttpUrl(newGiftLink);

      if (safeNewGiftLink === null) {
        req.session.error =
          "Ungültiger Link. Erlaubt sind nur http(s) Links (z.B. https://...).";
        return res.redirect(safeReturnTo(req, `/events/${event._id}`));
      }

      const newGiftIsPublic = parseBool(req.body.newGiftIsPublic);
      const newInterestIsPublic = parseBool(req.body.newInterestIsPublic);

      const rawInterestIds =
        req.body.interestIds || req.body["interestIds[]"] || [];
      let interestIds = await resolveAllowedInterestIds(rawInterestIds, userId);

      const newInterestName = (req.body.newInterestName || "").trim();
      const newInterestIcon = (req.body.newInterestIcon || "🎁").trim();

      const notes = (req.body.notes || "").trim();

      // Guard: nicht beides
      if (giftId && newGiftTitle) {
        req.session.error =
          "Bitte entweder vorhandenes Geschenk wählen ODER neues Geschenk anlegen.";
        return res.redirect(safeReturnTo(req, `/events/${event._id}`));
      }

      let finalGiftId = null;
      let createdGiftTitle = null;

      // 1) Vorhandenes Geschenk wählen
      if (giftId) {
        const gift = await Gift.findOne({
          _id: giftId,
          $or: [{ createdBy: userId }, { isPublic: true }],
        }).select("_id title");

        if (!gift) {
          req.session.error = "Geschenk nicht gefunden";
          return res.redirect(safeReturnTo(req, `/events/${event._id}`));
        }

        finalGiftId = gift._id;
        createdGiftTitle = gift.title;
      }

      if (!finalGiftId && newGiftTitle) {
        if (newInterestName) {
          const createdInterest = await Interest.create({
            name: newInterestName,
            icon: newInterestIcon || "🎁",
            createdBy: userId,
            isPublic: newInterestIsPublic,
          });
          interestIds.push(String(createdInterest._id));
          interestIds = Array.from(new Set(interestIds));
        }

        const created = await Gift.create({
          title: newGiftTitle,
          description: newGiftDescription,
          link: safeNewGiftLink,
          interests: interestIds,
          isPublic: newGiftIsPublic,
          createdBy: userId,
        });

        finalGiftId = created._id;
        createdGiftTitle = created.title;
      }

      if (!finalGiftId) {
        event.status = "abgeschlossen";
        await event.save();

        req.session.success = "Event als abgeschlossen markiert";
        return res.redirect(safeReturnTo(req, `/events/${event._id}`));
      }

      try {
        await GiftAssignment.create({
          gift: finalGiftId,
          event: event._id,
          notes,
          status: "fertig",
          createdBy: userId,
        });
      } catch (e) {
        if (e && e.code === 11000) {
          await GiftAssignment.findOneAndUpdate(
            { gift: finalGiftId, event: event._id, createdBy: userId },
            { $set: { status: "fertig", notes } },
            { new: true },
          );
        } else {
          throw e;
        }
      }

      event.status = "abgeschlossen";
      await event.save();

      req.session.success = `Event abgeschlossen${createdGiftTitle ? ` · Geschenk: ${createdGiftTitle}` : ""}`;
      return res.redirect(safeReturnTo(req, `/events/${event._id}`));
    } catch (err) {
      console.error(err);
      req.session.error = "Fehler beim Abschließen mit Geschenk";
      return res.redirect("/events");
    }
  },

  async destroy(req, res) {
    try {
      const userId = req.session.user._id;

      const event = await Event.findOne({
        _id: req.params.id,
        createdBy: userId,
      });
      if (!event) {
        req.session.error = "Event nicht gefunden";
        return res.redirect("/events");
      }

      await GiftAssignment.deleteMany({ event: event._id, createdBy: userId });
      await Event.findOneAndDelete({ _id: event._id, createdBy: userId });

      req.session.success = "Event inkl. Geschenk-Zuordnungen gelöscht";
      return res.redirect("/events");
    } catch (err) {
      console.error(err);
      req.session.error = "Löschen fehlgeschlagen";
      return res.redirect("/events");
    }
  },

  async apiAssignments(req, res) {
    try {
      const userId = req.session.user._id;
      const eventId = req.params.id;

      const event = await Event.findOne({ _id: eventId, createdBy: userId })
        .select("_id")
        .lean();

      if (!event) return res.status(404).json({ error: "event_not_found" });

      const assignments = await GiftAssignment.find({
        event: event._id,
        createdBy: userId,
      })
        .populate({
          path: "gift",
          select: "_id title images interests",
          populate: { path: "interests", select: "_id name icon" },
        })
        .sort({ status: 1, createdAt: 1 })
        .lean();

      function bestImageUrlFromImages(images) {
        const imgs = Array.isArray(images) ? images : [];
        const primary = imgs.find((x) => x && x.isPrimary);
        const first = imgs[0];
        return primary && primary.url
          ? primary.url
          : first && first.url
            ? first.url
            : "";
      }

      return res.json({
        eventId: String(event._id),
        assignments: (assignments || []).map((a) => ({
          _id: String(a._id),
          status: a.status,
          notes: a.notes || "",
          gift: a.gift
            ? {
                _id: String(a.gift._id),
                title: a.gift.title,
                imageUrl: bestImageUrlFromImages(a.gift.images),
                interests: (a.gift.interests || []).map((i) => ({
                  _id: String(i._id),
                  name: i.name,
                  icon: i.icon,
                })),
              }
            : null,
        })),
      });
    } catch (err) {
      console.error("apiAssignments error", err);
      return res.status(500).json({ error: "server_error" });
    }
  },
};

module.exports = EventController;
