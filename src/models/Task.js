const mongoose = require("mongoose");

const taskSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, "Titel ist erforderlich"],
      trim: true,
    },

    personOccasion: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "PersonOccasion",
    },

    year: {
      type: Number,
    },

    isDone: {
      type: Boolean,
      default: false,
    },

    doneAt: {
      type: Date,
    },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  { timestamps: true },
);

taskSchema.index({ createdBy: 1, isDone: 1 });
taskSchema.index({ personOccasion: 1, year: 1 });

taskSchema.methods.complete = function () {
  this.isDone = true;
  this.doneAt = new Date();
  return this.save();
};

taskSchema.statics.findOpenForUser = function (userId) {
  return this.find({ createdBy: userId, isDone: false })
    .populate({
      path: "personOccasion",
      populate: [{ path: "person" }, { path: "occasion" }],
    })
    .sort({ createdAt: 1 });
};

taskSchema.statics.createDateTask = async function (
  personOccasionId,
  year,
  userId,
) {
  const PersonOccasion = mongoose.model("PersonOccasion");
  const po = await PersonOccasion.findOne({
    _id: personOccasionId,
    createdBy: userId,
  })
    .populate("person")
    .populate("occasion");

  const exists = await this.findOne({
    personOccasion: personOccasionId,
    year,
    createdBy: userId,
    isDone: false,
  });

  if (exists) return exists;

  return this.create({
    title: `Datum für ${po.occasion.name} ${year} (${po.person.name}) hinterlegen`,
    personOccasion: personOccasionId,
    year,
    createdBy: userId,
  });
};

module.exports = mongoose.model("Task", taskSchema);
