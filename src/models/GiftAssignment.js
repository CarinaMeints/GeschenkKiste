const mongoose = require("mongoose");
require("./GiftUsage");

const giftAssignmentSchema = new mongoose.Schema(
  {
    gift: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Gift",
      required: true,
    },

    event: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Event",
      required: true,
    },

    status: {
      type: String,
      enum: ["Idee", "fertig"],
      default: "Idee",
    },

    notes: {
      type: String,
      trim: true,
    },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  { timestamps: true },
);

giftAssignmentSchema.index({ gift: 1, event: 1 }, { unique: true });
giftAssignmentSchema.index({ event: 1 });
giftAssignmentSchema.index({ createdBy: 1 });
giftAssignmentSchema.index({ status: 1 });

giftAssignmentSchema.pre("save", async function (next) {
  try {
    this._wasNew = this.isNew;

    if (!this.isNew) {
      const session =
        typeof this.$session === "function" ? this.$session() : null;

      let q = this.constructor.findById(this._id).select("status").lean();
      if (session) q = q.session(session);

      const prev = await q;
      this._prevStatus = prev?.status || null;
    } else {
      this._prevStatus = null;
    }

    next();
  } catch (err) {
    next(err);
  }
});

giftAssignmentSchema.post("save", async function (doc) {
  const Event = mongoose.model("Event");
  const GiftUsage = mongoose.model("GiftUsage");

  const event = await Event.findById(doc.event);
  if (event) await event.recalculateStatus();

  const prev = doc._prevStatus;

  const becameDone =
    doc.status === "fertig" && (doc._wasNew || prev !== "fertig");

  const becameNotDone = doc.status !== "fertig" && prev === "fertig";

  if (becameDone) {
    await GiftUsage.increment({
      giftId: doc.gift,
      userId: doc.createdBy,
      delta: 1,
      session: typeof doc.$session === "function" ? doc.$session() : null,
    });
  } else if (becameNotDone) {
    await GiftUsage.increment({
      giftId: doc.gift,
      userId: doc.createdBy,
      delta: -1,
      session: typeof doc.$session === "function" ? doc.$session() : null,
    });
  }
});

giftAssignmentSchema.post("findOneAndDelete", async function (doc) {
  if (!doc) return;

  const Event = mongoose.model("Event");
  const GiftUsage = mongoose.model("GiftUsage");

  const event = await Event.findById(doc.event);
  if (event) await event.recalculateStatus();

  if (doc.status === "fertig") {
    await GiftUsage.increment({
      giftId: doc.gift,
      userId: doc.createdBy,
      delta: -1,
      session: this.getOptions?.().session || null,
    });
  }
});

giftAssignmentSchema.pre(
  "deleteMany",
  { query: true, document: false },
  async function (next) {
    try {
      const filter = this.getFilter();
      const session = this.getOptions()?.session || null;

      let q = this.model
        .find({ ...filter, status: "fertig" })
        .select("gift createdBy")
        .lean();

      if (session) q = q.session(session);

      const docs = await q;

      const byUser = new Map();

      for (const d of docs) {
        const userId = String(d.createdBy);
        const giftId = String(d.gift);

        if (!byUser.has(userId)) byUser.set(userId, new Map());
        const m = byUser.get(userId);

        m.set(giftId, (m.get(giftId) || 0) + 1);
      }

      this._giftCountsToDecrementByUser = byUser;
      next();
    } catch (err) {
      next(err);
    }
  },
);

giftAssignmentSchema.post(
  "deleteMany",
  { query: true, document: false },
  async function () {
    const byUser = this._giftCountsToDecrementByUser;
    if (!byUser || byUser.size === 0) return;

    const GiftUsage = mongoose.model("GiftUsage");
    const session = this.getOptions()?.session || null;

    const ops = [];

    for (const [userId, giftMap] of byUser.entries()) {
      for (const [giftId, n] of giftMap.entries()) {
        ops.push({
          updateOne: {
            filter: { createdBy: userId, gift: giftId },
            update: { $inc: { count: -n } },
            upsert: true,
          },
        });
      }
    }

    if (ops.length) {
      await GiftUsage.bulkWrite(ops, {
        ordered: false,
        session: session || undefined,
      });

      // clamp < 0
      const clampQuery = GiftUsage.updateMany(
        { count: { $lt: 0 } },
        { $set: { count: 0 } },
      );
      if (session) clampQuery.session(session);
      await clampQuery;
    }
  },
);

giftAssignmentSchema.virtual("isIdea").get(function () {
  return this.status === "Idee";
});

giftAssignmentSchema.virtual("isPurchased").get(function () {
  return this.status === "fertig";
});

giftAssignmentSchema.methods.advanceStatus = function () {
  const flow = ["Idee", "fertig"];
  const idx = flow.indexOf(this.status);

  if (idx >= flow.length - 1) {
    throw new Error("Bereits im finalen Status");
  }

  this.status = flow[idx + 1];
  return this.save();
};

giftAssignmentSchema.statics.findForEvent = function (eventId) {
  return this.find({ event: eventId })
    .populate({ path: "gift", populate: { path: "interests" } })
    .sort({ status: 1, createdAt: 1 });
};

giftAssignmentSchema.statics.findPending = function (userId) {
  return this.find({ createdBy: userId, status: { $ne: "fertig" } })
    .populate({ path: "gift", populate: { path: "interests" } })
    .populate({
      path: "event",
      populate: {
        path: "personOccasion",
        populate: [{ path: "person" }, { path: "occasion" }],
      },
    })
    .sort({ "event.date": 1 });
};

giftAssignmentSchema.statics.findGiftedForPerson = async function (
  personId,
  userId,
) {
  const Event = mongoose.model("Event");
  const PersonOccasion = mongoose.model("PersonOccasion");

  const links = await PersonOccasion.find({
    person: personId,
    createdBy: userId,
  })
    .select("_id")
    .lean();
  const linkIds = links.map((l) => l._id);

  const events = await Event.find({
    createdBy: userId,
    personOccasion: { $in: linkIds },
    status: "abgeschlossen",
  })
    .select("_id date")
    .lean();

  const eventIds = events.map((e) => e._id);

  const assignments = await this.find({
    event: { $in: eventIds },
    status: "fertig",
    createdBy: userId,
  })
    .populate({ path: "gift", populate: { path: "interests" } })
    .populate({
      path: "event",
      populate: { path: "personOccasion", populate: ["person", "occasion"] },
    })
    .lean();

  assignments.sort((a, b) => {
    const da = a?.event?.date ? new Date(a.event.date).getTime() : 0;
    const db = b?.event?.date ? new Date(b.event.date).getTime() : 0;
    return db - da;
  });

  return assignments;
};

module.exports = mongoose.model("GiftAssignment", giftAssignmentSchema);
