const mongoose = require("mongoose");

const giftInterestLinkSchema = new mongoose.Schema(
  {
    gift: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Gift",
      required: true,
      index: true,
    },
    interest: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Interest",
      required: true,
      index: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    isPublic: {
      type: Boolean,
      default: false,
      index: true,
    },
  },
  { timestamps: true },
);

giftInterestLinkSchema.index(
  { gift: 1, interest: 1, createdBy: 1, isPublic: 1 },
  { unique: true },
);

giftInterestLinkSchema.index(
  { gift: 1, interest: 1, isPublic: 1 },
  { unique: true, partialFilterExpression: { isPublic: true } },
);

module.exports = mongoose.model("GiftInterestLink", giftInterestLinkSchema);
