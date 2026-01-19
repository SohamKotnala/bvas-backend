const jwt = require("jsonwebtoken");

function authenticateToken(req, res, next) {
  console.log("AUTH HEADER:", req.headers.authorization);

  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    return res.status(401).json({ message: "Access token required" });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ message: "Invalid or expired token" });
    }

    console.log("JWT USER PAYLOAD:", user);
    
    req.user = user;
    next();
  });
}


function authorizeRoles(...allowedRoles) {
  return (req, res, next) => {
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ message: "Forbidden: insufficient role" });
    }
    next();
  };
}

module.exports = {
  authenticateToken,
  authorizeRoles,
};
