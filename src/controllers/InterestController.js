const Interest = require("../models/Interest");
const Person = require("../models/Person");
const Gift = require("../models/Gift");
const GiftInterestLink = require("../models/GiftInterestLink");
const GiftUsage = require("../models/GiftUsage");

function normalizeIds(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

async function attachMyGiftedCount(giftsRaw, userId) {
  const gifts = Array.isArray(giftsRaw) ? giftsRaw : [];

  const giftIds = gifts
    .map((g) => (g?._id ? String(g._id) : null))
    .filter(Boolean);

  if (!giftIds.length) return gifts.map((g) => ({ ...g, myGiftedCount: 0 }));

  const usageDocs = await GiftUsage.find({
    createdBy: userId,
    gift: { $in: giftIds },
  })
    .select("gift count")
    .lean();

  const usageByGiftId = new Map(
    usageDocs.map((d) => [String(d.gift), Number(d.count || 0)]),
  );

  return gifts.map((g) => ({
    ...g,
    myGiftedCount: usageByGiftId.get(String(g._id)) || 0,
  }));
}

function sortGiftsByMyUsageThenCreatedAt(gifts) {
  return [...(gifts || [])].sort((a, b) => {
    const ua = Number(a?.myGiftedCount || 0);
    const ub = Number(b?.myGiftedCount || 0);
    if (ua !== ub) return ub - ua;

    const ca = a?.createdAt ? new Date(a.createdAt).getTime() : 0;
    const cb = b?.createdAt ? new Date(b.createdAt).getTime() : 0;
    if (ca !== cb) return cb - ca;

    return String(a?.title || "").localeCompare(String(b?.title || ""), "de");
  });
}

const InterestController = {
  async index(req, res) {
    try {
      const userId = req.session.user._id;
      const interests = await Interest.findForUser(userId);
      return res.render("interests/index", { interests });
    } catch (err) {
      console.error(err);
      req.session.error = "Fehler beim Laden";
      return res.redirect("/dashboard");
    }
  },

  async options(req, res) {
    try {
      const userId = req.session.user._id;

      const interests = await Interest.find({
        $or: [{ createdBy: userId }, { isPublic: true }],
      })
        .select("_id name icon")
        .sort({ name: 1 })
        .lean();

      return res.json({ interests });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: "server_error" });
    }
  },

  async show(req, res) {
    try {
      const userId = req.session.user._id;

      const interest = await Interest.findOne({
        _id: req.params.id,
        $or: [{ createdBy: userId }, { isPublic: true }],
      }).lean();

      if (!interest) {
        req.session.error = "Interesse nicht gefunden";
        return res.redirect("/interests");
      }

      const canEdit =
        interest.createdBy &&
        String(interest.createdBy) === String(userId) &&
        interest.isPublic !== true;

      const linkGiftIds = await GiftInterestLink.find({
        interest: interest._id,
        $or: [{ isPublic: true }, { createdBy: userId }],
      }).distinct("gift");

      const [persons, giftsRaw] = await Promise.all([
        Person.find({ createdBy: userId, interests: interest._id })
          .sort({ name: 1 })
          .lean(),

        Gift.find({
          $and: [
            { $or: [{ createdBy: userId }, { isPublic: true }] },
            {
              $or: [{ interests: interest._id }, { _id: { $in: linkGiftIds } }],
            },
          ],
        })
          .select("_id title link isPublic createdAt interests")
          .lean(),
      ]);

      let gifts = await attachMyGiftedCount(giftsRaw, userId);
      gifts = sortGiftsByMyUsageThenCreatedAt(gifts);

      return res.render("interests/show", {
        interest,
        persons,
        gifts,
        canEdit,
      });
    } catch (err) {
      console.error(err);
      req.session.error = "Fehler beim Laden";
      return res.redirect("/interests");
    }
  },

  async new(req, res) {
    try {
      const userId = req.session.user._id;

      const [persons, giftsRaw] = await Promise.all([
        Person.find({ createdBy: userId }).sort({ name: 1 }).lean(),
        Gift.find({ $or: [{ createdBy: userId }, { isPublic: true }] })
          .select("_id title isPublic createdAt")
          .lean(),
      ]);

      let gifts = await attachMyGiftedCount(giftsRaw, userId);
      gifts = sortGiftsByMyUsageThenCreatedAt(gifts);

      return res.render("interests/new", { persons, gifts });
    } catch (err) {
      console.error(err);
      req.session.error = "Fehler beim Laden";
      return res.redirect("/interests");
    }
  },

  async create(req, res) {
    try {
      const userId = req.session.user._id;
      const { name, description, icon, isPublic } = req.body;

      const makePublic = isPublic === "true" || isPublic === true;

      const interest = await Interest.create({
        name,
        description,
        icon: icon || "🎁",
        isPublic: makePublic,
        createdBy: userId,
      });

      const personIds = normalizeIds(req.body.personIds)
        .map(String)
        .filter(Boolean);

      if (personIds.length) {
        await Person.updateMany(
          { createdBy: userId, _id: { $in: personIds } },
          { $addToSet: { interests: interest._id } },
        );
      }

      const giftIdsRaw = normalizeIds(req.body.giftIds)
        .map(String)
        .filter(Boolean);

      if (giftIdsRaw.length) {
        const gifts = await Gift.find({
          _id: { $in: giftIdsRaw },
          $or: [{ createdBy: userId }, { isPublic: true }],
        })
          .select("_id isPublic createdBy")
          .lean();

        const ownedGiftIds = gifts
          .filter(
            (g) =>
              g.isPublic !== true && String(g.createdBy) === String(userId),
          )
          .map((g) => g._id);

        const publicGiftIds = gifts
          .filter((g) => g.isPublic === true)
          .map((g) => g._id);

        if (ownedGiftIds.length) {
          await Gift.updateMany(
            { createdBy: userId, _id: { $in: ownedGiftIds } },
            { $addToSet: { interests: interest._id } },
          );
        }

        if (publicGiftIds.length) {
          const linkIsPublic = interest.isPublic === true;

          const ops = publicGiftIds.map((gid) => ({
            updateOne: {
              filter: linkIsPublic
                ? { gift: gid, interest: interest._id, isPublic: true }
                : {
                    gift: gid,
                    interest: interest._id,
                    createdBy: userId,
                    isPublic: false,
                  },
              update: {
                $setOnInsert: {
                  gift: gid,
                  interest: interest._id,
                  createdBy: userId,
                  isPublic: linkIsPublic,
                },
              },
              upsert: true,
            },
          }));

          await GiftInterestLink.bulkWrite(ops, { ordered: false });
        }
      }

      req.session.success = makePublic
        ? "Interesse als öffentlich angelegt"
        : "Interesse angelegt";

      return res.redirect(`/interests/${interest._id}`);
    } catch (err) {
      console.error(err);
      req.session.error = err?.message || "Fehler beim Anlegen";
      return res.redirect("/interests/new");
    }
  },

  async edit(req, res) {
    try {
      const userId = req.session.user._id;

      const [interest, persons, giftsRaw] = await Promise.all([
        Interest.findOne({
          _id: req.params.id,
          createdBy: userId,
          isPublic: { $ne: true },
        }).lean(),

        Person.find({ createdBy: userId }).sort({ name: 1 }).lean(),

        Gift.find({ $or: [{ createdBy: userId }, { isPublic: true }] })
          .select("_id title isPublic createdAt")
          .lean(),
      ]);

      if (!interest) {
        req.session.error =
          "Interesse nicht gefunden oder nicht bearbeitbar (Katalog)";
        return res.redirect("/interests");
      }

      let gifts = await attachMyGiftedCount(giftsRaw, userId);
      gifts = sortGiftsByMyUsageThenCreatedAt(gifts);

      const [assignedPersonIds, assignedOwnedGiftIds, assignedPublicGiftIds] =
        await Promise.all([
          Person.find({ createdBy: userId, interests: interest._id }).distinct(
            "_id",
          ),

          Gift.find({ createdBy: userId, interests: interest._id }).distinct(
            "_id",
          ),

          GiftInterestLink.find({
            interest: interest._id,
            createdBy: userId,
            isPublic: false,
          }).distinct("gift"),
        ]);

      const assignedGiftIds = new Set([
        ...assignedOwnedGiftIds.map(String),
        ...assignedPublicGiftIds.map(String),
      ]);

      return res.render("interests/edit", {
        interest,
        persons,
        gifts,
        assignedPersonIds: new Set(assignedPersonIds.map(String)),
        assignedGiftIds,
      });
    } catch (err) {
      console.error(err);
      req.session.error = "Fehler beim Laden";
      return res.redirect("/interests");
    }
  },

  async update(req, res) {
    try {
      const userId = req.session.user._id;

      const interest = await Interest.findOne({
        _id: req.params.id,
        createdBy: userId,
        isPublic: { $ne: true },
      });

      if (!interest) {
        req.session.error =
          "Interesse nicht gefunden oder nicht bearbeitbar (Katalog)";
        return res.redirect("/interests");
      }

      const { name, description, icon } = req.body;

      interest.name = name;
      interest.description = description;
      interest.icon = icon || "🎁";
      await interest.save();

      const selectedPersonIds = normalizeIds(req.body.personIds).map(String);

      await Person.updateMany(
        { createdBy: userId },
        { $pull: { interests: interest._id } },
      );

      if (selectedPersonIds.length) {
        await Person.updateMany(
          { createdBy: userId, _id: { $in: selectedPersonIds } },
          { $addToSet: { interests: interest._id } },
        );
      }

      const selectedGiftIds = normalizeIds(req.body.giftIds)
        .map(String)
        .filter(Boolean);

      const selectedGifts = selectedGiftIds.length
        ? await Gift.find({
            _id: { $in: selectedGiftIds },
            $or: [{ createdBy: userId }, { isPublic: true }],
          })
            .select("_id isPublic createdBy")
            .lean()
        : [];

      const selectedOwnedGiftIds = selectedGifts
        .filter((g) => !g.isPublic && String(g.createdBy) === String(userId))
        .map((g) => g._id);

      const selectedPublicGiftIds = selectedGifts
        .filter((g) => g.isPublic)
        .map((g) => g._id);

      await Gift.updateMany(
        { createdBy: userId },
        { $pull: { interests: interest._id } },
      );

      if (selectedOwnedGiftIds.length) {
        await Gift.updateMany(
          { createdBy: userId, _id: { $in: selectedOwnedGiftIds } },
          { $addToSet: { interests: interest._id } },
        );
      }

      await GiftInterestLink.deleteMany({
        createdBy: userId,
        interest: interest._id,
        isPublic: false,
      });

      if (selectedPublicGiftIds.length) {
        const ops = selectedPublicGiftIds.map((gid) => ({
          updateOne: {
            filter: {
              gift: gid,
              interest: interest._id,
              createdBy: userId,
              isPublic: false,
            },
            update: {
              $setOnInsert: {
                gift: gid,
                interest: interest._id,
                createdBy: userId,
                isPublic: false,
              },
            },
            upsert: true,
          },
        }));

        await GiftInterestLink.bulkWrite(ops, { ordered: false });
      }

      req.session.success = "Gespeichert";
      return res.redirect(`/interests/${interest._id}`);
    } catch (err) {
      console.error(err);
      req.session.error = err.message;
      return res.redirect(`/interests/${req.params.id}/edit`);
    }
  },

  async destroy(req, res) {
    try {
      const userId = req.session.user._id;

      const interest = await Interest.findOneAndDelete({
        _id: req.params.id,
        createdBy: userId,
        isPublic: { $ne: true },
      });

      if (!interest) {
        req.session.error =
          "Interesse nicht gefunden oder nicht löschbar (Katalog)";
        return res.redirect("/interests");
      }

      await Promise.all([
        Person.updateMany(
          { createdBy: userId },
          { $pull: { interests: interest._id } },
        ),
        Gift.updateMany(
          { createdBy: userId },
          { $pull: { interests: interest._id } },
        ),
        GiftInterestLink.deleteMany({
          createdBy: userId,
          interest: interest._id,
          isPublic: false,
        }),
      ]);

      req.session.success = "Interesse gelöscht";
      return res.redirect("/interests");
    } catch (err) {
      console.error(err);
      req.session.error = "Löschen fehlgeschlagen";
      return res.redirect("/interests");
    }
  },
};

module.exports = InterestController;
