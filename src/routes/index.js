const express = require("express");
const router = express.Router();

const CalendarController = require("../controllers/CalendarController");
const { requireAuth, redirectIfAuth } = require("../middleware/auth");
const { ensureHorizonEvents } = require("../middleware/ensureHorizonEvents");

const AuthController = require("../controllers/AuthController");
const DashboardController = require("../controllers/DashboardController");
const EventController = require("../controllers/EventController");
const PersonController = require("../controllers/PersonController");
const GiftController = require("../controllers/GiftController");
const GiftAssignmentController = require("../controllers/GiftAssignmentController");
const OccasionController = require("../controllers/OccasionController");
const InterestController = require("../controllers/InterestController");
const ToDoController = require("../controllers/ToDoController");
const ShareController = require("../controllers/ShareController");
const DataController = require("../controllers/DataController");
const SettingsController = require("../controllers/SettingsController");

router.get("/", (req, res) => {
  if (req.session?.user) return res.redirect("/dashboard");
  return res.render("landing");
});

router.get("/help", requireAuth, (req, res) => {
  const returnTo =
    typeof req.query.returnTo === "string" && req.query.returnTo.startsWith("/")
      ? req.query.returnTo
      : "/dashboard";

  res.render("help", { returnTo });
});

router.get("/register", redirectIfAuth, AuthController.showRegister);
router.post("/register", redirectIfAuth, AuthController.register);

router.get("/login", redirectIfAuth, AuthController.showLogin);
router.post("/login", redirectIfAuth, AuthController.login);

router.post("/logout", AuthController.logout);

router.get("/share/event/:token", ShareController.viewSharedEvent);
router.get("/share/person/:token", ShareController.viewSharedPerson);

router.use(requireAuth);
router.use(ensureHorizonEvents);

router.get("/dashboard", DashboardController.index);

router.post("/share/event/:eventId", ShareController.createEventShare);
router.post("/share/person/:personId", ShareController.createPersonShare);
router.delete("/share/:type/:token", ShareController.revokeShare);

router.get("/events", EventController.index);
router.get("/events/calendar", EventController.calendar);

router.get("/events/:id", EventController.show);
router.patch("/events/:id/complete", EventController.markComplete);
router.put("/events/:id/complete", EventController.markComplete);
router.post("/events/:id/complete-with-gift", EventController.completeWithGift);
router.delete("/events/:id", EventController.destroy);

router.get("/persons", PersonController.index);
router.get("/persons/new", PersonController.new);
router.post("/persons", PersonController.create);

router.post(
  "/persons/:id/interests/:interestId",
  PersonController.addInterestToPerson,
);

router.get("/persons/:id", PersonController.show);
router.get("/persons/:id/edit", PersonController.edit);

router.patch("/persons/:id", PersonController.update);
router.put("/persons/:id", PersonController.update);

router.post("/persons/:id/history", PersonController.addHistoryGift);
router.delete("/persons/:id", PersonController.destroy);

router.get("/persons/:id/occasions", PersonController.showOccasions);
router.post("/persons/:id/occasions", PersonController.assignOccasion);
router.delete("/persons/:id/occasions/:poId", PersonController.removeOccasion);

router.patch(
  "/persons/:id/occasions/:poId",
  PersonController.updatePersonOccasion,
);
router.put(
  "/persons/:id/occasions/:poId",
  PersonController.updatePersonOccasion,
);

router.get(
  "/persons/:id/occasions/:poId/date",
  PersonController.editOccasionDate,
);
router.patch(
  "/persons/:id/occasions/:poId/date",
  PersonController.updateOccasionDate,
);
router.put(
  "/persons/:id/occasions/:poId/date",
  PersonController.updateOccasionDate,
);

router.get("/gifts", GiftController.index);
router.get("/gifts/new", GiftController.new);
router.post("/gifts", GiftController.create);

router.get("/gifts/:id", GiftController.show);
router.get("/gifts/:id/edit", GiftController.edit);

router.get("/api/gifts/options", GiftController.options);
router.get("/api/interests/options", InterestController.options);
router.get("/api/events/:id/assignments", EventController.apiAssignments);

router.patch("/gifts/:id", GiftController.update);
router.put("/gifts/:id", GiftController.update);

router.delete("/gifts/:id", GiftController.destroy);

router.post("/gifts/:id/images", GiftController.addImages);
router.delete("/gifts/:id/images/:imageId", GiftController.removeImage);
router.patch(
  "/gifts/:id/images/:imageId/primary",
  GiftController.setPrimaryImage,
);
router.put(
  "/gifts/:id/images/:imageId/primary",
  GiftController.setPrimaryImage,
);

router.post(
  "/events/:eventId/assignments/new-gift",
  GiftAssignmentController.createWithNewGift,
);
router.post("/events/:eventId/assignments", GiftAssignmentController.create);
router.post(
  "/gifts/:id/assign-to-event",
  GiftAssignmentController.createFromGift,
);

router.patch("/assignments/:id/status", GiftAssignmentController.updateStatus);
router.put("/assignments/:id/status", GiftAssignmentController.updateStatus);

router.delete("/assignments/:id", GiftAssignmentController.destroy);

router.get("/occasions", OccasionController.index);
router.get("/occasions/new", OccasionController.new);
router.post("/occasions", OccasionController.create);

router.get("/occasions/:id", OccasionController.show);
router.get("/occasions/:id/edit", OccasionController.edit);

router.put("/occasions/:id", OccasionController.update);
router.patch("/occasions/:id", OccasionController.update);

router.patch("/occasions/:id/people", OccasionController.updatePeople);
router.put("/occasions/:id/people", OccasionController.updatePeople);

router.delete("/occasions/:id", OccasionController.destroy);

router.get("/interests", InterestController.index);
router.get("/interests/new", InterestController.new);
router.post("/interests", InterestController.create);

router.get("/interests/:id", InterestController.show);
router.get("/interests/:id/edit", InterestController.edit);

router.put("/interests/:id", InterestController.update);
router.patch("/interests/:id", InterestController.update);

router.delete("/interests/:id", InterestController.destroy);

router.get("/todos", ToDoController.index);

router.get("/data/export", (req, res) => res.redirect(302, "/data"));
router.get("/data", DataController.index);

router.get("/settings", SettingsController.index);
router.post("/settings", SettingsController.update);

router.get("/api/calendar/month", CalendarController.month);

module.exports = router;
