const mongoose = require("mongoose");

const Person = require("../models/Person");
const PersonOccasion = require("../models/PersonOccasion");
const Occasion = require("../models/Occasion");
const Interest = require("../models/Interest");
const Event = require("../models/Event");
const Task = require("../models/Task");
const Gift = require("../models/Gift");
const GiftAssignment = require("../models/GiftAssignment");

const { invalidateHorizonSync } = require("../middleware/ensureHorizonEvents");
const { yearsInRangeFromHorizon } = require("../lib/ensureEvents");
const { normalizeHttpUrl } = require("../lib/normalizeHttpUrl");
const { isValidDayMonth } = require("../lib/dateValidation");

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

function isMovableOccasion(occasion) {
  return (
    !(occasion.day != null && occasion.month != null) &&
    occasion.isBirthday !== true
  );
}

function deriveGiftState(event, assignmentCount) {
  if (event.status === "abgeschlossen") return "done";
  if (!assignmentCount || assignmentCount <= 0) return "no_gift";
  return "planning";
}

function parseOptionalInt(value) {
  if (value == null) return undefined;
  const s = String(value).trim();
  if (!s) return undefined;
  const n = parseInt(s, 10);
  return Number.isNaN(n) ? undefined : n;
}

function asObjectId(id) {
  if (!id) return null;
  return typeof id === "string" ? new mongoose.Types.ObjectId(id) : id;
}

function safeReturnTo(req, fallback) {
  const rt = req.query.returnTo;
  if (typeof rt === "string" && rt.startsWith("/")) return rt;
  return fallback;
}

function normalizeToArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function parseBool(v) {
  return v === true || v === "true" || v === "on" || v === "1";
}

async function resolveAllowedInterestIds(rawIds, userId) {
  const arr = normalizeToArray(rawIds)
    .map((x) => String(x).trim())
    .filter(Boolean);

  const valid = arr.filter((id) => mongoose.Types.ObjectId.isValid(id));
  if (!valid.length) return [];

  const docs = await Interest.find({
    _id: { $in: valid },
    $or: [{ createdBy: userId }, { isPublic: true }],
  })
    .select("_id")
    .lean();

  return Array.from(new Set(docs.map((d) => String(d._id))));
}

function getHorizonYears(req) {
  const months = req.session?.user?.todoHorizonMonths || 3;
  return yearsInRangeFromHorizon(months);
}

async function ensureDateTasksForMovableOccasionInRange({ req, link, userId }) {
  if (!link) return;
  const occ = link.occasion;
  if (!occ) return;
  if (!isMovableOccasion(occ)) return;

  const nowYear = new Date().getFullYear();
  const hy = getHorizonYears(req);
  const maxHorizonYear = hy.length ? hy[hy.length - 1] : nowYear;

  const startYear = link.startYear ?? nowYear;
  const endYear = link.endYear ?? maxHorizonYear;

  const fromYear = Math.max(startYear, nowYear);
  const toYear = Math.min(endYear, maxHorizonYear);

  if (toYear < fromYear) return;

  for (let y = fromYear; y <= toYear; y++) {
    const hasDateForYear =
      link.customYear === y &&
      link.customDay != null &&
      link.customMonth != null;

    if (hasDateForYear) continue;

    await Task.createDateTask(link._id, y, userId);
  }
}

async function cleanupOutOfRangeForSingleLink({
  userId,
  linkId,
  startYear,
  endYear,
}) {
  const outOfRange = [{ year: { $lt: startYear } }];
  if (endYear != null) outOfRange.push({ year: { $gt: endYear } });

  const outEvents = await Event.find({
    createdBy: userId,
    personOccasion: linkId,
    $or: outOfRange,
  })
    .select("_id")
    .lean();

  const outEventIds = outEvents.map((e) => e._id);

  if (outEventIds.length) {
    await GiftAssignment.deleteMany({
      createdBy: userId,
      event: { $in: outEventIds },
    });

    await Event.deleteMany({
      createdBy: userId,
      _id: { $in: outEventIds },
    });
  }

  await Task.deleteMany({
    createdBy: userId,
    personOccasion: linkId,
    $or: outOfRange,
  });
}

const PersonController = {
  async index(req, res) {
    try {
      const userId = req.session.user._id;
      const sort = (req.query.sort || "name").toLowerCase();

      let sortSpec = { name: 1 };
      if (sort === "birthday")
        sortSpec = { birthdayMonth: 1, birthdayDay: 1, name: 1 };

      const persons = await Person.find({ createdBy: userId })
        .populate("interests")
        .sort(sortSpec);

      return res.render("persons/index", { persons, sort });
    } catch (err) {
      console.error(err);
      req.session.error = "Fehler beim Laden der Personen";
      return res.redirect("/dashboard");
    }
  },

  async new(req, res) {
    try {
      const userId = req.session.user._id;

      const [occasions, interests] = await Promise.all([
        Occasion.findForUser(userId).sort({ name: 1 }),
        Interest.findForUser(userId).sort({ name: 1 }),
      ]);

      return res.render("persons/new", { occasions, interests });
    } catch (err) {
      console.error(err);
      req.session.error = "Fehler beim Laden";
      return res.redirect("/persons");
    }
  },

  async create(req, res) {
    const userId = req.session.user._id;

    const renderNewWithError = async (msg) => {
      const [occasions, interests] = await Promise.all([
        Occasion.findForUser(userId).sort({ name: 1 }),
        Interest.findForUser(userId).sort({ name: 1 }),
      ]);

      return res.status(400).render("persons/new", {
        occasions,
        interests,
        formData: req.body,
        error: msg,
      });
    };

    try {
      const {
        name,
        birthdayDay,
        birthdayMonth,
        notes,
        newInterestName,
        newInterestIcon,
        newInterestIsPublic,
        newOccasionName,
        newOccasionIcon,
        newOccasionIsPublic,
        newOccasionDay,
        newOccasionMonth,
        newOccasionIsRecurring,
      } = req.body;

      if (!birthdayDay || !birthdayMonth) {
        return renderNewWithError("Bitte Geburtstag (Tag und Monat) angeben");
      }

      const bd = parseInt(birthdayDay, 10);
      const bm = parseInt(birthdayMonth, 10);

      if (!isValidDayMonth(bd, bm, { allowFeb29: true })) {
        return renderNewWithError(
          "Ungültiger Geburtstag: Dieser Tag existiert in diesem Monat nicht (z.B. 31. Februar).",
        );
      }

      let interestIds = await resolveAllowedInterestIds(
        req.body.interests,
        userId,
      );

      if (newInterestName && newInterestName.trim()) {
        const createdInterest = await Interest.create({
          name: newInterestName.trim(),
          icon: (newInterestIcon || "🎁").trim(),
          createdBy: userId,
          isPublic: parseBool(newInterestIsPublic),
        });
        interestIds.push(String(createdInterest._id));
        interestIds = Array.from(new Set(interestIds));
      }

      const person = await Person.create({
        name,
        birthdayDay: bd,
        birthdayMonth: bm,
        notes,
        interests: interestIds,
        createdBy: userId,
      });

      const birthdayOccasion = await Occasion.findOne({
        $or: [{ createdBy: userId }, { isPublic: true }],
        isBirthday: true,
      });

      if (birthdayOccasion) {
        await PersonOccasion.create({
          person: person._id,
          occasion: birthdayOccasion._id,
          createdBy: userId,
        });
      }

      let occasionIds = normalizeToArray(
        req.body.occasionIds || req.body["occasionIds[]"],
      ).map(String);

      if (newOccasionName && newOccasionName.trim()) {
        const createdOccasion = await Occasion.create({
          name: newOccasionName.trim(),
          description: "",
          icon: (newOccasionIcon || "🎉").trim(),
          day: newOccasionDay ? parseInt(newOccasionDay, 10) : undefined,
          month: newOccasionMonth ? parseInt(newOccasionMonth, 10) : undefined,
          isRecurring: parseBool(newOccasionIsRecurring),
          isBirthday: false,
          isPublic: parseBool(newOccasionIsPublic),
          createdBy: userId,
        });

        occasionIds.push(createdOccasion._id.toString());
      }

      const startYears = req.body.startYears || {};
      const endYears = req.body.endYears || {};
      const customDates = req.body.customDates || {};

      const currentYear = new Date().getFullYear();

      for (const occasionIdRaw of occasionIds) {
        const occasionId = String(occasionIdRaw);

        if (birthdayOccasion && occasionId === String(birthdayOccasion._id))
          continue;

        const occasion = await Occasion.findOne({
          _id: occasionId,
          $or: [{ createdBy: userId }, { isPublic: true }],
        });
        if (!occasion) continue;

        let startYear = parseOptionalInt(startYears[occasionId]) ?? currentYear;
        let endYear = parseOptionalInt(endYears[occasionId]);

        if (occasion.isRecurring === false) {
          endYear = startYear;
        }

        if (endYear != null && endYear < startYear) {
          return renderNewWithError(
            "Endjahr darf nicht kleiner als Startjahr sein",
          );
        }

        const link = await PersonOccasion.create({
          person: person._id,
          occasion: occasion._id,
          createdBy: userId,
          startYear,
          endYear,
        });

        const customDateStr = customDates[occasionId];

        if (customDateStr) {
          const date = new Date(customDateStr);
          if (!Number.isNaN(date.getTime())) {
            const year = date.getFullYear();

            if (year < startYear) {
              return renderNewWithError(
                `Datum liegt vor dem Startjahr (${startYear}).`,
              );
            }
            if (endYear != null && year > endYear) {
              return renderNewWithError(
                `Datum liegt nach dem Endjahr (${endYear}).`,
              );
            }

            if (isMovableOccasion(occasion)) {
              link.customYear = year;
              link.customMonth = date.getMonth() + 1;
              link.customDay = date.getDate();
              await link.save();
            }

            await Event.findOrCreate(link._id, year, date, userId);

            await Task.updateMany(
              {
                personOccasion: link._id,
                year,
                createdBy: userId,
                isDone: false,
              },
              { $set: { isDone: true, doneAt: new Date() } },
            );
          }
        }

        if (isMovableOccasion(occasion)) {
          link.occasion = occasion;
          await ensureDateTasksForMovableOccasionInRange({ req, link, userId });
        }
      }

      invalidateHorizonSync(userId);

      req.session.success = `Person "${name}" erfolgreich angelegt`;
      return res.redirect(`/persons/${person._id}`);
    } catch (err) {
      console.error(err);

      return renderNewWithError(
        err?.message || "Fehler beim Anlegen der Person",
      );
    }
  },

  async show(req, res) {
    try {
      const userId = req.session.user._id;
      const userIdObj = asObjectId(userId);

      const todoMonths = req.session.user.todoHorizonMonths || 3;

      const person = await Person.findOne({
        _id: req.params.id,
        createdBy: userId,
      }).populate("interests");

      if (!person) {
        req.session.error = "Person nicht gefunden";
        return res.redirect("/persons");
      }

      const now = startOfDay(new Date());
      const until = startOfDay(addMonths(now, todoMonths));

      const [personOccasions, allOccasionsForHistory] = await Promise.all([
        PersonOccasion.find({ person: person._id, createdBy: userId })
          .populate("occasion")
          .sort({ "occasion.name": 1 }),
        Occasion.findForUser(userId).sort({ name: 1 }).lean(),
      ]);

      const poIds = personOccasions.map((po) => po._id);

      const personEventIdsAll = poIds.length
        ? await Event.find({
            createdBy: userId,
            personOccasion: { $in: poIds },
          }).distinct("_id")
        : [];

      const assignmentsAll = personEventIdsAll.length
        ? await GiftAssignment.find({
            createdBy: userId,
            event: { $in: personEventIdsAll },
          })
            .populate({ path: "gift", select: "interests" })
            .lean()
        : [];

      const explicitInterestIds = new Set(
        (person.interests || [])
          .map((i) => String(i?._id || i))
          .filter(Boolean),
      );

      const inferredInterestIds = new Set();
      for (const a of assignmentsAll) {
        const giftInterests = a?.gift?.interests || [];
        for (const iid of giftInterests) {
          const s = String(iid?._id || iid);
          if (!s) continue;
          if (!explicitInterestIds.has(s)) inferredInterestIds.add(s);
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

      const eventsRaw = await Event.find({
        createdBy: userId,
        personOccasion: { $in: poIds },
        date: { $gte: now, $lte: until },
      })
        .populate({
          path: "personOccasion",
          populate: [{ path: "person" }, { path: "occasion" }],
        })
        .sort({ date: 1 })
        .lean();

      const upcomingEvents = (eventsRaw || []).filter(
        (e) => e?.personOccasion?.person && e?.personOccasion?.occasion,
      );

      const upcomingEventIds = upcomingEvents.map((e) => e._id);

      const assignmentsRaw = upcomingEventIds.length
        ? await GiftAssignment.find({
            createdBy: userId,
            event: { $in: upcomingEventIds },
          })
            .populate("gift")
            .lean()
        : [];

      const assignmentsByEventId = new Map();
      for (const a of assignmentsRaw) {
        const key = String(a.event);
        if (!assignmentsByEventId.has(key)) assignmentsByEventId.set(key, []);
        assignmentsByEventId.get(key).push(a);
      }

      const countsAgg = upcomingEventIds.length
        ? await GiftAssignment.aggregate([
            {
              $match: {
                createdBy: userIdObj,
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
          giftState: deriveGiftState(e, count),
          daysUntil: daysUntil(e.date),
          assignments,
        };
      });

      const giftHistory = await GiftAssignment.findGiftedForPerson(
        person._id,
        userId,
      );

      return res.render("persons/show", {
        person,
        todoMonths,
        personOccasions,
        upcomingEvents: upcomingEventsEnriched,
        giftHistory,
        inferredInterests,
        allOccasionsForHistory,
      });
    } catch (err) {
      console.error(err);
      req.session.error = "Fehler beim Laden der Person";
      return res.redirect("/persons");
    }
  },

  async edit(req, res) {
    try {
      const userId = req.session.user._id;

      const [person, interests, occasions, personOccasions] = await Promise.all(
        [
          Person.findOne({ _id: req.params.id, createdBy: userId }).populate(
            "interests",
          ),
          Interest.findForUser(userId).sort({ name: 1 }),
          Occasion.findForUser(userId).sort({ name: 1 }),
          PersonOccasion.find({
            person: req.params.id,
            createdBy: userId,
          }).populate("occasion"),
        ],
      );

      if (!person) {
        req.session.error = "Person nicht gefunden";
        return res.redirect("/persons");
      }

      const assignedOccasionIds = new Set(
        (personOccasions || [])
          .map((po) => (po.occasion ? String(po.occasion._id) : null))
          .filter(Boolean),
      );

      const poIdByOccasionId = new Map(
        (personOccasions || [])
          .filter((po) => po.occasion)
          .map((po) => [String(po.occasion._id), String(po._id)]),
      );

      const startYearByOccasionId = new Map(
        (personOccasions || [])
          .filter((po) => po.occasion)
          .map((po) => [String(po.occasion._id), po.startYear]),
      );

      const endYearByOccasionId = new Map(
        (personOccasions || [])
          .filter((po) => po.occasion)
          .map((po) => [String(po.occasion._id), po.endYear ?? ""]),
      );

      const poIds = (personOccasions || []).map((po) => po._id);

      const personEventIdsAll = poIds.length
        ? await Event.find({
            createdBy: userId,
            personOccasion: { $in: poIds },
          }).distinct("_id")
        : [];

      const assignmentsAll = personEventIdsAll.length
        ? await GiftAssignment.find({
            createdBy: userId,
            event: { $in: personEventIdsAll },
          })
            .populate({ path: "gift", select: "interests" })
            .lean()
        : [];

      const explicitInterestIds = new Set(
        (person.interests || [])
          .map((i) => String(i?._id || i))
          .filter(Boolean),
      );

      const inferredInterestIds = new Set();
      for (const a of assignmentsAll) {
        const giftInterests = a?.gift?.interests || [];
        for (const iid of giftInterests) {
          const s = String(iid?._id || iid);
          if (!s) continue;
          if (!explicitInterestIds.has(s)) inferredInterestIds.add(s);
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

      return res.render("persons/edit", {
        person,
        interests,
        occasions,
        personOccasions,
        assignedOccasionIds,
        poIdByOccasionId,
        startYearByOccasionId,
        endYearByOccasionId,
        inferredInterests,
      });
    } catch (err) {
      console.error(err);
      req.session.error = "Fehler beim Laden";
      return res.redirect("/persons");
    }
  },

  async update(req, res) {
    try {
      const userId = req.session.user._id;

      const {
        name,
        birthdayDay,
        birthdayMonth,
        notes,
        newInterestName,
        newInterestIcon,
        newInterestIsPublic,
        newOccasionName,
        newOccasionIcon,
        newOccasionIsPublic,
        newOccasionDay,
        newOccasionMonth,
        newOccasionIsRecurring,
      } = req.body;

      if (!birthdayDay || !birthdayMonth) {
        req.session.error = "Bitte Geburtstag (Tag und Monat) angeben";
        return res.redirect(`/persons/${req.params.id}/edit`);
      }

      const bd = parseInt(birthdayDay, 10);
      const bm = parseInt(birthdayMonth, 10);

      if (!isValidDayMonth(bd, bm, { allowFeb29: true })) {
        req.session.error =
          "Ungültiger Geburtstag: Dieser Tag existiert in diesem Monat nicht (z.B. 31. Februar).";
        return res.redirect(`/persons/${req.params.id}/edit`);
      }

      const person = await Person.findOne({
        _id: req.params.id,
        createdBy: userId,
      });
      if (!person) {
        req.session.error = "Person nicht gefunden";
        return res.redirect("/persons");
      }
      let interestIds = await resolveAllowedInterestIds(
        req.body.interests,
        userId,
      );

      if (newInterestName && newInterestName.trim()) {
        const createdInterest = await Interest.create({
          name: newInterestName.trim(),
          icon: (newInterestIcon || "🎁").trim(),
          createdBy: userId,
          isPublic: parseBool(newInterestIsPublic),
        });
        interestIds.push(String(createdInterest._id));
        interestIds = Array.from(new Set(interestIds));
      }

      person.name = name;
      person.birthdayDay = parseInt(birthdayDay, 10);
      person.birthdayMonth = parseInt(birthdayMonth, 10);
      person.notes = notes;
      person.interests = interestIds;
      await person.save();

      const startYears = req.body.startYears || {};
      const endYears = req.body.endYears || {};

      const selectedRaw =
        req.body.occasionIds || req.body["occasionIds[]"] || [];
      let selectedOccasionIds = normalizeToArray(selectedRaw || []).map(String);

      if (newOccasionName && newOccasionName.trim()) {
        const createdOccasion = await Occasion.create({
          name: newOccasionName.trim(),
          description: "",
          icon: (newOccasionIcon || "🎉").trim(),
          day: newOccasionDay ? parseInt(newOccasionDay, 10) : undefined,
          month: newOccasionMonth ? parseInt(newOccasionMonth, 10) : undefined,
          isRecurring: parseBool(newOccasionIsRecurring),
          isBirthday: false,
          isPublic: parseBool(newOccasionIsPublic),
          createdBy: userId,
        });
        selectedOccasionIds.push(createdOccasion._id.toString());
      }

      const birthdayOccasion = await Occasion.findOne({
        $or: [{ createdBy: userId }, { isPublic: true }],
        isBirthday: true,
      }).select("_id");

      if (birthdayOccasion)
        selectedOccasionIds.push(String(birthdayOccasion._id));

      selectedOccasionIds = [
        ...new Set(selectedOccasionIds.map(String).filter(Boolean)),
      ];

      const links = await PersonOccasion.find({
        person: person._id,
        createdBy: userId,
      }).populate("occasion");

      const existingByOccId = new Map(
        links.filter((l) => l.occasion).map((l) => [String(l.occasion._id), l]),
      );

      const toAdd = selectedOccasionIds.filter(
        (oid) => !existingByOccId.has(String(oid)),
      );

      const toRemove = links
        .filter((l) => l.occasion)
        .filter((l) => {
          const oid = String(l.occasion._id);
          const isBday =
            birthdayOccasion && oid === String(birthdayOccasion._id);
          return !isBday && !selectedOccasionIds.includes(oid);
        });

      if (toRemove.length) {
        await PersonOccasion.deleteWithDependents({
          userId,
          filter: { _id: { $in: toRemove.map((l) => l._id) } },
        });
      }

      const currentYear = new Date().getFullYear();

      for (const oid of toAdd) {
        const occ = await Occasion.findOne({
          _id: oid,
          $or: [{ createdBy: userId }, { isPublic: true }],
        });
        if (!occ) continue;

        let startYear =
          parseOptionalInt(startYears[String(oid)]) ?? currentYear;
        let endYear = parseOptionalInt(endYears[String(oid)]);

        if (occ.isRecurring === false) {
          endYear = startYear;
        }

        if (endYear != null && endYear < startYear) {
          req.session.error = "Endjahr darf nicht kleiner als Startjahr sein";
          return res.redirect(`/persons/${person._id}/edit`);
        }

        const link = await PersonOccasion.create({
          person: person._id,
          occasion: occ._id,
          createdBy: userId,
          startYear,
          endYear,
        });

        if (isMovableOccasion(occ)) {
          link.occasion = occ;
          await ensureDateTasksForMovableOccasionInRange({ req, link, userId });
        }
      }

      for (const oid of selectedOccasionIds) {
        const existing = existingByOccId.get(String(oid));
        if (!existing) continue;

        const occ = existing.occasion;
        if (!occ) continue;
        if (occ.isBirthday === true) continue;

        let parsedStartYear =
          parseOptionalInt(startYears[String(oid)]) ??
          existing.startYear ??
          currentYear;

        let parsedEndYear = parseOptionalInt(endYears[String(oid)]);

        if (occ.isRecurring === false) {
          parsedEndYear = parsedStartYear;
        }

        if (parsedEndYear != null && parsedEndYear < parsedStartYear) {
          req.session.error = "Endjahr darf nicht kleiner als Startjahr sein";
          return res.redirect(`/persons/${person._id}/edit`);
        }

        const startChanged = parsedStartYear !== existing.startYear;
        const endChanged =
          (parsedEndYear ?? null) !== (existing.endYear ?? null);

        if (!startChanged && !endChanged) continue;

        existing.startYear = parsedStartYear;
        existing.endYear = parsedEndYear;

        if (existing.customYear != null) {
          if (
            existing.customYear < parsedStartYear ||
            (parsedEndYear != null && existing.customYear > parsedEndYear)
          ) {
            existing.customYear = null;
            existing.customMonth = null;
            existing.customDay = null;
          }
        }

        await existing.save();

        await cleanupOutOfRangeForSingleLink({
          userId,
          linkId: existing._id,
          startYear: parsedStartYear,
          endYear: parsedEndYear,
        });

        if (isMovableOccasion(occ)) {
          await ensureDateTasksForMovableOccasionInRange({
            req,
            link: existing,
            userId,
          });
        }
      }

      invalidateHorizonSync(userId);

      req.session.success = "Person aktualisiert";
      return res.redirect(`/persons/${person._id}`);
    } catch (err) {
      console.error(err);
      req.session.error = "Fehler beim Aktualisieren";
      return res.redirect(`/persons/${req.params.id}/edit`);
    }
  },

  async destroy(req, res) {
    try {
      const userId = req.session.user._id;

      const person = await Person.findOne({
        _id: req.params.id,
        createdBy: userId,
      });
      if (!person) {
        req.session.error = "Person nicht gefunden";
        return res.redirect("/persons");
      }

      const links = await PersonOccasion.find({
        person: person._id,
        createdBy: userId,
      });
      const linkIds = links.map((l) => l._id);

      const events = await Event.find({
        personOccasion: { $in: linkIds },
        createdBy: userId,
      });
      const eventIds = events.map((e) => e._id);

      await GiftAssignment.deleteMany({
        event: { $in: eventIds },
        createdBy: userId,
      });
      await Event.deleteMany({ _id: { $in: eventIds }, createdBy: userId });
      await Task.deleteMany({
        personOccasion: { $in: linkIds },
        createdBy: userId,
      });
      await PersonOccasion.deleteMany({
        person: person._id,
        createdBy: userId,
      });

      await Person.deleteOne({ _id: person._id, createdBy: userId });

      invalidateHorizonSync(userId);

      req.session.success = `Person "${person.name}" und alle Daten gelöscht`;
      return res.redirect("/persons");
    } catch (err) {
      console.error(err);
      req.session.error = "Fehler beim Löschen";
      return res.redirect("/persons");
    }
  },

  async showOccasions(req, res) {
    try {
      const userId = req.session.user._id;

      const person = await Person.findOne({
        _id: req.params.id,
        createdBy: userId,
      });
      if (!person) {
        req.session.error = "Person nicht gefunden";
        return res.redirect("/persons");
      }

      const [personOccasions, allOccasions] = await Promise.all([
        PersonOccasion.find({ person: person._id, createdBy: userId }).populate(
          "occasion",
        ),
        Occasion.findForUser(userId).sort({ name: 1 }),
      ]);

      const assignedIds = personOccasions
        .map((po) => String(po.occasion?._id))
        .filter(Boolean);
      const availableOccasions = allOccasions.filter(
        (o) => !assignedIds.includes(String(o._id)),
      );

      return res.render("persons/occasions", {
        person,
        personOccasions,
        availableOccasions,
      });
    } catch (err) {
      console.error(err);
      req.session.error = "Fehler beim Laden der Anlässe";
      return res.redirect(`/persons/${req.params.id}`);
    }
  },

  async assignOccasion(req, res) {
    try {
      const userId = req.session.user._id;
      const { occasionId, customDate } = req.body;

      let startYear =
        parseOptionalInt(req.body.startYear) ?? new Date().getFullYear();
      let endYear = parseOptionalInt(req.body.endYear);
      const notes = (req.body.notes || "").trim();

      if (endYear != null && endYear < startYear) {
        req.session.error = "Endjahr darf nicht kleiner als Startjahr sein";
        return res.redirect(`/persons/${req.params.id}/occasions`);
      }

      const person = await Person.findOne({
        _id: req.params.id,
        createdBy: userId,
      });
      if (!person) {
        req.session.error = "Person nicht gefunden";
        return res.redirect("/persons");
      }

      const occasion = await Occasion.findOne({
        _id: occasionId,
        $or: [{ createdBy: userId }, { isPublic: true }],
      });
      if (!occasion) {
        req.session.error = "Anlass nicht gefunden";
        return res.redirect(`/persons/${req.params.id}/occasions`);
      }

      if (occasion.isRecurring === false) {
        endYear = startYear;
      }

      const existing = await PersonOccasion.findOne({
        person: person._id,
        occasion: occasion._id,
        createdBy: userId,
      });

      if (existing) {
        req.session.error = `"${occasion.name}" ist bereits zugeordnet`;
        return res.redirect(`/persons/${req.params.id}/occasions`);
      }

      const link = await PersonOccasion.create({
        person: person._id,
        occasion: occasion._id,
        createdBy: userId,
        startYear,
        endYear,
        notes,
      });

      if (customDate) {
        const date = new Date(customDate);
        if (!Number.isNaN(date.getTime())) {
          const year = date.getFullYear();

          if (year < link.startYear) {
            req.session.error = `Datum liegt vor dem Startjahr (${link.startYear}).`;
            return res.redirect(`/persons/${req.params.id}/occasions`);
          }
          if (link.endYear != null && year > link.endYear) {
            req.session.error = `Datum liegt nach dem Endjahr (${link.endYear}).`;
            return res.redirect(`/persons/${req.params.id}/occasions`);
          }

          if (isMovableOccasion(occasion)) {
            link.customYear = year;
            link.customMonth = date.getMonth() + 1;
            link.customDay = date.getDate();
            await link.save();
          }

          await Event.findOrCreate(link._id, year, date, userId);

          await Task.updateMany(
            {
              personOccasion: link._id,
              year,
              createdBy: userId,
              isDone: false,
            },
            { $set: { isDone: true, doneAt: new Date() } },
          );
        }
      }

      if (isMovableOccasion(occasion)) {
        link.occasion = occasion;
        await ensureDateTasksForMovableOccasionInRange({ req, link, userId });
      }

      invalidateHorizonSync(userId);

      req.session.success = `"${occasion.name}" hinzugefügt`;
      return res.redirect(`/persons/${req.params.id}/occasions`);
    } catch (err) {
      console.error(err);
      req.session.error = "Fehler beim Zuordnen";
      return res.redirect(`/persons/${req.params.id}/occasions`);
    }
  },

  async updatePersonOccasion(req, res) {
    try {
      const userId = req.session.user._id;
      const personId = req.params.id;

      const returnTo = safeReturnTo(req, `/persons/${personId}/occasions`);

      const person = await Person.findOne({
        _id: personId,
        createdBy: userId,
      }).select("_id name");
      if (!person) {
        req.session.error = "Person nicht gefunden";
        return res.redirect("/persons");
      }

      const link = await PersonOccasion.findOne({
        _id: req.params.poId,
        createdBy: userId,
        person: person._id,
      }).populate("occasion");

      if (!link) {
        req.session.error = "Verknüpfung nicht gefunden";
        return res.redirect(returnTo);
      }

      let startYear =
        parseOptionalInt(req.body.startYear) ??
        link.startYear ??
        new Date().getFullYear();

      let endYear = parseOptionalInt(req.body.endYear);
      const notes = (req.body.notes || "").trim();

      if (link.occasion?.isRecurring === false) {
        endYear = startYear;
      }

      if (endYear != null && endYear < startYear) {
        req.session.error = "Endjahr darf nicht kleiner als Startjahr sein";
        return res.redirect(returnTo);
      }

      link.startYear = startYear;
      link.endYear = endYear;
      link.notes = notes;

      if (link.customYear != null) {
        if (
          link.customYear < startYear ||
          (endYear != null && link.customYear > endYear)
        ) {
          link.customYear = null;
          link.customMonth = null;
          link.customDay = null;
        }
      }

      await link.save();

      await cleanupOutOfRangeForSingleLink({
        userId,
        linkId: link._id,
        startYear,
        endYear,
      });

      await ensureDateTasksForMovableOccasionInRange({
        req,
        link,
        userId,
      });

      invalidateHorizonSync(userId);

      req.session.success = "Zeitraum gespeichert";
      return res.redirect(returnTo);
    } catch (err) {
      console.error(err);
      req.session.error = "Fehler beim Speichern";
      return res.redirect(
        safeReturnTo(req, `/persons/${req.params.id}/occasions`),
      );
    }
  },

  async removeOccasion(req, res) {
    try {
      const userId = req.session.user._id;

      const person = await Person.findOne({
        _id: req.params.id,
        createdBy: userId,
      });
      if (!person) {
        req.session.error = "Person nicht gefunden";
        return res.redirect("/persons");
      }

      const link = await PersonOccasion.findOne({
        _id: req.params.poId,
        person: person._id,
        createdBy: userId,
      });

      if (!link) {
        req.session.error = "Verknüpfung nicht gefunden";
        return res.redirect(`/persons/${req.params.id}/occasions`);
      }

      const events = await Event.find({
        personOccasion: link._id,
        createdBy: userId,
      });
      const eventIds = events.map((e) => e._id);

      await GiftAssignment.deleteMany({
        event: { $in: eventIds },
        createdBy: userId,
      });
      await Event.deleteMany({ _id: { $in: eventIds }, createdBy: userId });
      await Task.deleteMany({ personOccasion: link._id, createdBy: userId });

      await PersonOccasion.deleteOne({ _id: link._id, createdBy: userId });

      invalidateHorizonSync(userId);

      req.session.success = "Anlass entfernt";
      return res.redirect(
        safeReturnTo(req, `/persons/${req.params.id}/occasions`),
      );
    } catch (err) {
      console.error(err);
      req.session.error = "Fehler beim Entfernen";
      return res.redirect(`/persons/${req.params.id}/occasions`);
    }
  },

  async editOccasionDate(req, res) {
    try {
      const userId = req.session.user._id;

      const [person, link] = await Promise.all([
        Person.findOne({ _id: req.params.id, createdBy: userId }),
        PersonOccasion.findOne({
          _id: req.params.poId,
          createdBy: userId,
          person: req.params.id,
        }).populate("occasion"),
      ]);

      if (!person || !link) {
        req.session.error = "Nicht gefunden";
        return res.redirect(`/persons/${req.params.id}/occasions`);
      }

      const requestedYear = req.query.year
        ? parseInt(req.query.year, 10)
        : null;

      const returnTo = safeReturnTo(req, `/persons/${person._id}/occasions`);

      return res.render("persons/occasion-date", {
        person,
        link,
        requestedYear,
        returnTo,
      });
    } catch (err) {
      console.error(err);
      req.session.error = "Fehler beim Laden";
      return res.redirect(`/persons/${req.params.id}/occasions`);
    }
  },

  async updateOccasionDate(req, res) {
    try {
      const userId = req.session.user._id;
      const { date: dateStr } = req.body;

      const returnTo = safeReturnTo(req, `/persons/${req.params.id}/occasions`);

      const q = [];
      if (req.query.year) q.push(`year=${encodeURIComponent(req.query.year)}`);
      q.push(`returnTo=${encodeURIComponent(returnTo)}`);
      const backToEditUrl =
        `/persons/${req.params.id}/occasions/${req.params.poId}/date?` +
        q.join("&");

      const link = await PersonOccasion.findOne({
        _id: req.params.poId,
        createdBy: userId,
      }).populate("occasion");

      if (!link) {
        req.session.error = "Verknüpfung nicht gefunden";
        return res.redirect(returnTo);
      }

      if (!dateStr) {
        req.session.error = "Bitte ein Datum angeben";
        return res.redirect(backToEditUrl);
      }

      const date = new Date(dateStr);
      if (Number.isNaN(date.getTime())) {
        req.session.error = "Ungültiges Datum";
        return res.redirect(backToEditUrl);
      }

      const year = date.getFullYear();

      if (year < link.startYear) {
        req.session.error = `Datum liegt vor dem Startjahr (${link.startYear}).`;
        return res.redirect(backToEditUrl);
      }
      if (link.endYear != null && year > link.endYear) {
        req.session.error = `Datum liegt nach dem Endjahr (${link.endYear}).`;
        return res.redirect(backToEditUrl);
      }

      if (isMovableOccasion(link.occasion)) {
        link.customYear = year;
        link.customMonth = date.getMonth() + 1;
        link.customDay = date.getDate();
        await link.save();
      }

      await Event.findOrCreate(link._id, year, date, userId);

      await Task.updateMany(
        { personOccasion: link._id, year, createdBy: userId, isDone: false },
        { $set: { isDone: true, doneAt: new Date() } },
      );

      await ensureDateTasksForMovableOccasionInRange({
        req,
        link,
        userId,
      });

      invalidateHorizonSync(userId);

      req.session.success = "Datum gespeichert";
      return res.redirect(returnTo);
    } catch (err) {
      console.error(err);
      req.session.error = "Fehler beim Speichern";
      return res.redirect(
        safeReturnTo(req, `/persons/${req.params.id}/occasions`),
      );
    }
  },

  async addHistoryGift(req, res) {
    try {
      const userId = req.session.user._id;
      const personId = req.params.id;

      const person = await Person.findOne({
        _id: personId,
        createdBy: userId,
      }).select("_id name birthdayDay birthdayMonth");

      if (!person) {
        req.session.error = "Person nicht gefunden";
        return res.redirect("/persons");
      }

      const occasionId = String(req.body.occasionId || "").trim();
      const dateStr = String(req.body.date || "").trim();
      const onlyThisYear =
        req.body.onlyThisYear === "true" || req.body.onlyThisYear === true;

      const giftId = String(req.body.giftId || "").trim();
      const newGiftTitle = String(req.body.newGiftTitle || "").trim();
      const newGiftDescription = String(
        req.body.newGiftDescription || "",
      ).trim();
      const newGiftLink = String(req.body.newGiftLink || "").trim();
      const newGiftIsPublic = parseBool(req.body.newGiftIsPublic);
      const notes = String(req.body.notes || "").trim();

      const safeNewGiftLink = normalizeHttpUrl(newGiftLink);
      if (safeNewGiftLink === null) {
        req.session.error =
          "Ungültiger Link. Erlaubt sind nur http(s) Links (z.B. https://...).";
        return res.redirect(`/persons/${personId}#history`);
      }

      const newInterestName = String(req.body.newInterestName || "").trim();
      const newInterestIcon = String(req.body.newInterestIcon || "🎁").trim();
      const newInterestIsPublic = parseBool(req.body.newInterestIsPublic);

      const rawInterestIds =
        req.body.interestIds || req.body["interestIds[]"] || [];
      let interestIds = await resolveAllowedInterestIds(rawInterestIds, userId);

      if (!occasionId) {
        req.session.error = "Bitte einen Anlass auswählen";
        return res.redirect(`/persons/${personId}#history`);
      }
      if (!dateStr) {
        req.session.error = "Bitte ein Datum auswählen";
        return res.redirect(`/persons/${personId}#history`);
      }

      const date = new Date(dateStr);
      if (Number.isNaN(date.getTime())) {
        req.session.error = "Ungültiges Datum";
        return res.redirect(`/persons/${personId}#history`);
      }

      const occasion = await Occasion.findOne({
        _id: occasionId,
        $or: [{ createdBy: userId }, { isPublic: true }],
      }).lean();

      if (!occasion) {
        req.session.error = "Anlass nicht gefunden";
        return res.redirect(`/persons/${personId}#history`);
      }

      const occasionHasFixedDate =
        occasion.day != null && occasion.month != null;

      if (occasionHasFixedDate) {
        const dd = date.getDate();
        const mm = date.getMonth() + 1;
        if (dd !== occasion.day || mm !== occasion.month) {
          req.session.error = `Datum passt nicht zum Anlass („${occasion.name}“ ist immer am ${occasion.day}.${occasion.month}.)`;
          return res.redirect(`/persons/${personId}#history`);
        }
      }

      if (occasion.isBirthday === true) {
        if (!person.birthdayDay || !person.birthdayMonth) {
          req.session.error =
            "Diese Person hat keinen Geburtstag gespeichert – Datum kann nicht geprüft werden.";
          return res.redirect(`/persons/${personId}#history`);
        }

        const dd = date.getDate();
        const mm = date.getMonth() + 1;
        if (dd !== person.birthdayDay || mm !== person.birthdayMonth) {
          req.session.error = `Datum passt nicht zum Geburtstag (${person.birthdayDay}.${person.birthdayMonth}.)`;
          return res.redirect(`/persons/${personId}#history`);
        }
      }

      if (giftId && newGiftTitle) {
        req.session.error =
          "Bitte entweder vorhandenes Geschenk wählen ODER neues Geschenk anlegen.";
        return res.redirect(`/persons/${personId}#history`);
      }
      if (!giftId && !newGiftTitle) {
        req.session.error =
          "Bitte ein Geschenk auswählen oder ein neues Geschenk anlegen.";
        return res.redirect(`/persons/${personId}#history`);
      }

      let link = await PersonOccasion.findOne({
        person: personId,
        occasion: occasionId,
        createdBy: userId,
      });

      const year = date.getFullYear();

      if (!link) {
        const startYear = onlyThisYear
          ? year
          : Math.min(year, new Date().getFullYear());
        const endYear = onlyThisYear ? year : undefined;

        link = await PersonOccasion.create({
          person: personId,
          occasion: occasionId,
          createdBy: userId,
          startYear,
          endYear,
        });

        if (!occasionHasFixedDate && occasion.isBirthday !== true) {
          link.occasion = occasion;
          await ensureDateTasksForMovableOccasionInRange({
            req,
            link,
            userId,
          });
        }
      } else {
        let changed = false;
        if (link.startYear != null && year < link.startYear) {
          link.startYear = year;
          changed = true;
        }
        if (link.endYear != null && year > link.endYear) {
          link.endYear = year;
          changed = true;
        }
        if (changed) await link.save();
      }

      const occasionIsBirthday = occasion.isBirthday === true;
      const occasionIsMovable = !occasionHasFixedDate && !occasionIsBirthday;

      if (occasionIsMovable) {
        if (link.customYear == null || link.customYear === year) {
          link.customYear = year;
          link.customMonth = date.getMonth() + 1;
          link.customDay = date.getDate();
          await link.save();
        }
      }

      const event = await Event.findOrCreate(link._id, year, date, userId);

      await Task.updateMany(
        { personOccasion: link._id, year, createdBy: userId, isDone: false },
        { $set: { isDone: true, doneAt: new Date() } },
      );

      let finalGiftId = null;
      let createdGiftTitle = null;

      if (giftId) {
        const gift = await Gift.findOne({
          _id: giftId,
          $or: [{ createdBy: userId }, { isPublic: true }],
        }).select("_id title");

        if (!gift) {
          req.session.error = "Geschenk nicht gefunden";
          return res.redirect(`/persons/${personId}#history`);
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

        const createdGift = await Gift.create({
          title: newGiftTitle,
          description: newGiftDescription,
          link: safeNewGiftLink,
          interests: interestIds,
          isPublic: newGiftIsPublic,
          createdBy: userId,
        });

        finalGiftId = createdGift._id;
        createdGiftTitle = createdGift.title;
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

      invalidateHorizonSync(userId);

      req.session.success = `Historie hinzugefügt${createdGiftTitle ? ` · Geschenk: ${createdGiftTitle}` : ""}`;
      return res.redirect(`/persons/${personId}#history`);
    } catch (err) {
      console.error(err);
      req.session.error = "Fehler beim Hinzufügen zur Historie";
      return res.redirect(`/persons/${req.params.id}`);
    }
  },

  async addInterestToPerson(req, res) {
    try {
      const userId = req.session.user._id;
      const personId = req.params.id;
      const interestId = req.params.interestId;

      const returnTo = safeReturnTo(req, `/persons/${personId}`);

      const person = await Person.findOne({
        _id: personId,
        createdBy: userId,
      }).select("_id");
      if (!person) {
        req.session.error = "Person nicht gefunden";
        return res.redirect("/persons");
      }

      const interest = await Interest.findOne({
        _id: interestId,
        $or: [{ createdBy: userId }, { isPublic: true }],
      }).select("_id name");

      if (!interest) {
        req.session.error = "Interesse nicht gefunden";
        return res.redirect(returnTo);
      }

      await Person.updateOne(
        { _id: personId, createdBy: userId },
        { $addToSet: { interests: interest._id } },
      );

      req.session.success = `Interesse „${interest.name}“ hinzugefügt`;
      return res.redirect(returnTo);
    } catch (err) {
      console.error(err);
      req.session.error = "Fehler beim Hinzufügen des Interesses";
      return res.redirect(`/persons/${req.params.id}`);
    }
  },
};

module.exports = PersonController;
