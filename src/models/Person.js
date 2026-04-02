const mongoose = require("mongoose");
const { isValidDayMonth } = require("../lib/dateValidation");

const personSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Name ist erforderlich"],
      trim: true,
    },
    notes: {
      type: String,
      trim: true,
    },

    birthdayDay: {
      type: Number,
      min: 1,
      max: 31,
    },
    birthdayMonth: {
      type: Number,
      min: 1,
      max: 12,
    },

    interests: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Interest",
      },
    ],
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  { timestamps: true },
);

personSchema.pre("validate", function (next) {
  const hasDay = this.birthdayDay != null;
  const hasMonth = this.birthdayMonth != null;

  if (hasDay !== hasMonth) {
    return next(
      new Error(
        "birthdayDay und birthdayMonth müssen beide gesetzt oder beide leer sein",
      ),
    );
  }

  if (hasDay && hasMonth) {
    if (
      !isValidDayMonth(this.birthdayDay, this.birthdayMonth, {
        allowFeb29: true,
      })
    ) {
      return next(
        new Error(
          "Ungültiges Datum: Geburtstag ist nicht möglich (z.B. 31.02).",
        ),
      );
    }
  }

  next();
});

personSchema.virtual("hasBirthday").get(function () {
  return this.birthdayDay != null && this.birthdayMonth != null;
});

personSchema.virtual("nextBirthday").get(function () {
  if (!this.hasBirthday) return null;

  const now = new Date();
  const year = now.getFullYear();
  let next = new Date(year, this.birthdayMonth - 1, this.birthdayDay);

  if (next < now)
    next = new Date(year + 1, this.birthdayMonth - 1, this.birthdayDay);
  return next;
});

personSchema.statics.findForUser = function (userId) {
  return this.find({ createdBy: userId })
    .populate("interests")
    .sort({ name: 1 });
};

module.exports = mongoose.model("Person", personSchema);
