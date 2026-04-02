const Person = require("../models/Person");
const Event = require("../models/Event");
const Gift = require("../models/Gift");
const Interest = require("../models/Interest");
const Occasion = require("../models/Occasion");
const PersonOccasion = require("../models/PersonOccasion");
const GiftAssignment = require("../models/GiftAssignment");

const DataController = {
  async index(req, res) {
    try {
      const userId = req.session.user._id;

      const [persons, gifts, interests, occasions] = await Promise.all([
        Person.findForUser(userId).populate("interests").lean(),
        Gift.findForUser(userId).populate("interests").lean(),
        Interest.findForUser(userId).lean(),
        Occasion.findForUser(userId).lean(),
      ]);

      const personIds = persons.map((p) => p._id);

      const personOccasionsAll = await PersonOccasion.find({
        createdBy: userId,
        person: { $in: personIds },
      })
        .populate("occasion")
        .lean();

      const personOccasionsByPersonId = new Map();
      for (const po of personOccasionsAll) {
        const pid = String(po.person);
        if (!personOccasionsByPersonId.has(pid))
          personOccasionsByPersonId.set(pid, []);
        personOccasionsByPersonId.get(pid).push(po);
      }

      const poIds = personOccasionsAll.map((po) => po._id);

      const events = poIds.length
        ? await Event.find({
            createdBy: userId,
            personOccasion: { $in: poIds },
          })
            .populate({
              path: "personOccasion",
              populate: [{ path: "person" }, { path: "occasion" }],
            })
            .sort({ date: -1 })
            .lean()
        : [];

      const eventIds = events.map((e) => e._id);

      const assignments = eventIds.length
        ? await GiftAssignment.find({
            createdBy: userId,
            event: { $in: eventIds },
          })
            .populate({ path: "gift", populate: { path: "interests" } })
            .lean()
        : [];

      const assignmentsByEventId = new Map();
      for (const a of assignments) {
        const eid = String(a.event);
        if (!assignmentsByEventId.has(eid)) assignmentsByEventId.set(eid, []);
        assignmentsByEventId.get(eid).push(a);
      }

      const eventsByPersonId = new Map();
      for (const ev of events) {
        const eid = String(ev._id);
        const evAssignments = assignmentsByEventId.get(eid) || [];
        const enrichedEvent = { ...ev, assignments: evAssignments };

        const pid =
          ev?.personOccasion?.person?._id != null
            ? String(ev.personOccasion.person._id)
            : null;

        if (!pid) continue;
        if (!eventsByPersonId.has(pid)) eventsByPersonId.set(pid, []);
        eventsByPersonId.get(pid).push(enrichedEvent);
      }

      const totalEvents = events.length;
      const totalAssignments = assignments.length;

      const giftUsage = {};
      for (const a of assignments) {
        const gid = a?.gift?._id ? String(a.gift._id) : null;
        if (!gid) continue;
        giftUsage[gid] = (giftUsage[gid] || 0) + 1;
      }

      const giftsWithUsage = gifts.map((g) => ({
        ...g,
        usageCount: giftUsage[String(g._id)] || 0,
      }));

      const personsWithData = persons.map((p) => {
        const pid = String(p._id);
        return {
          ...p,
          occasions: personOccasionsByPersonId.get(pid) || [],
          events: eventsByPersonId.get(pid) || [],
        };
      });

      return res.render("data/index", {
        data: {
          persons: personsWithData,
          gifts: giftsWithUsage,
          interests,
          occasions,
          totalEvents,
          totalAssignments,
        },
      });
    } catch (err) {
      console.error("Error in data overview:", err);
      req.session.error = "Fehler beim Laden der Daten";
      return res.redirect("/dashboard");
    }
  },
};

module.exports = DataController;
