const mongoose = require("mongoose");
const { sanitizeIcon } = require("../lib/sanitizeIcon");
const { isValidDayMonth } = require("../lib/dateValidation");

const occasionSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      trim: true,
    },
    icon: {
      type: String,
      default: "🎉",
      set: (v) => sanitizeIcon(v, "🎉"),
    },
    day: {
      type: Number,
      min: 1,
      max: 31,
    },
    month: {
      type: Number,
      min: 1,
      max: 12,
    },
    isRecurring: {
      type: Boolean,
      default: true,
    },
    isBirthday: {
      type: Boolean,
      default: false,
    },
    isPublic: {
      type: Boolean,
      default: false,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: function () {
        return !this.isPublic;
      },
    },
  },
  { timestamps: true },
);

occasionSchema.virtual("hasFixedDate").get(function () {
  return this.day != null && this.month != null;
});

occasionSchema.statics.findForUser = function (userId) {
  return this.find({
    $or: [{ createdBy: userId }, { isPublic: true }],
  }).sort({ name: 1 });
};

occasionSchema.set("toJSON", { virtuals: true });
occasionSchema.set("toObject", { virtuals: true });

occasionSchema.pre("validate", function (next) {
  const hasDay = this.day != null;
  const hasMonth = this.month != null;

  if (hasDay !== hasMonth) {
    return next(
      new Error(
        "Ungültig: day und month müssen beide gesetzt oder beide leer sein.",
      ),
    );
  }

  if (hasDay && hasMonth) {
    if (!isValidDayMonth(this.day, this.month, { allowFeb29: true })) {
      return next(
        new Error(
          "Ungültiges Datum für festen Anlass (z.B. 31.02 ist nicht erlaubt).",
        ),
      );
    }
  }

  return next();
});

module.exports = mongoose.model("Occasion", occasionSchema);
