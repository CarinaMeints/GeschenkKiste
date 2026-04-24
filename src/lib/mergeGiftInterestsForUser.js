const GiftInterestLink = require("../models/GiftInterestLink");

async function mergeGiftInterestsForUser(gifts, userId) {
  const arr = Array.isArray(gifts) ? gifts : gifts ? [gifts] : [];
  if (!arr.length) return gifts;

  const giftIds = arr
    .map((g) => (g && g._id ? String(g._id) : null))
    .filter(Boolean);

  if (!giftIds.length) return gifts;

  const links = await GiftInterestLink.find({
    gift: { $in: giftIds },
    $or: [{ isPublic: true }, { createdBy: userId }],
  })
    .populate({
      path: "interest",
      select: "_id name icon description isPublic createdBy",
    })
    .lean();

  const byGiftId = new Map();
  for (const l of links) {
    const gid = String(l.gift);
    if (!byGiftId.has(gid)) byGiftId.set(gid, []);
    if (l.interest) byGiftId.get(gid).push(l.interest);
  }

  for (const g of arr) {
    if (!g || !g._id) continue;
    const gid = String(g._id);

    const base = Array.isArray(g.interests) ? g.interests : [];
    const extra = byGiftId.get(gid) || [];

    const seen = new Set();
    const merged = [];

    for (const it of [...base, ...extra]) {
      const id = it && it._id ? String(it._id) : String(it);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      merged.push(it);
    }

    g.interests = merged;
  }

  return gifts;
}

module.exports = { mergeGiftInterestsForUser };
