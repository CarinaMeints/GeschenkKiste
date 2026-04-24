const User = require("../models/User");
const Task = require("../models/Task");
const Event = require("../models/Event");
const GiftAssignment = require("../models/GiftAssignment");
const Occasion = require("../models/Occasion");
const PersonOccasion = require("../models/PersonOccasion");
const { sortTasksChronologically } = require("../lib/sortTasks");
const { sendMail } = require("../controllers/mailer");

let _xmasOccasionIdCache = null;
let _mailJobRunning = false;

const APP_BASE_URL_RAW = String(process.env.APP_BASE_URL || "").trim();
const APP_BASE_URL = APP_BASE_URL_RAW.replace(/\/+$/, "");

function canBuildLinks() {
  return (
    APP_BASE_URL.startsWith("http://") || APP_BASE_URL.startsWith("https://")
  );
}

function absUrl(path) {
  if (!canBuildLinks()) return null;
  const p = String(path || "");
  return `${APP_BASE_URL}${p.startsWith("/") ? "" : "/"}${p}`;
}

function normalizeEmailAddr(v) {
  return String(v || "")
    .trim()
    .toLowerCase();
}

function isValidEmailFormat(email) {
  return /^\S+@\S+\.\S+$/.test(String(email || "").trim());
}

function isMailableUser(u) {
  if (!u) return false;
  if (u.mailEnabled === false) return false;

  const email = normalizeEmailAddr(u.email);
  if (!email) return false;
  if (!isValidEmailFormat(email)) return false;

  return true;
}

function startOfMonth(d = new Date()) {
  return new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
}

function startOfIsoWeekLocal(d = new Date()) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const day = x.getDay() || 7;
  x.setDate(x.getDate() - day + 1);
  return x;
}

function lockExpiryDate(now = new Date(), minutes = 30) {
  return new Date(now.getTime() - minutes * 60 * 1000);
}

async function claimMonthlyLock(userId, now = new Date()) {
  const som = startOfMonth(now);
  const expiry = lockExpiryDate(now, 30);

  const res = await User.updateOne(
    {
      _id: userId,
      $and: [
        {
          $or: [
            { monthlyMailLastSentAt: null },
            { monthlyMailLastSentAt: { $lt: som } },
          ],
        },
        {
          $or: [
            { monthlyMailLockAt: null },
            { monthlyMailLockAt: { $exists: false } },
            { monthlyMailLockAt: { $lt: expiry } },
          ],
        },
      ],
    },
    { $set: { monthlyMailLockAt: now } },
  );

  return res.modifiedCount === 1;
}

async function releaseMonthlyLock(userId) {
  await User.updateOne({ _id: userId }, { $set: { monthlyMailLockAt: null } });
}

async function markMonthlySent(userId, now = new Date()) {
  await User.updateOne(
    { _id: userId },
    { $set: { monthlyMailLastSentAt: now, monthlyMailLockAt: null } },
  );
}

async function claimXmasLock(userId, now = new Date()) {
  const sow = startOfIsoWeekLocal(now);
  const expiry = lockExpiryDate(now, 30);

  const res = await User.updateOne(
    {
      _id: userId,
      $and: [
        {
          $or: [
            { xmasMailLastSentAt: null },
            { xmasMailLastSentAt: { $lt: sow } },
          ],
        },
        {
          $or: [
            { xmasMailLockAt: null },
            { xmasMailLockAt: { $exists: false } },
            { xmasMailLockAt: { $lt: expiry } },
          ],
        },
      ],
    },
    { $set: { xmasMailLockAt: now } },
  );

  return res.modifiedCount === 1;
}

async function releaseXmasLock(userId) {
  await User.updateOne({ _id: userId }, { $set: { xmasMailLockAt: null } });
}

async function markXmasSent(userId, now = new Date()) {
  await User.updateOne(
    { _id: userId },
    { $set: { xmasMailLastSentAt: now, xmasMailLockAt: null } },
  );
}

function yearsInRange(fromDate, toDate) {
  const ys = [];
  for (let y = fromDate.getFullYear(); y <= toDate.getFullYear(); y++)
    ys.push(y);
  return ys;
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

function isWithinFirstNDaysOfMonth(now = new Date(), n = 1) {
  return now.getDate() >= 1 && now.getDate() <= n;
}

function isInXmasSeason(now = new Date()) {
  if (String(process.env.MAIL_FORCE_XMAS || "").toLowerCase() === "true") {
    return true;
  }

  const year = now.getFullYear();
  const start = new Date(year, 10, 15);
  const end = new Date(year, 11, 24, 23, 59, 59, 999);
  return now >= start && now <= end;
}

function shouldSendXmasWeekly(lastSentAt, now = new Date()) {
  if (!lastSentAt) return true;
  return isoWeekKey(lastSentAt) !== isoWeekKey(now);
}

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

async function buildTodoDataForUser(userId, { fromDate, toDate }) {
  const years = yearsInRange(fromDate, toDate);

  const openTasksRaw = await Task.find({
    createdBy: userId,
    isDone: false,
    $or: [{ year: { $in: years } }, { year: { $exists: false } }],
  })
    .populate({
      path: "personOccasion",
      populate: [{ path: "person" }, { path: "occasion" }],
    })
    .lean();

  const openTasks = sortTasksChronologically(openTasksRaw);

  const upcomingEvents = await Event.find({
    createdBy: userId,
    status: { $ne: "abgeschlossen" },
    date: { $gte: fromDate, $lte: toDate },
  })
    .populate({
      path: "personOccasion",
      populate: [{ path: "person" }, { path: "occasion" }],
    })
    .sort({ date: 1 })
    .lean();

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
    .sort({ "event.date": 1 })
    .lean();

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

  const years = yearsInRange(fromDate, toDate);

  const openTasksRaw = await Task.find({
    createdBy: userId,
    isDone: false,
    personOccasion: { $in: xmasPoIds },
    $or: [{ year: { $in: years } }, { year: { $exists: false } }],
  })
    .populate({
      path: "personOccasion",
      populate: [{ path: "person" }, { path: "occasion" }],
    })
    .lean();

  const openTasks = sortTasksChronologically(openTasksRaw);

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
    .sort({ date: 1 })
    .lean();

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
    .sort({ "event.date": 1 })
    .lean();

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
  upcomingEvents,
}) {
  const taskCount = (openTasks || []).length;
  const pendingCount = (pendingAssignments || []).length;
  const noGiftCount = (eventsWithoutGift || []).length;

  const dashboardLink = absUrl("/dashboard");
  const logoUrl = absUrl("/img/Logo.png");

  const THEME = {
    pageBg: "#e6f2fd",
    navy: "#0b3b8c",
    tileOuter: "#456caf",
    tileInner: "#6a89bf",

    borderOnDark: "rgba(255,255,255,0.15)",
    borderOnDarkStrong: "rgba(255,255,255,0.22)",

    textOnDark: "#ffffff",
    textOnDarkMuted: "rgba(255,255,255,0.88)",
    textOnDarkMuted2: "rgba(255,255,255,0.75)",
  };

  const FONT_STACK =
    'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

  const RADIUS = "14px";
  const SHADOW = "0 6px 16px rgba(15, 23, 42, 0.15)";

  function safeA(href, label, style) {
    if (!href) return "";
    return `<a href="${escapeHtml(href)}" style="${style}">${escapeHtml(label)}</a>`;
  }

  function btnPrimary(href, label) {
    return safeA(
      href,
      label,
      [
        "display:inline-block",
        `background:${THEME.navy}`,
        `color:${THEME.textOnDark}`,
        "text-decoration:none",
        "padding:10px 14px",
        "border-radius:12px",
        "font-weight:700",
        "font-size:14px",
        `box-shadow:${SHADOW}`,
        "margin:0 12px 12px 0",
      ].join(";"),
    );
  }

  function btnSurface(href, label) {
    return safeA(
      href,
      label,
      [
        "display:inline-block",
        "background:#ffffff",
        `color:${THEME.navy}`,
        "text-decoration:none",
        "padding:10px 14px",
        "border-radius:10px",
        "font-weight:700",
        "font-size:14px",
        "border:1px solid rgba(15,23,42,0.12)",
        "box-shadow:0 1px 2px rgba(15,23,42,0.08)",
        "margin:0 12px 12px 0",
      ].join(";"),
    );
  }

  function metaLine(str) {
    if (!str) return "";
    return `<div style="font-size:13px;color:${THEME.textOnDarkMuted};margin-top:6px;line-height:1.35;">${escapeHtml(
      str,
    )}</div>`;
  }

  function sectionHeader(icon, label, count) {
    return `
      <div style="margin:18px 0 10px 0;">
        <div style="font-size:16px;color:${THEME.textOnDark};font-weight:800;line-height:1.25;">
          ${escapeHtml(icon)} ${escapeHtml(label)}
          <span style="
            display:inline-block;
            margin-left:10px;
            background:rgba(255,255,255,0.14);
            color:${THEME.textOnDark};
            border:1px solid ${THEME.borderOnDark};
            border-radius:999px;
            padding:2px 9px;
            font-size:12px;
            font-weight:800;">
            ${Number(count || 0)}
          </span>
        </div>
      </div>
    `;
  }

  function card(innerHtml) {
    return `
      <div style="
        background:${THEME.tileInner};
        color:${THEME.textOnDark};
        border:1px solid ${THEME.borderOnDark};
        border-radius:12px;
        padding:14px;
        margin:0 0 12px 0;">
        ${innerHtml}
      </div>
    `;
  }

  const brandBlock =
    logoUrl && dashboardLink
      ? `
        <a href="${escapeHtml(dashboardLink)}" style="text-decoration:none;display:inline-flex;align-items:center;gap:10px;">
          <img src="${escapeHtml(logoUrl)}"
               alt="Logo"
               width="36" height="36"
               style="display:block;width:36px;height:36px;border-radius:10px;border:1px solid ${THEME.borderOnDark};">
          <span style="font-size:18px;font-weight:900;letter-spacing:-0.02em;color:${THEME.textOnDark};">
            GeschenkKiste
          </span>
        </a>
      `
      : `
        <div style="font-size:18px;font-weight:900;letter-spacing:-0.02em;color:${THEME.textOnDark};">
          GeschenkKiste
        </div>
      `;

  const tasksHtml = (openTasks || [])
    .map((t) => {
      const personId = t?.personOccasion?.person?._id
        ? String(t.personOccasion.person._id)
        : null;
      const poId = t?.personOccasion?._id ? String(t.personOccasion._id) : null;
      const year = t?.year ? String(t.year) : "";

      const dateLink =
        personId && poId
          ? absUrl(
              `/persons/${personId}/occasions/${poId}/date${
                year ? `?year=${encodeURIComponent(year)}` : ""
              }`,
            )
          : null;

      const metaBits = [
        t?.personOccasion?.person?.name || "",
        t?.personOccasion?.occasion?.name || "",
        year ? `Jahr ${year}` : "",
      ]
        .map((x) => String(x || "").trim())
        .filter(Boolean)
        .join(" · ");

      return card(`
        <div style="font-weight:800;font-size:16px;line-height:1.25;color:${THEME.textOnDark};">
          ${escapeHtml(t?.title || "Aufgabe")}
        </div>
        ${metaLine(metaBits)}
      `);
    })
    .join("");

  const assignmentsHtml = (pendingAssignments || [])
    .map((a) => {
      const giftTitle = a.gift?.title || "Geschenk";
      const ev = a.event;
      const eventId = ev?._id ? String(ev._id) : null;

      const personName = ev?.personOccasion?.person?.name || "Person";
      const occasionName = ev?.personOccasion?.occasion?.name || "Anlass";
      const date = ev?.date
        ? new Date(ev.date).toLocaleDateString("de-DE")
        : "";
      const status = a.status || "";

      return card(`
        <div style="font-weight:800;font-size:16px;line-height:1.25;color:${THEME.textOnDark};">
          ${escapeHtml(giftTitle)}
        </div>
        ${metaLine(`${personName} · ${occasionName} · ${date}${status ? ` · Status: ${status}` : ""}`)}
      `);
    })
    .join("");

  const noGiftHtml = (eventsWithoutGift || [])
    .map((e) => {
      const eventId = e?._id ? String(e._id) : null;

      const personName = e.personOccasion?.person?.name || "Person";
      const occasionName = e.personOccasion?.occasion?.name || "Anlass";
      const date = e.date ? new Date(e.date).toLocaleDateString("de-DE") : "";

      return card(`
        <div style="font-weight:800;font-size:16px;line-height:1.25;color:${THEME.textOnDark};">
          ${escapeHtml(personName)} – ${escapeHtml(occasionName)}
        </div>
        ${metaLine(`📅 ${date}`)}
      `);
    })
    .join("");

  const linksNotice = canBuildLinks()
    ? ""
    : `
      <div style="margin-top:10px;font-size:12px;color:${THEME.textOnDarkMuted2};line-height:1.35;">
        Hinweis: Links sind deaktiviert, weil <code style="color:${THEME.textOnDark};">APP_BASE_URL</code> nicht gesetzt ist.
      </div>
    `;

  return `
  <div style="background:${THEME.pageBg};padding:24px 12px;font-family:${FONT_STACK};line-height:1.45;">
    <div style="max-width:740px;margin:0 auto;">
      <div style="
        background:${THEME.tileOuter};
        color:${THEME.textOnDark};
        border-radius:${RADIUS};
        box-shadow:${SHADOW};
        overflow:hidden;
        border:1px solid ${THEME.borderOnDarkStrong};
      ">
        <div style="padding:18px;border-bottom:1px solid ${THEME.borderOnDark};">
          ${brandBlock}

          <div style="margin-top:10px;font-size:22px;line-height:1.15;color:${THEME.textOnDark};font-weight:900;">
            ${escapeHtml(title)}
          </div>

          <div style="margin-top:8px;font-size:15px;color:${THEME.textOnDarkMuted};">
            Hallo ${escapeHtml(username)},
          </div>

          <div style="margin-top:14px;">
            ${btnPrimary(dashboardLink, "Deine GeschenkKiste öffnen")}
          </div>

          ${linksNotice}
        </div>

        <div style="padding:18px;">
          ${sectionHeader("⚠️", "Events ohne Geschenk", noGiftCount)}
          ${noGiftHtml || `<div style="font-size:15px;color:${THEME.textOnDarkMuted};">Keine Events ohne Geschenk.</div>`}

          ${sectionHeader("🎁", "Offene Geschenk‑Ideen", pendingCount)}
          ${assignmentsHtml || `<div style="font-size:15px;color:${THEME.textOnDarkMuted};">Keine offenen Geschenk‑Zuordnungen.</div>`}

          ${sectionHeader("🗓️", "Fehlende Daten", taskCount)}
          ${tasksHtml || `<div style="font-size:15px;color:${THEME.textOnDarkMuted};">Keine offenen fehlenden Daten.</div>`}
        </div>
      </div>
    </div>
  </div>
  `;
}

function looksLikeHardBounce(err) {
  const code = Number(err?.responseCode || 0);
  if ([550, 551, 552, 553, 554].includes(code)) return true;

  const msg = String(err?.message || "").toLowerCase();
  if (msg.includes("no such user")) return true;
  if (msg.includes("user unknown")) return true;
  if (msg.includes("mailbox") && msg.includes("not found")) return true;
  if (msg.includes("recipient") && msg.includes("rejected")) return true;

  return false;
}

async function disableUserMail(userId, reason) {
  await User.updateOne(
    { _id: userId },
    {
      $set: {
        mailEnabled: false,
        mailDisabledAt: new Date(),
        mailDisabledReason: String(reason || "disabled_by_mail_job").slice(
          0,
          500,
        ),
      },
    },
  );
}

async function sendMonthlyMailForUser(user, now = new Date()) {
  if (!isMailableUser(user)) {
    return {
      type: "monthly",
      user,
      status: "skipped",
      reason: "no_or_invalid_email_or_disabled",
    };
  }

  const claimed = await claimMonthlyLock(user._id, now);
  if (!claimed) {
    return {
      type: "monthly",
      user,
      status: "skipped",
      reason: "already_sent_or_locked",
    };
  }

  const to = normalizeEmailAddr(user.email);

  try {
    const fromDate = startOfNextMonth(now);
    const toDate = endOfNextMonth(now);

    const { openTasks, upcomingEvents, pendingAssignments, eventsWithoutGift } =
      await buildTodoDataForUser(user._id, { fromDate, toDate });

    const subject = `GeschenkKiste – To-Dos für ${fromDate.toLocaleString("de-DE", { month: "long", year: "numeric" })}`;
    const html = renderTodoMailHtml({
      username: user.username,
      title: "Deine To‑Dos für den nächsten Monat",
      openTasks,
      pendingAssignments,
      eventsWithoutGift,
      upcomingEvents,
    });

    const info = await sendMail({
      to,
      subject,
      html,
      text: `Hallo ${user.username}, öffne deine GeschenkKiste: ${absUrl("/dashboard") || ""}`.trim(),
    });

    await markMonthlySent(user._id, now);

    return {
      type: "monthly",
      user,
      status: "sent",
      messageId: info?.messageId || null,
      response: info?.response || "",
    };
  } catch (err) {
    await releaseMonthlyLock(user._id);

    if (looksLikeHardBounce(err)) {
      await disableUserMail(user._id, err?.message || "hard_bounce");
      return {
        type: "monthly",
        user,
        status: "failed",
        reason: "hard_bounce_disabled",
      };
    }

    return {
      type: "monthly",
      user,
      status: "failed",
      reason: err?.message || "send_failed",
    };
  }
}

async function sendXmasWeeklyMailForUser(user, now = new Date()) {
  if (!isMailableUser(user)) {
    return {
      type: "xmas",
      user,
      status: "skipped",
      reason: "no_or_invalid_email_or_disabled",
    };
  }

  const claimed = await claimXmasLock(user._id, now);
  if (!claimed) {
    return {
      type: "xmas",
      user,
      status: "skipped",
      reason: "already_sent_or_locked",
    };
  }

  const to = normalizeEmailAddr(user.email);

  try {
    const fromDate = now;
    const toDate = new Date(now.getFullYear(), 11, 24, 23, 59, 59, 999);

    const { openTasks, upcomingEvents, pendingAssignments, eventsWithoutGift } =
      await buildXmasTodoDataForUser(user._id, { fromDate, toDate });

    const subject = `GeschenkKiste – Weihnachts‑Reminder (${isoWeekKey(now)})`;
    const html = renderTodoMailHtml({
      username: user.username,
      title: "Weihnachts‑To-Dos",
      openTasks,
      pendingAssignments,
      eventsWithoutGift,
      upcomingEvents,
    });

    const info = await sendMail({
      to,
      subject,
      html,
      text: `Hallo ${user.username}, To‑Dos: ${absUrl("/todos") || ""}`.trim(),
    });

    await markXmasSent(user._id, now);

    return {
      type: "xmas",
      user,
      status: "sent",
      messageId: info?.messageId || null,
      response: info?.response || "",
    };
  } catch (err) {
    await releaseXmasLock(user._id);

    if (looksLikeHardBounce(err)) {
      await disableUserMail(user._id, err?.message || "hard_bounce");
      return {
        type: "xmas",
        user,
        status: "failed",
        reason: "hard_bounce_disabled",
      };
    }

    return {
      type: "xmas",
      user,
      status: "failed",
      reason: err?.message || "send_failed",
    };
  }
}

function renderReportHtml(now, results) {
  const sent = results.filter((r) => r.status === "sent");
  const failed = results.filter((r) => r.status === "failed");
  const skipped = results.filter((r) => r.status === "skipped");

  function row(r) {
    const u = r.user || {};
    return `
      <tr>
        <td style="padding:8px;border-bottom:1px solid #e5e7eb;">${escapeHtml(r.type)}</td>
        <td style="padding:8px;border-bottom:1px solid #e5e7eb;">${escapeHtml(String(u.username || ""))}</td>
        <td style="padding:8px;border-bottom:1px solid #e5e7eb;">${escapeHtml(normalizeEmailAddr(u.email || ""))}</td>
        <td style="padding:8px;border-bottom:1px solid #e5e7eb;font-weight:700;">${escapeHtml(r.status)}</td>
        <td style="padding:8px;border-bottom:1px solid #e5e7eb;">${escapeHtml(r.reason || "")}</td>
        <td style="padding:8px;border-bottom:1px solid #e5e7eb;">${escapeHtml(r.messageId || "")}</td>
      </tr>
    `;
  }

  return `
    <div style="font-family:Arial,sans-serif;background:#f3f4f6;padding:16px;">
      <div style="max-width:900px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:14px;">
        <h2 style="margin:0 0 10px 0;">GeschenkKiste – Mailjob Report</h2>
        <div style="color:#6b7280;font-size:12px;margin-bottom:12px;">
          Lauf: ${escapeHtml(new Date(now).toLocaleString("de-DE"))}
        </div>

        <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:12px;">
          <div style="background:#ecfdf5;border:1px solid #a7f3d0;padding:8px 10px;border-radius:10px;">
            <b>Sent:</b> ${sent.length}
          </div>
          <div style="background:#fff7ed;border:1px solid #fed7aa;padding:8px 10px;border-radius:10px;">
            <b>Skipped:</b> ${skipped.length}
          </div>
          <div style="background:#fef2f2;border:1px solid #fecaca;padding:8px 10px;border-radius:10px;">
            <b>Failed:</b> ${failed.length}
          </div>
        </div>

        <table style="width:100%;border-collapse:collapse;font-size:12px;">
          <thead>
            <tr>
              <th style="text-align:left;padding:8px;border-bottom:2px solid #e5e7eb;">Type</th>
              <th style="text-align:left;padding:8px;border-bottom:2px solid #e5e7eb;">Username</th>
              <th style="text-align:left;padding:8px;border-bottom:2px solid #e5e7eb;">Email</th>
              <th style="text-align:left;padding:8px;border-bottom:2px solid #e5e7eb;">Status</th>
              <th style="text-align:left;padding:8px;border-bottom:2px solid #e5e7eb;">Reason</th>
              <th style="text-align:left;padding:8px;border-bottom:2px solid #e5e7eb;">MessageId</th>
            </tr>
          </thead>
          <tbody>
            ${(results || []).map(row).join("")}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

async function sendMailJobReport(now, results) {
  const enabled =
    String(process.env.MAIL_REPORT_ENABLED || "").toLowerCase() === "true";
  if (!enabled) return;

  const to =
    normalizeEmailAddr(process.env.MAIL_REPORT_TO || "") ||
    normalizeEmailAddr(process.env.MAIL_FROM || "") ||
    normalizeEmailAddr(process.env.MAIL_USER || "");

  if (!to || !isValidEmailFormat(to)) return;

  await sendMail({
    to,
    subject: `GeschenkKiste – Mailjob Report (${new Date(now).toLocaleString("de-DE")})`,
    html: renderReportHtml(now, results),
    text: `Mailjob Report: sent=${results.filter((r) => r.status === "sent").length}, skipped=${results.filter((r) => r.status === "skipped").length}, failed=${results.filter((r) => r.status === "failed").length}`,
  });
}

async function runMailSchedulerOnce(now = new Date()) {
  if (_mailJobRunning) {
    console.log("[MailJob] skip (already running)");
    return;
  }
  _mailJobRunning = true;

  const results = [];

  try {
    const users = await User.find({})
      .select(
        "_id username email mailEnabled monthlyMailLastSentAt xmasMailLastSentAt",
      )
      .lean();

    const monthlyWindowDays = parseInt(
      process.env.MAIL_MONTHLY_WINDOW_DAYS || "1",
      10,
    );
    const forceMonthly = process.env.MAIL_FORCE_MONTHLY === "true";

    for (const u of users) {
      try {
        const shouldMonthly =
          (forceMonthly || isWithinFirstNDaysOfMonth(now, monthlyWindowDays)) &&
          !sameMonth(u.monthlyMailLastSentAt, now);

        if (!shouldMonthly) {
          results.push({
            type: "monthly",
            user: u,
            status: "skipped",
            reason: "outside_window_or_already_sent",
          });
        } else {
          results.push(await sendMonthlyMailForUser(u, now));
        }
      } catch (err) {
        console.error(
          `[MailJob] monthly error user=${u._id} email=${u.email}`,
          err,
        );
        results.push({
          type: "monthly",
          user: u,
          status: "failed",
          reason: err?.message || "monthly_failed",
        });
      }

      try {
        const shouldXmas =
          isInXmasSeason(now) &&
          shouldSendXmasWeekly(u.xmasMailLastSentAt, now);
        if (!shouldXmas) {
          results.push({
            type: "xmas",
            user: u,
            status: "skipped",
            reason: "not_in_season_or_already_sent",
          });
        } else {
          results.push(await sendXmasWeeklyMailForUser(u, now));
        }
      } catch (err) {
        console.error(
          `[MailJob] xmas error user=${u._id} email=${u.email}`,
          err,
        );
        results.push({
          type: "xmas",
          user: u,
          status: "failed",
          reason: err?.message || "xmas_failed",
        });
      }
    }

    await sendMailJobReport(now, results);
  } finally {
    _mailJobRunning = false;
  }
}

module.exports = {
  runMailSchedulerOnce,
  sendMonthlyMailForUser,
  sendXmasWeeklyMailForUser,
};
