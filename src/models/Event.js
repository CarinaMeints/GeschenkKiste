const mongoose = require("mongoose");

const eventSchema = new mongoose.Schema(
  {
    personOccasion: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "PersonOccasion",
      required: true,
    },

    year: {
      type: Number,
      required: true,
      min: 2000,
      max: 9999,
    },

    date: {
      type: Date,
      required: true,
    },

    status: {
      type: String,
      enum: ["offen", "in_planung", "abgeschlossen"],
      default: "offen",
    },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  { timestamps: true },
);

eventSchema.index({ personOccasion: 1, year: 1 }, { unique: true });
eventSchema.index({ date: 1 });
eventSchema.index({ createdBy: 1 });

eventSchema.virtual("daysUntil").get(function () {
  const now = new Date();
  const d1 = new Date(now);
  d1.setHours(0, 0, 0, 0);
  const d2 = new Date(this.date);
  d2.setHours(0, 0, 0, 0);
  const diff = d2.getTime() - d1.getTime();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
});

eventSchema.methods.recalculateStatus = async function () {
  const GiftAssignment = mongoose.model("GiftAssignment");

  const assignments = await GiftAssignment.find({
    event: this._id,
    createdBy: this.createdBy,
  })
    .select("status")
    .lean();

  if (assignments.length === 0) {
    this.status = "offen";
    await this.save();
    return this;
  }

  const anyDone = assignments.some((a) => a.status === "fertig");

  if (anyDone) {
    this.status = "abgeschlossen";
  } else {
    this.status = "in_planung";
  }

  await this.save();
  return this;
};

eventSchema.methods.getAssignments = function () {
  const GiftAssignment = mongoose.model("GiftAssignment");
  return GiftAssignment.find({
    event: this._id,
    createdBy: this.createdBy,
  }).populate({
    path: "gift",
    populate: { path: "interests" },
  });
};

eventSchema.statics.findForUser = function (userId, year = null) {
  const query = { createdBy: userId };
  if (year) query.year = year;

  return this.find(query)
    .populate({
      path: "personOccasion",
      populate: [{ path: "person" }, { path: "occasion" }],
    })
    .sort({ date: 1 });
};

eventSchema.statics.findForPerson = async function (personId, userId) {
  const PersonOccasion = mongoose.model("PersonOccasion");
  const links = await PersonOccasion.find({
    person: personId,
    createdBy: userId,
  });
  const linkIds = links.map((l) => l._id);

  return this.find({
    personOccasion: { $in: linkIds },
    createdBy: userId,
  })
    .populate({
      path: "personOccasion",
      populate: [{ path: "person" }, { path: "occasion" }],
    })
    .sort({ date: 1 });
};

eventSchema.statics.findOrCreate = async function (
  personOccasionId,
  year,
  date,
  userId,
) {
  return this.findOneAndUpdate(
    { personOccasion: personOccasionId, year, createdBy: userId },
    {
      $set: {
        date,
        year,
      },
      $setOnInsert: {
        status: "offen",
      },
    },
    { upsert: true, new: true },
  );
};

module.exports = mongoose.model("Event", eventSchema);
