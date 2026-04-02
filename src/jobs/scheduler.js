const cron = require("node-cron");
const { runMailSchedulerOnce } = require("./mailJobs");

function startSchedulers() {
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
    {
      timezone: "Europe/Berlin",
    },
  );
}

module.exports = { startSchedulers };
