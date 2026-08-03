function superRequired(req, res, next) {
  if (req.session && req.session.isSuper) {
    return next();
  }
  res.redirect('/superadmin/login');
}

module.exports = superRequired;
