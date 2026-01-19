const express = require("express");
const cors = require("cors");
require("dotenv").config();

const authRoutes = require("./routes/authRoutes");
const vendorRoutes = require("./routes/vendorRoutes");
const verifierRoutes = require("./routes/verifierRoutes");
const hqRoutes = require("./routes/hqRoutes");
const pool = require("./db");

const app = express();

/* ===============================
   CORS (CORRECT & SAFE)
================================ */
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

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
  } catch {
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
   START SERVER
================================ */
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
