const multer = require("multer");
const path = require("path");
const fs = require("fs");
const mongoose = require("mongoose");
const { PUBLIC_DIR } = require("./paths");

const storage = multer.diskStorage({
  destination(req, file, cb) {
    const rawGiftId = req.params.id;

    const giftId =
      rawGiftId && mongoose.Types.ObjectId.isValid(String(rawGiftId))
        ? String(rawGiftId)
        : `temp-${String(req.session?.user?._id || "anon")}`;

    const dir = path.join(PUBLIC_DIR, "uploads", "gifts", giftId);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },

  filename(req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
    cb(null, `${unique}${ext}`);
  },
});

const fileFilter = (req, file, cb) => {
  const allowedExt = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"]);
  const ext = path.extname(file.originalname).toLowerCase();

  const mime = String(file.mimetype || "").toLowerCase();
  const isImageMime = mime.startsWith("image/");

  if (!allowedExt.has(ext)) {
    return cb(
      new Error("Nur Bilder erlaubt (.jpg, .jpeg, .png, .webp, .gif)"),
      false,
    );
  }
  if (!isImageMime) {
    return cb(
      new Error("Upload abgelehnt: Datei ist kein Bild (MIME)."),
      false,
    );
  }

  cb(null, true);
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024,
    files: 10,
  },
});

function deleteUploadedFile(filePathOrUrl) {
  const rel = String(filePathOrUrl || "").replace(/^\/+/, "");

  if (!rel.startsWith("uploads/")) return;

  const abs = path.join(PUBLIC_DIR, rel);
  if (fs.existsSync(abs)) fs.unlinkSync(abs);
}

function deleteGiftFolder(giftId) {
  const dir = path.join(PUBLIC_DIR, "uploads", "gifts", String(giftId));
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

module.exports = { upload, deleteUploadedFile, deleteGiftFolder };
