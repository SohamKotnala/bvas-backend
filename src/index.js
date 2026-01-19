const express = require("express");
const cors = require("cors");
const authRoutes = require("./routes/authRoutes");
const { authenticateToken, authorizeRoles } = require("./middleware/authMiddleware");
const vendorRoutes = require("./routes/vendorRoutes");
const verifierRoutes = require("./routes/verifierRoutes");
const hqRoutes = require("./routes/hqRoutes");


require("dotenv").config();

const pool = require("./db");

const app = express();

app.use(cors());
app.use(express.json());

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

const PORT = process.env.PORT || 5000;

app.use("/api/auth", authRoutes);

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

app.use("/api/vendor", vendorRoutes);

app.use("/api/verifier", verifierRoutes);

app.use("/api/hq", hqRoutes);


app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
