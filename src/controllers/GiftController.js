const mongoose = require("mongoose");
const path = require("path");
const fs = require("fs");

const Gift = require("../models/Gift");
const Interest = require("../models/Interest");
const Event = require("../models/Event");
const GiftAssignment = require("../models/GiftAssignment");
const GiftUsage = require("../models/GiftUsage");

const { upload } = require("../config/upload");
const { normalizeHttpUrl } = require("../lib/normalizeHttpUrl");
const { PUBLIC_DIR } = require("../config/paths");

const MAX_IMAGES_PER_GIFT = 10;

function parseBool(v) {
  return v === true || v === "true" || v === "on" || v === "1";
}

function normalizeToArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

async function resolveAllowedInterestIds(rawIds, userId) {
  const ids = normalizeToArray(rawIds)
    .map((x) => String(x).trim())
    .filter(Boolean)
    .filter((id) => mongoose.Types.ObjectId.isValid(id));

  if (!ids.length) return [];

  const docs = await Interest.find({
    _id: { $in: ids },
    $or: [{ createdBy: userId }, { isPublic: true }],
  })
    .select("_id")
    .lean();

  return Array.from(new Set(docs.map((d) => String(d._id))));
}

const GiftController = {
  async index(req, res) {
    try {
      const userId = req.session.user._id;

      const giftsRaw = await Gift.find({
        $or: [{ createdBy: userId }, { isPublic: true }],
      })
        .populate("interests")
        .lean();

      const interests = await Interest.findForUser(userId);

      const giftIds = giftsRaw.map((g) => g._id);

      const usageDocs = giftIds.length
        ? await GiftUsage.find({
            createdBy: userId,
            gift: { $in: giftIds },
          })
            .select("gift count")
            .lean()
        : [];

      const usageByGiftId = new Map(
        usageDocs.map((d) => [String(d.gift), Number(d.count || 0)]),
      );

      const gifts = giftsRaw.map((g) => ({
        ...g,
        myGiftedCount: usageByGiftId.get(String(g._id)) || 0,
      }));

      gifts.sort((a, b) => {
        const d = (b.myGiftedCount || 0) - (a.myGiftedCount || 0);
        if (d !== 0) return d;
        return String(a.title || "").localeCompare(String(b.title || ""), "de");
      });

      return res.render("gifts/index", { gifts, interests });
    } catch (err) {
      console.error(err);
      req.session.error = "Fehler beim Laden";
      return res.redirect("/");
    }
  },

  async options(req, res) {
    try {
      const userId = req.session.user._id;

      const gifts = await Gift.find({
        $or: [{ createdBy: userId }, { isPublic: true }],
      })
        .select("_id title")
        .sort({ title: 1 })
        .lean();

      return res.json({ gifts });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: "server_error" });
    }
  },

  async new(req, res) {
    try {
      const userId = req.session.user._id;

      const interests = await Interest.findForUser(userId);
      const preselectedInterestId = req.query.interestId
        ? String(req.query.interestId)
        : null;

      return res.render("gifts/new", { interests, preselectedInterestId });
    } catch (err) {
      console.error(err);
      return res.redirect("/gifts");
    }
  },

  async create(req, res) {
    const uploadMiddleware = upload.array("images", 10);

    uploadMiddleware(req, res, async (err) => {
      if (err) {
        req.session.error = err.message;
        return res.redirect("/gifts/new");
      }

      try {
        const userId = req.session.user._id;

        const title = String(req.body.title || "").trim();
        const description = String(req.body.description || "").trim();
        const link = String(req.body.link || "").trim();

        const safeLink = normalizeHttpUrl(link);
        if (safeLink === null) {
          req.session.error =
            "Ungültiger Link. Erlaubt sind nur http(s) Links (z.B. https://...).";
          return res.redirect("/gifts/new");
        }

        if (!title) {
          req.session.error = "Bitte einen Titel angeben";
          return res.redirect("/gifts/new");
        }

        const makePublic = parseBool(req.body.isPublic);

        let allInterests = await resolveAllowedInterestIds(
          req.body.interests,
          userId,
        );

        const newInterestName = String(req.body.newInterestName || "").trim();
        const newInterestIcon = String(req.body.newInterestIcon || "🎁").trim();

        if (newInterestName) {
          const created = await Interest.create({
            name: newInterestName,
            icon: newInterestIcon || "🎁",
            createdBy: userId,
            isPublic: false,
          });
          allInterests.push(String(created._id));
          allInterests = Array.from(new Set(allInterests));
        }

        const gift = await Gift.create({
          title,
          description,
          link: safeLink,
          interests: allInterests,
          isPublic: makePublic,
          createdBy: userId,
        });

        if (req.files.length > MAX_IMAGES_PER_GIFT) {
          req.files.forEach((f) => {
            try {
              if (fs.existsSync(f.path)) fs.unlinkSync(f.path);
            } catch (_) {}
          });

          req.session.error = `Maximal ${MAX_IMAGES_PER_GIFT} Bilder pro Geschenk erlaubt.`;
          return res.redirect("/gifts/new");
        }

        if (req.files && req.files.length > 0) {
          const targetDir = path.join(
            PUBLIC_DIR,
            "uploads",
            "gifts",
            gift._id.toString(),
          );
          fs.mkdirSync(targetDir, { recursive: true });

          for (const [idx, file] of req.files.entries()) {
            const newPath = path.join(targetDir, file.filename);
            fs.renameSync(file.path, newPath);

            gift.images.push({
              url: `/uploads/gifts/${gift._id}/${file.filename}`,
              isPrimary: idx === 0,
            });
          }

          await gift.save();
        }

        req.session.success = makePublic
          ? "Geschenk als öffentlich angelegt"
          : "Geschenk angelegt";
        return res.redirect(`/gifts/${gift._id}`);
      } catch (saveErr) {
        console.error(saveErr);

        if (req.files) {
          req.files.forEach((f) => {
            try {
              if (fs.existsSync(f.path)) fs.unlinkSync(f.path);
            } catch (_) {}
          });
        }

        req.session.error = saveErr.message || "Fehler beim Speichern";
        return res.redirect("/gifts/new");
      }
    });
  },

  async show(req, res) {
    try {
      const userId = req.session.user._id;

      const gift = await Gift.findOne({
        $or: [
          { _id: req.params.id, createdBy: userId },
          { _id: req.params.id, isPublic: true },
        ],
      }).populate("interests");

      if (!gift) {
        req.session.error = "Geschenk nicht gefunden";
        return res.redirect("/gifts");
      }

      const usageDoc = await GiftUsage.findOne({
        createdBy: userId,
        gift: gift._id,
      })
        .select("count")
        .lean();

      const myGiftedCount = usageDoc?.count || 0;

      gift = gift.toObject({ virtuals: true });
      gift.myGiftedCount = myGiftedCount;

      const usageRaw = await GiftAssignment.find({
        gift: gift._id,
        createdBy: userId,
      })
        .populate({
          path: "event",
          populate: {
            path: "personOccasion",
            populate: [{ path: "person" }, { path: "occasion" }],
          },
        })
        .sort({ createdAt: -1 })
        .lean();

      const usage = (usageRaw || []).sort((a, b) => {
        const da = a?.event?.date ? new Date(a.event.date).getTime() : 0;
        const db = b?.event?.date ? new Date(b.event.date).getTime() : 0;
        return db - da;
      });

      const months = req.session.user.todoHorizonMonths || 3;
      const now = new Date();
      now.setHours(0, 0, 0, 0);
      const until = new Date(now);
      until.setMonth(until.getMonth() + months);

      const assignedEventIdsRaw = await GiftAssignment.distinct("event", {
        gift: gift._id,
        createdBy: userId,
      });

      const availableEventsRaw = await Event.find({
        createdBy: userId,
        date: { $gte: now, $lte: until },
        _id: { $nin: assignedEventIdsRaw },
      })
        .populate({
          path: "personOccasion",
          populate: [{ path: "person" }, { path: "occasion" }],
        })
        .sort({ date: 1 })
        .lean();

      const availableEvents = (availableEventsRaw || []).filter(
        (e) => e?.personOccasion?.person && e?.personOccasion?.occasion,
      );

      return res.render("gifts/show", {
        gift,
        usage,
        availableEvents,
        myGiftedCount,
      });
    } catch (err) {
      console.error(err);
      req.session.error = "Fehler beim Laden";
      return res.redirect("/gifts");
    }
  },

  async edit(req, res) {
    try {
      const userId = req.session.user._id;

      const [gift, interests] = await Promise.all([
        Gift.findOne({
          _id: req.params.id,
          createdBy: userId,
          isPublic: { $ne: true },
        }).populate("interests"),
        Interest.findForUser(userId),
      ]);

      if (!gift) {
        req.session.error =
          "Geschenk nicht gefunden oder nicht bearbeitbar (Katalog)";
        return res.redirect("/gifts");
      }

      return res.render("gifts/edit", { gift, interests });
    } catch (err) {
      console.error(err);
      return res.redirect("/gifts");
    }
  },

  async update(req, res) {
    try {
      const userId = req.session.user._id;

      const gift = await Gift.findOne({
        _id: req.params.id,
        createdBy: userId,
        isPublic: { $ne: true },
      });

      if (!gift) {
        req.session.error =
          "Geschenk nicht gefunden oder nicht bearbeitbar (Katalog)";
        return res.redirect("/gifts");
      }

      const title = String(req.body.title || "").trim();
      const description = String(req.body.description || "").trim();
      const link = String(req.body.link || "").trim();

      if (!title) {
        req.session.error = "Bitte einen Titel angeben";
        return res.redirect(`/gifts/${req.params.id}/edit`);
      }

      const safeLink = normalizeHttpUrl(link);
      if (safeLink === null) {
        req.session.error =
          "Ungültiger Link. Erlaubt sind nur http(s) Links (z.B. https://...).";
        return res.redirect(`/gifts/${req.params.id}/edit`);
      }

      let allInterests = await resolveAllowedInterestIds(
        req.body.interests,
        userId,
      );

      const newInterestName = String(req.body.newInterestName || "").trim();
      const newInterestIcon = String(req.body.newInterestIcon || "🎁").trim();

      if (newInterestName) {
        const created = await Interest.create({
          name: newInterestName,
          icon: newInterestIcon || "🎁",
          createdBy: userId,
          isPublic: false,
        });
        allInterests.push(String(created._id));
        allInterests = Array.from(new Set(allInterests));
      }

      gift.title = title;
      gift.description = description;
      gift.link = safeLink;
      gift.interests = allInterests;

      await gift.save();

      req.session.success = "Gespeichert";
      return res.redirect(`/gifts/${gift._id}`);
    } catch (err) {
      console.error(err);
      req.session.error = err.message || "Fehler beim Speichern";
      return res.redirect(`/gifts/${req.params.id}/edit`);
    }
  },

  async addImages(req, res) {
    const uploadMiddleware = upload.array("images", 10);

    uploadMiddleware(req, res, async (err) => {
      if (err) {
        req.session.error = err.message;
        return res.redirect(`/gifts/${req.params.id}`);
      }

      try {
        const userId = req.session.user._id;

        const gift = await Gift.findOne({
          _id: req.params.id,
          createdBy: userId,
          isPublic: { $ne: true },
        });

        if (!gift) {
          req.session.error =
            "Geschenk nicht gefunden oder nicht bearbeitbar (Katalog)";
          return res.redirect("/gifts");
        }

        const currentCount = Array.isArray(gift.images)
          ? gift.images.length
          : 0;
        const incomingCount = Array.isArray(req.files) ? req.files.length : 0;

        if (currentCount + incomingCount > MAX_IMAGES_PER_GIFT) {
          for (const f of req.files || []) {
            try {
              if (f?.path && fs.existsSync(f.path)) fs.unlinkSync(f.path);
            } catch (_) {}
          }

          req.session.error = `Maximal ${MAX_IMAGES_PER_GIFT} Bilder pro Geschenk erlaubt. Aktuell: ${currentCount}.`;
          return res.redirect(`/gifts/${gift._id}`);
        }

        if (req.files && req.files.length > 0) {
          gift.addUploadedImages(req.files);
          await gift.save();
        }

        req.session.success = `${req.files?.length || 0} Bild(er) hochgeladen`;
        return res.redirect(`/gifts/${gift._id}`);
      } catch (saveErr) {
        console.error(saveErr);
        req.session.error = saveErr.message || "Fehler beim Hochladen";
        return res.redirect(`/gifts/${req.params.id}`);
      }
    });
  },

  async removeImage(req, res) {
    try {
      const userId = req.session.user._id;

      const gift = await Gift.findOne({
        _id: req.params.id,
        createdBy: userId,
        isPublic: { $ne: true },
      });

      if (!gift) {
        req.session.error =
          "Geschenk nicht gefunden oder nicht bearbeitbar (Katalog)";
        return res.redirect("/gifts");
      }

      gift.removeImage(req.params.imageId);
      await gift.save();

      req.session.success = "Bild gelöscht";
      return res.redirect(`/gifts/${gift._id}`);
    } catch (err) {
      console.error(err);
      req.session.error = err.message || "Fehler beim Löschen";
      return res.redirect(`/gifts/${req.params.id}`);
    }
  },

  async setPrimaryImage(req, res) {
    try {
      const userId = req.session.user._id;

      const gift = await Gift.findOne({
        _id: req.params.id,
        createdBy: userId,
        isPublic: { $ne: true },
      });

      if (!gift) {
        req.session.error =
          "Geschenk nicht gefunden oder nicht bearbeitbar (Katalog)";
        return res.redirect("/gifts");
      }

      gift.setPrimaryImage(req.params.imageId);
      await gift.save();

      req.session.success = "Hauptbild gesetzt";
      return res.redirect(`/gifts/${gift._id}`);
    } catch (err) {
      console.error(err);
      req.session.error = err.message || "Fehler beim Speichern";
      return res.redirect(`/gifts/${req.params.id}`);
    }
  },

  async destroy(req, res) {
    try {
      const userId = req.session.user._id;
      const giftId = req.params.id;

      const gift = await Gift.findOne({
        _id: giftId,
        createdBy: userId,
        isPublic: { $ne: true },
      }).select("_id title");

      if (!gift) {
        req.session.error =
          "Geschenk nicht gefunden oder nicht löschbar (Katalog)";
        return res.redirect("/gifts");
      }

      const affectedEventIds = await GiftAssignment.find({
        createdBy: userId,
        gift: gift._id,
      }).distinct("event");

      await GiftAssignment.deleteMany({
        createdBy: userId,
        gift: gift._id,
      });

      if (affectedEventIds.length) {
        const affectedEvents = await Event.find({
          createdBy: userId,
          _id: { $in: affectedEventIds },
        }).select("_id");

        for (const ev of affectedEvents) {
          await ev.recalculateStatus();
        }
      }

      await Gift.findOneAndDelete({
        _id: gift._id,
        createdBy: userId,
        isPublic: { $ne: true },
      });

      req.session.success =
        "Geschenk gelöscht" +
        (affectedEventIds.length
          ? ` (inkl. ${affectedEventIds.length} Event-Zuordnung(en))`
          : "");

      return res.redirect("/gifts");
    } catch (err) {
      console.error(err);
      req.session.error = "Löschen fehlgeschlagen";
      return res.redirect("/gifts");
    }
  },
};

module.exports = GiftController;
