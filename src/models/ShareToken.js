const mongoose = require("mongoose");
const crypto = require("crypto");

const shareTokenSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ["event", "person"],
      required: true,
    },
    targetId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      refPath: "typeModel",
    },
    typeModel: {
      type: String,
      required: true,
      enum: ["Event", "Person"],
    },
    token: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    expiresAt: {
      type: Date,
      default: null,
    },
    accessCount: {
      type: Number,
      default: 0,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  },
);

shareTokenSchema.statics.generateToken = function () {
  return crypto.randomBytes(16).toString("hex");
};

shareTokenSchema.statics.findOrCreate = async function (
  type,
  targetId,
  userId,
) {
  let token = await this.findOne({
    type,
    targetId,
    createdBy: userId,
    isActive: true,
  });

  if (!token) {
    const typeModel = type === "event" ? "Event" : "Person";

    token = await this.create({
      type,
      targetId,
      typeModel,
      token: this.generateToken(),
      createdBy: userId,
    });
  }

  return token;
};

shareTokenSchema.methods.isValid = function () {
  if (!this.isActive) return false;
  if (this.expiresAt && this.expiresAt < new Date()) return false;
  return true;
};

shareTokenSchema.methods.deactivate = async function () {
  this.isActive = false;
  await this.save();
};

shareTokenSchema.index({ type: 1, targetId: 1, createdBy: 1 });
shareTokenSchema.index({ createdBy: 1, isActive: 1 });

module.exports =
  mongoose.models.ShareToken || mongoose.model("ShareToken", shareTokenSchema);
