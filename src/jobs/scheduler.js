const cron = require("node-cron");
const { runMailSchedulerOnce } = require("./mailJobs");

let _started = false;

function startSchedulers() {
  if (_started) return;
  _started = true;

  cron.schedule(
    "00 08 * * *",
    async () => {
      try {
        console.log("[Scheduler] mail job start");
        await runMailSchedulerOnce();
        console.log("[Scheduler] mail job done");
      } catch (err) {
        console.error("[Scheduler] mail job error", err);
      }
    },
    { timezone: "Europe/Berlin" },
  );

  console.log("[Scheduler] started");
}

module.exports = { startSchedulers };
