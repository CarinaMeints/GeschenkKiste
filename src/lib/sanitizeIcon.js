function sanitizeIcon(input, fallback = "🎁") {
  const raw = String(input ?? "").trim();

  if (!raw) return fallback;

  if (/[<>&"'`]/.test(raw)) return fallback;

  if (/[\u0000-\u001F\u007F]/.test(raw)) return fallback;

  const cps = Array.from(raw);
  if (cps.length > 8) return fallback;

  return cps.join("");
}

module.exports = { sanitizeIcon };
