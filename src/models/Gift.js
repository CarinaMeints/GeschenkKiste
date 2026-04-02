const mongoose = require("mongoose");

const imageSchema = new mongoose.Schema(
  {
    url: { type: String, required: true },
    caption: { type: String },
    isPrimary: { type: Boolean, default: false },
  },
  { _id: true },
);

const giftSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      trim: true,
    },
    link: {
      type: String,
      trim: true,
    },
    interests: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Interest",
      },
    ],
    images: [imageSchema],
    usageCount: {
      type: Number,
      default: 0,
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

giftSchema.virtual("primaryImage").get(function () {
  const primary = this.images.find((img) => img.isPrimary);
  return primary || this.images[0] || null;
});

giftSchema.statics.findForUser = function (userId) {
  return this.find({
    $or: [{ createdBy: userId }, { isPublic: true }],
  })
    .populate("interests")
    .sort({ usageCount: -1, createdAt: -1 });
};

giftSchema.statics.recommendForEvent = async function (
  eventId,
  userId,
  limit = 10,
) {
  const Event = mongoose.model("Event");
  const GiftAssignment = mongoose.model("GiftAssignment");
  const PersonOccasion = mongoose.model("PersonOccasion");

  const event = await Event.findById(eventId).populate({
    path: "personOccasion",
    populate: { path: "person" },
  });

  if (!event || !event.personOccasion?.person?._id) return [];

  const person = event.personOccasion.person;
  const personId = person._id;

  const poIds = await PersonOccasion.find({
    person: personId,
    createdBy: userId,
  }).distinct("_id");

  const personEventIds = poIds.length
    ? await Event.find({
        createdBy: userId,
        personOccasion: { $in: poIds },
      }).distinct("_id")
    : [];

  const allAssignments = personEventIds.length
    ? await GiftAssignment.find({
        createdBy: userId,
        event: { $in: personEventIds },
      })
        .select("gift status")
        .populate({ path: "gift", select: "interests" })
        .lean()
    : [];

  const excludedGiftIds = new Set();

  const seedInterestIds = new Set(
    (person.interests || []).map((x) => String(x?._id || x)).filter(Boolean),
  );

  for (const a of allAssignments) {
    const gid = a?.gift?._id ? String(a.gift._id) : String(a.gift);
    if (gid) excludedGiftIds.add(gid);

    const giftInterests = a?.gift?.interests || [];
    for (const intId of giftInterests) {
      seedInterestIds.add(String(intId?._id || intId));
    }
  }

  const gifts = await this.findForUser(userId);

  const seedSet = seedInterestIds;

  const scored = gifts
    .filter((g) => !excludedGiftIds.has(String(g._id)))
    .map((gift) => {
      let score = 0;

      const giftInterestIds = (gift.interests || []).map((i) =>
        String(i?._id || i),
      );

      for (const id of giftInterestIds) {
        if (seedSet.has(id)) score += 3;
      }

      score += Math.min((gift.usageCount || 0) / 5, 2);

      return { gift, score };
    });

  scored.sort(
    (a, b) =>
      b.score - a.score || (b.gift.usageCount || 0) - (a.gift.usageCount || 0),
  );

  return scored.slice(0, limit).map((x) => x.gift);
};

giftSchema.methods.addUploadedImages = function (files) {
  files.forEach((file) => {
    const url = `/uploads/gifts/${this._id}/${file.filename}`;
    this.images.push({ url, isPrimary: this.images.length === 0 });
  });
};

giftSchema.methods.removeImage = function (imageId) {
  this.images = this.images.filter((img) => img._id.toString() !== imageId);
  if (this.images.length > 0 && !this.images.some((img) => img.isPrimary)) {
    this.images[0].isPrimary = true;
  }
};

giftSchema.methods.setPrimaryImage = function (imageId) {
  this.images.forEach((img) => {
    img.isPrimary = img._id.toString() === imageId;
  });
};

const fs = require("fs");
const path = require("path");
const { PUBLIC_DIR } = require("../config/paths");

function deleteGiftFolder(giftId) {
  const dir = path.join(PUBLIC_DIR, "uploads", "gifts", String(giftId));
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

giftSchema.post("findOneAndDelete", function (doc) {
  if (doc) deleteGiftFolder(doc._id);
});

giftSchema.set("toJSON", { virtuals: true });
giftSchema.set("toObject", { virtuals: true });

module.exports = mongoose.model("Gift", giftSchema);
