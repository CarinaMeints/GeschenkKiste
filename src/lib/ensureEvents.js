const Event = require("../models/Event");
const PersonOccasion = require("../models/PersonOccasion");
const Task = require("../models/Task");

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function addMonths(date, months) {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

function yearsInRangeFromHorizon(months) {
  const now = startOfDay(new Date());
  const until = startOfDay(addMonths(now, months || 3));

  const years = [];
  for (let y = now.getFullYear(); y <= until.getFullYear(); y++) years.push(y);
  return years;
}

async function ensureEventsForYears(userId, years) {
  const links = await PersonOccasion.findForUser(userId);

  for (const year of years) {
    for (const link of links) {
      if (!link.isActiveInYear(year)) continue;

      const date = await link.getDateForYear(year);

      if (date) {
        await Event.findOrCreate(link._id, year, date, userId);

        await Task.updateMany(
          { personOccasion: link._id, year, createdBy: userId, isDone: false },
          { $set: { isDone: true, doneAt: new Date() } },
        );
      } else {
        await Task.createDateTask(link._id, year, userId);
      }
    }
  }
}

module.exports = {
  ensureEventsForYears,
  yearsInRangeFromHorizon,
};
