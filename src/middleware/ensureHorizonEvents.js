const {
  ensureEventsForYears,
  yearsInRangeFromHorizon,
} = require("../lib/ensureEvents");

const syncCache = new Map();
const inFlight = new Map();
const TTL_MS = 60 * 1000;

function cacheKey(userId, years) {
  const min = years[0];
  const max = years[years.length - 1];
  return `${String(userId)}:${min}-${max}`;
}

function invalidateHorizonSync(userId) {
  const prefix = `${String(userId)}:`;
  for (const k of syncCache.keys()) {
    if (k.startsWith(prefix)) syncCache.delete(k);
  }
}

async function ensureHorizonEvents(req, res, next) {
  try {
    if (!req.session?.user?._id) return next();

    if (req.method !== "GET") return next();

    const userId = req.session.user._id;
    const months = req.session.user.todoHorizonMonths || 3;

    const years = yearsInRangeFromHorizon(months);
    const key = cacheKey(userId, years);

    const last = syncCache.get(key);
    if (last && Date.now() - last < TTL_MS) return next();

    if (inFlight.has(key)) {
      await inFlight.get(key);
      return next();
    }

    const p = (async () => {
      await ensureEventsForYears(userId, years);
      syncCache.set(key, Date.now());
    })()
      .catch((err) => console.error("[ensureHorizonEvents] error", err))
      .finally(() => inFlight.delete(key));

    inFlight.set(key, p);

    await p;

    return next();
  } catch (err) {
    console.error("[ensureHorizonEvents] middleware failed", err);
    return next();
  }
}

module.exports = { ensureHorizonEvents, invalidateHorizonSync };
