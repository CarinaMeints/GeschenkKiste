const mongoose = require("mongoose");
const { sanitizeIcon } = require("../lib/sanitizeIcon");

const interestSchema = new mongoose.Schema(
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
      default: "🎁",
      set: (v) => sanitizeIcon(v, "🎁"),
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

interestSchema.statics.findForUser = function (userId) {
  return this.find({ $or: [{ createdBy: userId }, { isPublic: true }] }).sort({
    name: 1,
  });
};

interestSchema.methods.makePublic = async function () {
  const User = mongoose.model("User");
  const adminUser = await User.findOne({ email: "admin@GeschenkKiste.local" });

  if (!adminUser) {
    throw new Error("Admin-User nicht gefunden. Bitte Seeds ausführen.");
  }

  this.isPublic = true;
  this.createdBy = adminUser._id;
  await this.save();
};

module.exports = mongoose.model("Interest", interestSchema);
