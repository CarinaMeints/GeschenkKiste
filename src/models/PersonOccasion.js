const mongoose = require("mongoose");
const { isValidDayMonth } = require("../lib/dateValidation");

const personOccasionSchema = new mongoose.Schema(
  {
    person: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Person",
      required: true,
    },

    occasion: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Occasion",
      required: true,
    },

    startYear: {
      type: Number,
      required: true,
      default: () => new Date().getFullYear(),
    },

    customYear: {
      type: Number,
      min: 2000,
      max: 2100,
    },

    endYear: {
      type: Number,
    },

    customDay: {
      type: Number,
      min: 1,
      max: 31,
    },

    customMonth: {
      type: Number,
      min: 1,
      max: 12,
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

personOccasionSchema.index(
  { person: 1, occasion: 1, createdBy: 1 },
  { unique: true },
);

personOccasionSchema.pre("validate", async function (next) {
  try {
    const hasDay = this.customDay != null;
    const hasMonth = this.customMonth != null;

    if (
      this.endYear != null &&
      this.startYear != null &&
      this.endYear < this.startYear
    ) {
      return next(new Error("endYear darf nicht kleiner als startYear sein"));
    }

    if (hasDay !== hasMonth) {
      return next(
        new Error(
          "customDay und customMonth müssen beide gesetzt oder beide leer sein",
        ),
      );
    }

    if (hasDay && hasMonth) {
      if (this.customYear == null) {
        return next(
          new Error(
            "customYear ist erforderlich, wenn customDay/customMonth gesetzt sind",
          ),
        );
      }

      if (
        !isValidDayMonth(this.customDay, this.customMonth, { allowFeb29: true })
      ) {
        return next(
          new Error(
            "Ungültiges Datum: customDay/customMonth Kombination ist nicht möglich (z.B. 31.02).",
          ),
        );
      }

      const day = Number(this.customDay);
      const month = Number(this.customMonth);
      const year = Number(this.customYear);

      if (month === 2 && day === 29) {
        const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;

        if (!isLeap) {
          return next(
            new Error(`Ungültiges Datum: 29.02.${year} ist kein Schaltjahr.`),
          );
        }
      }

      const Occasion = mongoose.model("Occasion");

      const occasionDoc =
        this.occasion &&
        typeof this.occasion === "object" &&
        this.occasion.day !== undefined
          ? this.occasion
          : await Occasion.findById(this.occasion).lean();

      if (!occasionDoc) {
        return next(new Error("Occasion nicht gefunden"));
      }

      const hasFixedDate = occasionDoc.day != null && occasionDoc.month != null;
      const isBirthday = occasionDoc.isBirthday === true;

      if (hasFixedDate || isBirthday) {
        return next(
          new Error(
            "customDay/customMonth sind nur für bewegliche Anlässe erlaubt (nicht für feste Anlässe oder Geburtstage).",
          ),
        );
      }
    }

    return next();
  } catch (err) {
    return next(err);
  }
});

personOccasionSchema.virtual("isActiveInYear").get(function () {
  return (year) => {
    if (year < this.startYear) return false;
    if (this.endYear != null && year > this.endYear) return false;
    return true;
  };
});

personOccasionSchema.virtual("customDate").get(function () {
  if (this.customDay != null && this.customMonth != null) {
    return new Date(2000, this.customMonth - 1, this.customDay);
  }
  return null;
});

personOccasionSchema.methods.getDateForYear = async function (year) {
  const occasion = this.occasion;
  const person = this.person;

  if (occasion.day != null && occasion.month != null) {
    return new Date(year, occasion.month - 1, occasion.day);
  }

  if (occasion.isBirthday === true) {
    if (person.hasBirthday) {
      return new Date(year, person.birthdayMonth - 1, person.birthdayDay);
    }
    return null;
  }

  if (this.customYear === year && this.customDay && this.customMonth) {
    return new Date(year, this.customMonth - 1, this.customDay);
  }

  return null;
};

personOccasionSchema.statics.findForUser = function (userId) {
  return this.find({ createdBy: userId })
    .populate("person")
    .populate("occasion")
    .sort({ createdAt: 1 });
};

personOccasionSchema.statics.findForPerson = function (personId, userId) {
  return this.find({ person: personId, createdBy: userId }).populate(
    "occasion",
  );
};

personOccasionSchema.statics.findForOccasion = function (occasionId, userId) {
  return this.find({ occasion: occasionId, createdBy: userId }).populate(
    "person",
  );
};

personOccasionSchema.statics.deleteWithDependents = async function ({
  userId,
  filter,
  session = null,
}) {
  const Event = mongoose.model("Event");
  const Task = mongoose.model("Task");
  const GiftAssignment = mongoose.model("GiftAssignment");

  const q = { ...filter, createdBy: userId };

  const links = await this.find(q).select("_id").session(session);
  const linkIds = links.map((l) => l._id);

  if (linkIds.length === 0) {
    return {
      linksDeleted: 0,
      eventsDeleted: 0,
      assignmentsDeleted: 0,
      tasksDeleted: 0,
    };
  }

  const taskRes = await Task.deleteMany({
    personOccasion: { $in: linkIds },
    createdBy: userId,
  }).session(session);

  const events = await Event.find({
    personOccasion: { $in: linkIds },
    createdBy: userId,
  })
    .select("_id")
    .session(session);

  const eventIds = events.map((e) => e._id);

  let assignmentsDeleted = 0;
  let eventsDeleted = 0;

  if (eventIds.length > 0) {
    const gaRes = await GiftAssignment.deleteMany({
      event: { $in: eventIds },
      createdBy: userId,
    }).session(session);
    assignmentsDeleted = gaRes.deletedCount || 0;

    const evRes = await Event.deleteMany({
      _id: { $in: eventIds },
      createdBy: userId,
    }).session(session);
    eventsDeleted = evRes.deletedCount || 0;
  }

  const linkRes = await this.deleteMany({
    _id: { $in: linkIds },
    createdBy: userId,
  }).session(session);

  return {
    linksDeleted: linkRes.deletedCount || 0,
    eventsDeleted,
    assignmentsDeleted,
    tasksDeleted: taskRes.deletedCount || 0,
  };
};

module.exports = mongoose.model("PersonOccasion", personOccasionSchema);
