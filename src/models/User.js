const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const userSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      required: [true, "Username ist erforderlich"],
      unique: true,
      trim: true,
      minlength: [3, "Username muss mindestens 3 Zeichen lang sein"],
    },

    email: {
      type: String,
      required: [true, "E-Mail ist erforderlich"],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, "Bitte gültige E-Mail-Adresse angeben"],
    },

    todoHorizonMonths: {
      type: Number,
      enum: [1, 2, 3, 4, 6, 9, 12],
      default: 3,
    },

    monthlyMailLastSentAt: {
      type: Date,
      default: null,
    },

    xmasMailLastSentAt: {
      type: Date,
      default: null,
    },

    password: {
      type: String,
      required: [true, "Passwort ist erforderlich"],
      minlength: [6, "Passwort muss mindestens 6 Zeichen lang sein"],
    },
  },
  { timestamps: true },
);

userSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();

  try {
    this.password = await bcrypt.hash(this.password, 10);
    next();
  } catch (error) {
    next(error);
  }
});

userSchema.methods.comparePassword = async function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

userSchema.methods.toJSON = function () {
  const obj = this.toObject();
  delete obj.password;
  return obj;
};

userSchema.statics.authenticate = async function (email, password) {
  const emailStr = typeof email === "string" ? email.trim().toLowerCase() : "";
  const passStr = typeof password === "string" ? password : "";

  if (!emailStr || !passStr) return null;

  const user = await this.findOne({ email: emailStr });
  if (!user) return null;

  const isMatch = await user.comparePassword(passStr);
  return isMatch ? user : null;
};

module.exports = mongoose.model("User", userSchema);
