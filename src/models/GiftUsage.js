const mongoose = require("mongoose");

const giftUsageSchema = new mongoose.Schema(
  {
    gift: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Gift",
      required: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    count: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  { timestamps: true },
);

giftUsageSchema.index({ gift: 1, createdBy: 1 }, { unique: true });

giftUsageSchema.statics.increment = async function ({
  giftId,
  userId,
  delta = 1,
  session = null,
}) {
  if (!giftId || !userId || !delta) return;

  const filter = { gift: giftId, createdBy: userId };
  const opts = { upsert: true };
  if (session) opts.session = session;

  await this.updateOne(filter, { $inc: { count: delta } }, opts);

  if (delta < 0) {
    await this.updateOne(filter, { $max: { count: 0 } }, opts);
  }
};

module.exports = mongoose.model("GiftUsage", giftUsageSchema);
