function requireCompleteProfile(req, res, next) {
  if (req.user.role === "VENDOR" && !req.user.profileComplete) {
    return res.status(403).json({
      message: "Vendor profile incomplete. Complete profile before proceeding."
    });
  }
  next();
}

module.exports = { requireCompleteProfile };
