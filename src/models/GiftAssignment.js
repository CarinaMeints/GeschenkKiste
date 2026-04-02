const mongoose = require("mongoose");

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

giftAssignmentSchema.pre("save", function (next) {
  this._wasNew = this.isNew;
  next();
});

giftAssignmentSchema.post("save", async function (doc) {
  const Event = mongoose.model("Event");
  const Gift = mongoose.model("Gift");

  const event = await Event.findById(doc.event);
  if (event) await event.recalculateStatus();

  if (doc._wasNew) {
    await Gift.updateOne({ _id: doc.gift }, { $inc: { usageCount: 1 } });
  }
});

giftAssignmentSchema.post("findOneAndDelete", async function (doc) {
  if (!doc) return;

  const Event = mongoose.model("Event");
  const Gift = mongoose.model("Gift");

  const event = await Event.findById(doc.event);
  if (event) await event.recalculateStatus();

  await Gift.updateOne({ _id: doc.gift }, { $inc: { usageCount: -1 } });

  await Gift.updateOne(
    { _id: doc.gift, usageCount: { $lt: 0 } },
    { $set: { usageCount: 0 } },
  );
});

giftAssignmentSchema.pre(
  "deleteMany",
  { query: true, document: false },
  async function (next) {
    try {
      const filter = this.getFilter();
      const session = this.getOptions()?.session || null;

      let q = this.model.find(filter).select("gift").lean();
      if (session) q = q.session(session);

      const docs = await q;
      const counts = new Map();

      for (const d of docs) {
        const gid = String(d.gift);
        counts.set(gid, (counts.get(gid) || 0) + 1);
      }

      this._giftCountsToDecrement = counts;
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
    const counts = this._giftCountsToDecrement;
    if (!counts || counts.size === 0) return;

    const Gift = mongoose.model("Gift");

    const ops = [];
    for (const [giftId, n] of counts.entries()) {
      ops.push({
        updateOne: {
          filter: { _id: giftId },
          update: { $inc: { usageCount: -n } },
        },
      });
    }

    await Gift.bulkWrite(ops, { ordered: false });

    await Gift.updateMany(
      { _id: { $in: Array.from(counts.keys()) }, usageCount: { $lt: 0 } },
      { $set: { usageCount: 0 } },
    );
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
