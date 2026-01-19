const express = require("express");
const cors = require("cors");
require("dotenv").config();

const authRoutes = require("./routes/authRoutes");
const vendorRoutes = require("./routes/vendorRoutes");
const verifierRoutes = require("./routes/verifierRoutes");
const hqRoutes = require("./routes/hqRoutes");
const { authenticateToken, authorizeRoles } = require("./middleware/authMiddleware");
const pool = require("./db");

const app = express();

/* ===============================
   ✅ CORS (FIXED FOR NODE 22)
================================ */
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

/* ❌ REMOVE THIS LINE — IT BREAKS EXPRESS 5 / NODE 22
app.options("*", cors());
*/

app.use(express.json());

/* ===============================
   HEALTH CHECK
================================ */
app.get("/", async (req, res) => {
  try {
    const result = await pool.query("SELECT NOW()");
    res.json({
      message: "BVAS Backend Running",
      dbTime: result.rows[0].now,
    });
  } catch (err) {
    console.error(err);
    res.status(500).send("Database connection error");
  }
});

/* ===============================
   ROUTES
================================ */
app.use("/api/auth", authRoutes);
app.use("/api/vendor", vendorRoutes);
app.use("/api/verifier", verifierRoutes);
app.use("/api/hq", hqRoutes);

/* ===============================
   PROTECTED TEST ROUTES
================================ */
app.get(
  "/api/protected/vendor",
  authenticateToken,
  authorizeRoles("VENDOR"),
  (req, res) => {
    res.json({
      message: "Vendor access granted",
      user: req.user,
    });
  }
);

app.get(
  "/api/protected/verifier",
  authenticateToken,
  authorizeRoles("DISTRICT_VERIFIER"),
  (req, res) => {
    res.json(req.user);
  }
);

/* ===============================
   SERVER
================================ */
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
