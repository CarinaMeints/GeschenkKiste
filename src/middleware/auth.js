function requireAuth(req, res, next) {
  if (!req.session.user) {
    req.session.error = "Bitte melde dich an";
    return res.redirect("/login");
  }
  next();
}

function redirectIfAuth(req, res, next) {
  if (req.session.user) {
    return res.redirect("/dashboard");
  }
  next();
}

module.exports = { requireAuth, redirectIfAuth };
