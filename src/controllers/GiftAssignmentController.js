const GiftAssignment = require("../models/GiftAssignment");
const Event = require("../models/Event");
const Gift = require("../models/Gift");
const Interest = require("../models/Interest");
const { normalizeHttpUrl } = require("../lib/normalizeHttpUrl");

function safeReturnTo(req, fallback = null) {
  const rt = req.query.returnTo;
  if (typeof rt === "string" && rt.startsWith("/")) return rt;
  return fallback;
}

function redirectToEvent(res, eventId, returnTo = null) {
  const url = returnTo
    ? `/events/${eventId}?returnTo=${encodeURIComponent(returnTo)}`
    : `/events/${eventId}`;
  return res.redirect(url);
}

function parseBool(v) {
  return v === "true" || v === true;
}

const GiftAssignmentController = {
  async create(req, res) {
    try {
      const userId = req.session.user._id;
      const { giftId, notes } = req.body;

      const event = await Event.findOne({
        _id: req.params.eventId,
        createdBy: userId,
      });
      if (!event) {
        req.session.error = "Event nicht gefunden";
        return res.redirect("/events");
      }

      const gid = String(giftId || "").trim();
      if (!gid) {
        req.session.error = "Bitte ein Geschenk auswählen";
        return res.redirect(`/events/${event._id}`);
      }

      const gift = await Gift.findOne({
        _id: gid,
        $or: [{ createdBy: userId }, { isPublic: true }],
      }).select("_id");

      if (!gift) {
        req.session.error = "Geschenk nicht gefunden oder nicht erlaubt";
        return res.redirect(`/events/${event._id}`);
      }

      await GiftAssignment.create({
        gift: gift._id,
        event: event._id,
        notes: notes?.trim() || "",
        status: "Idee",
        createdBy: userId,
      });

      req.session.success = "Geschenk als Idee zugeordnet";

      const returnTo = safeReturnTo(req, null);
      return redirectToEvent(res, event._id, returnTo);
    } catch (err) {
      console.error(err);
      req.session.error = err.message;
      return res.redirect(`/events/${req.params.eventId}`);
    }
  },

  async createWithNewGift(req, res) {
    try {
      const userId = req.session.user._id;

      const {
        title,
        description,
        link,
        notes,

        newInterestName,
        newInterestIcon,

        newGiftIsPublic,
        newInterestIsPublic,
      } = req.body;

      const safeLink = normalizeHttpUrl(link);
      if (safeLink === null) {
        req.session.error =
          "Ungültiger Link. Erlaubt sind nur http(s) Links (z.B. https://...).";
        return res.redirect(`/events/${req.params.eventId}`);
      }

      const event = await Event.findOne({
        _id: req.params.eventId,
        createdBy: userId,
      });
      if (!event) {
        req.session.error = "Event nicht gefunden";
        return res.redirect("/events");
      }

      const rawInterestIds =
        req.body.interestIds || req.body["interestIds[]"] || [];
      const interestIds = (
        Array.isArray(rawInterestIds) ? rawInterestIds : [rawInterestIds]
      )
        .map(String)
        .map((s) => s.trim())
        .filter(Boolean);

      const validInterestIds = interestIds.filter((id) =>
        require("mongoose").Types.ObjectId.isValid(id),
      );

      const selectableInterestDocs = validInterestIds.length
        ? await Interest.find({
            _id: { $in: validInterestIds },
            $or: [{ createdBy: userId }, { isPublic: true }],
          })
            .select("_id")
            .lean()
        : [];

      const selectableInterestIds = selectableInterestDocs.map((d) => d._id);

      if (newInterestName && newInterestName.trim()) {
        const created = await Interest.create({
          name: newInterestName.trim(),
          icon: newInterestIcon?.trim() || "🎁",
          createdBy: userId,
          isPublic: parseBool(newInterestIsPublic),
        });
        selectableInterestIds.push(created._id);
      }

      const gift = await Gift.create({
        title: (title || "").trim(),
        description: (description || "").trim(),
        link: safeLink,
        interests: selectableInterestIds,
        isPublic: parseBool(newGiftIsPublic),
        createdBy: userId,
      });

      // Sofort als Idee zuordnen
      await GiftAssignment.create({
        gift: gift._id,
        event: event._id,
        notes: notes?.trim() || "",
        status: "Idee",
        createdBy: userId,
      });

      req.session.success = `Geschenk "${gift.title}" erstellt und als Idee zugeordnet`;

      const returnTo = safeReturnTo(req, null);
      return redirectToEvent(res, event._id, returnTo);
    } catch (err) {
      console.error(err);
      req.session.error = err.message;
      return res.redirect(`/events/${req.params.eventId}`);
    }
  },

  async updateStatus(req, res) {
    try {
      const assignment = await GiftAssignment.findOne({
        _id: req.params.id,
        createdBy: req.session.user._id,
      });

      if (!assignment) {
        req.session.error = "Zuordnung nicht gefunden";
        return res.redirect("/events");
      }

      await assignment.advanceStatus();

      req.session.success = `Status: ${assignment.status}`;

      const returnTo = safeReturnTo(req, null);
      return redirectToEvent(res, assignment.event, returnTo);
    } catch (err) {
      console.error(err);
      req.session.error = err.message;
      return res.redirect("/events");
    }
  },

  async destroy(req, res) {
    try {
      const assignment = await GiftAssignment.findOneAndDelete({
        _id: req.params.id,
        createdBy: req.session.user._id,
      });

      if (!assignment) {
        req.session.error = "Zuordnung nicht gefunden";
        return res.redirect("/events");
      }

      req.session.success = "Zuordnung entfernt";

      const returnTo = safeReturnTo(req, null);
      return redirectToEvent(res, assignment.event, returnTo);
    } catch (err) {
      console.error(err);
      req.session.error = "Löschen fehlgeschlagen";
      return res.redirect("/events");
    }
  },

  async createFromGift(req, res) {
    const userId = req.session.user._id;
    const giftId = req.params.id;
    const { eventId, notes } = req.body;

    try {
      const event = await Event.findOne({ _id: eventId, createdBy: userId })
        .select("_id")
        .lean();

      if (!event) {
        req.session.error = "Event nicht gefunden";
        return res.redirect(`/gifts/${giftId}#usage`);
      }

      const gift = await Gift.findOne({
        _id: giftId,
        $or: [{ createdBy: userId }, { isPublic: true }],
      })
        .select("_id")
        .lean();

      if (!gift) {
        req.session.error = "Geschenk nicht gefunden oder nicht erlaubt";
        return res.redirect("/gifts");
      }

      const exists = await GiftAssignment.findOne({
        gift: gift._id,
        event: event._id,
        createdBy: userId,
      })
        .select("_id")
        .lean();

      if (exists) {
        req.session.error =
          "Dieses Geschenk ist diesem Event bereits als Idee zugeordnet.";
        return res.redirect(`/gifts/${giftId}#usage`);
      }

      await GiftAssignment.create({
        gift: gift._id,
        event: event._id,
        notes: (notes || "").trim(),
        status: "Idee",
        createdBy: userId,
      });

      req.session.success = "Geschenk dem Event zugeordnet";
      return res.redirect(`/gifts/${giftId}#usage`);
    } catch (err) {
      console.error(err);

      if (err && err.code === 11000) {
        req.session.error =
          "Dieses Geschenk ist diesem Event bereits als Idee zugeordnet.";
        return res.redirect(`/gifts/${giftId}#usage`);
      }

      req.session.error = err.message || "Zuordnung fehlgeschlagen";
      return res.redirect(`/gifts/${giftId}#usage`);
    }
  },
};

module.exports = GiftAssignmentController;
