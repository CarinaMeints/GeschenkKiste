function normalizeHttpUrl(input) {
  const s = String(input ?? "").trim();
  if (!s) return "";

  let url;
  try {
    url = new URL(s);
  } catch {
    return null;
  }

  const proto = String(url.protocol || "").toLowerCase();
  if (proto !== "http:" && proto !== "https:") return null;

  return url.toString();
}

module.exports = { normalizeHttpUrl };
