const User = require("../models/User");
const Task = require("../models/Task");
const Event = require("../models/Event");
const GiftAssignment = require("../models/GiftAssignment");
const Occasion = require("../models/Occasion");
const PersonOccasion = require("../models/PersonOccasion");

const { sendMail } = require("../controllers/mailer");

let _xmasOccasionIdCache = null;

async function getXmasOccasionId() {
  if (_xmasOccasionIdCache) return _xmasOccasionIdCache;

  const occ = await Occasion.findOne({
    name: "Weihnachten",
    day: 24,
    month: 12,
    isPublic: true,
  }).select("_id");

  _xmasOccasionIdCache = occ?._id || null;
  return _xmasOccasionIdCache;
}

async function buildXmasTodoDataForUser(userId, { fromDate, toDate }) {
  const xmasOccasionId = await getXmasOccasionId();
  if (!xmasOccasionId) {
    return {
      openTasks: [],
      upcomingEvents: [],
      pendingAssignments: [],
      eventsWithoutGift: [],
    };
  }

  const xmasPoIds = await PersonOccasion.find({
    createdBy: userId,
    occasion: xmasOccasionId,
  }).distinct("_id");

  if (!xmasPoIds.length) {
    return {
      openTasks: [],
      upcomingEvents: [],
      pendingAssignments: [],
      eventsWithoutGift: [],
    };
  }

  const openTasks = await Task.find({
    createdBy: userId,
    isDone: false,
    personOccasion: { $in: xmasPoIds },
  })
    .populate({
      path: "personOccasion",
      populate: [{ path: "person" }, { path: "occasion" }],
    })
    .sort({ createdAt: 1 });

  const upcomingEvents = await Event.find({
    createdBy: userId,
    status: { $ne: "abgeschlossen" },
    personOccasion: { $in: xmasPoIds },
    date: { $gte: fromDate, $lte: toDate },
  })
    .populate({
      path: "personOccasion",
      populate: [{ path: "person" }, { path: "occasion" }],
    })
    .sort({ date: 1 });

  const upcomingEventIds = upcomingEvents.map((e) => e._id);

  const pendingAssignments = await GiftAssignment.find({
    createdBy: userId,
    status: { $ne: "fertig" },
    event: { $in: upcomingEventIds },
  })
    .populate("gift")
    .populate({
      path: "event",
      populate: {
        path: "personOccasion",
        populate: [{ path: "person" }, { path: "occasion" }],
      },
    })
    .sort({ "event.date": 1 });

  const assignedEventIdsRaw = await GiftAssignment.distinct("event", {
    createdBy: userId,
    event: { $in: upcomingEventIds },
  });

  const assignedEventIds = new Set(
    assignedEventIdsRaw.map((id) => id.toString()),
  );
  const eventsWithoutGift = upcomingEvents.filter(
    (e) => !assignedEventIds.has(e._id.toString()),
  );

  return { openTasks, upcomingEvents, pendingAssignments, eventsWithoutGift };
}

function startOfNextMonth(now = new Date()) {
  return new Date(now.getFullYear(), now.getMonth() + 1, 1);
}

function endOfNextMonth(now = new Date()) {
  return new Date(now.getFullYear(), now.getMonth() + 2, 0, 23, 59, 59, 999);
}

function sameMonth(a, b) {
  return (
    a &&
    b &&
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth()
  );
}

function isoWeekKey(date = new Date()) {
  const d = new Date(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()),
  );
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${week}`;
}

function isInXmasSeason(now = new Date()) {
  const year = now.getFullYear();
  const start = new Date(year, 10, 15);
  const end = new Date(year, 11, 24, 23, 59, 59, 999);
  return now >= start && now <= end;
}

function shouldSendXmasWeekly(lastSentAt, now = new Date()) {
  if (!lastSentAt) return true;
  return isoWeekKey(lastSentAt) !== isoWeekKey(now);
}

async function buildTodoDataForUser(userId, { fromDate, toDate }) {
  const openTasks = await Task.findOpenForUser(userId);

  const upcomingEvents = await Event.find({
    createdBy: userId,
    status: { $ne: "abgeschlossen" },
    date: { $gte: fromDate, $lte: toDate },
  })
    .populate({
      path: "personOccasion",
      populate: [{ path: "person" }, { path: "occasion" }],
    })
    .sort({ date: 1 });

  const upcomingEventIds = upcomingEvents.map((e) => e._id);

  const pendingAssignments = await GiftAssignment.find({
    createdBy: userId,
    status: { $ne: "fertig" },
    event: { $in: upcomingEventIds },
  })
    .populate("gift")
    .populate({
      path: "event",
      populate: {
        path: "personOccasion",
        populate: [{ path: "person" }, { path: "occasion" }],
      },
    })
    .sort({ "event.date": 1 });

  const assignedEventIdsRaw = await GiftAssignment.distinct("event", {
    createdBy: userId,
    event: { $in: upcomingEventIds },
  });

  const assignedEventIds = new Set(
    assignedEventIdsRaw.map((id) => id.toString()),
  );
  const eventsWithoutGift = upcomingEvents.filter(
    (e) => !assignedEventIds.has(e._id.toString()),
  );

  return { openTasks, upcomingEvents, pendingAssignments, eventsWithoutGift };
}

function escapeHtml(str) {
  return String(str || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderTodoMailHtml({
  username,
  title,
  openTasks,
  pendingAssignments,
  eventsWithoutGift,
}) {
  const tasksHtml = (openTasks || [])
    .map((t) => `<li>${escapeHtml(t.title)}</li>`)
    .join("");
  const assignmentsHtml = (pendingAssignments || [])
    .map((a) => {
      const giftTitle = a.gift?.title || "Geschenk";
      const personName = a.event?.personOccasion?.person?.name || "Person";
      const occasionName = a.event?.personOccasion?.occasion?.name || "Anlass";
      const status = a.status || "";
      return `<li><strong>${escapeHtml(giftTitle)}</strong> – ${escapeHtml(personName)} (${escapeHtml(occasionName)}), Status: ${escapeHtml(status)}</li>`;
    })
    .join("");

  const noGiftHtml = (eventsWithoutGift || [])
    .map((e) => {
      const personName = e.personOccasion?.person?.name || "Person";
      const occasionName = e.personOccasion?.occasion?.name || "Anlass";
      const date = e.date ? new Date(e.date).toLocaleDateString("de-DE") : "";
      return `<li>${escapeHtml(personName)} – ${escapeHtml(occasionName)} am ${escapeHtml(date)}</li>`;
    })
    .join("");

  return `
  <div style="font-family: Arial, sans-serif; line-height: 1.4;">
    <h2>${escapeHtml(title)}</h2>
    <p>Hallo ${escapeHtml(username)},</p>

    <h3>🗓️ Fehlende Daten</h3>
    ${tasksHtml ? `<ul>${tasksHtml}</ul>` : `<p>Keine offenen Fehlende Daten.</p>`}

    <h3>🎁 Offene Geschenk-Zuordnungen</h3>
    ${assignmentsHtml ? `<ul>${assignmentsHtml}</ul>` : `<p>Keine offenen Geschenk-Zuordnungen.</p>`}

    <h3>⚠️ Events ohne Geschenk</h3>
    ${noGiftHtml ? `<ul>${noGiftHtml}</ul>` : `<p>Keine Events ohne Geschenk.</p>`}

    <hr/>
    <p style="font-size: 12px; color: #666;">
      Automatisch generiert am ${escapeHtml(new Date().toLocaleDateString("de-DE"))}
    </p>
  </div>
  `;
}

async function sendMonthlyMailForUser(user, now = new Date()) {
  const fromDate = startOfNextMonth(now);
  const toDate = endOfNextMonth(now);

  const { openTasks, pendingAssignments, eventsWithoutGift } =
    await buildTodoDataForUser(user._id, { fromDate, toDate });

  const subject = `GeschenkKiste – To-Dos für ${fromDate.toLocaleString("de-DE", { month: "long", year: "numeric" })}`;
  const html = renderTodoMailHtml({
    username: user.username,
    title: "📋 Deine To-Dos für den nächsten Monat",
    openTasks,
    pendingAssignments,
    eventsWithoutGift,
  });

  await sendMail({
    to: user.email,
    subject,
    html,
    text: "Deine To-Dos (HTML-Mail).",
  });

  await User.updateOne(
    { _id: user._id },
    { $set: { monthlyMailLastSentAt: now } },
  );
}

function isWithinFirstNDaysOfMonth(now = new Date(), n = 1) {
  return now.getDate() >= 1 && now.getDate() <= n;
}

async function sendXmasWeeklyMailForUser(user, now = new Date()) {
  const fromDate = now;
  const toDate = new Date(now.getFullYear(), 11, 24, 23, 59, 59, 999);

  const { openTasks, pendingAssignments, eventsWithoutGift } =
    await buildXmasTodoDataForUser(user._id, { fromDate, toDate });

  const subject = `GeschenkKiste – Weihnachts-Reminder (Woche ${isoWeekKey(now)})`;

  const html = renderTodoMailHtml({
    username: user.username,
    title: "🎄 Weihnachts-Reminder (nur Weihnachten)",
    openTasks,
    pendingAssignments,
    eventsWithoutGift,
  });

  await sendMail({
    to: user.email,
    subject,
    html,
    text: "Weihnachts-Reminder (HTML-Mail).",
  });

  await User.updateOne(
    { _id: user._id },
    { $set: { xmasMailLastSentAt: now } },
  );
}

async function runMailSchedulerOnce(now = new Date()) {
  const users = await User.find({})
    .select("_id username email monthlyMailLastSentAt xmasMailLastSentAt")
    .lean();

  const monthlyWindowDays = parseInt(
    process.env.MAIL_MONTHLY_WINDOW_DAYS || "1",
    10,
  );
  const forceMonthly = process.env.MAIL_FORCE_MONTHLY === "true";

  for (const u of users) {
    if (!u.email) continue;

    try {
      const shouldSendMonthly =
        (forceMonthly || isWithinFirstNDaysOfMonth(now, monthlyWindowDays)) &&
        !sameMonth(u.monthlyMailLastSentAt, now);

      if (shouldSendMonthly) {
        await sendMonthlyMailForUser(u, now);
      }
    } catch (err) {
      console.error(
        `[MailJob] monthly failed for user=${u._id} email=${u.email}`,
        err,
      );
    }

    try {
      if (
        isInXmasSeason(now) &&
        shouldSendXmasWeekly(u.xmasMailLastSentAt, now)
      ) {
        await sendXmasWeeklyMailForUser(u, now);
      }
    } catch (err) {
      console.error(
        `[MailJob] xmas failed for user=${u._id} email=${u.email}`,
        err,
      );
    }
  }
}

module.exports = {
  runMailSchedulerOnce,

  sendMonthlyMailForUser,
  sendXmasWeeklyMailForUser,
};
