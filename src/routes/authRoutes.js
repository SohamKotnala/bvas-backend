const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const pool = require("../db");

const router = express.Router();

router.post("/signup", async (req, res) => {
  const { username, password, role, district_code } = req.body;

  if (!username || !password || !role) {
    return res.status(400).json({ message: "Missing fields" });
  }

  try {
    const hashed = await bcrypt.hash(password, 10);

    const user = await pool.query(
      `
      INSERT INTO users (username, password_hash, role, district_code)
      VALUES ($1,$2,$3,$4)
      RETURNING id, role
      `,
      [username, hashed, role, district_code || null]
    );

    if (role === "VENDOR") {
      await pool.query(
        "INSERT INTO vendors (user_id, vendor_name) VALUES ($1,$2)",
        [user.rows[0].id, username]
      );
    }

    res.json({ message: "Signup OK" });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "Signup failed" });
  }
});

router.post("/login", async (req, res) => {
  const { username, password } = req.body;

  const result = await pool.query(
    "SELECT * FROM users WHERE username=$1",
    [username]
  );

  if (!result.rows.length) {
    return res.status(401).json({ message: "Invalid credentials" });
  }

  const user = result.rows[0];
  const ok = await bcrypt.compare(password, user.password_hash);

  if (!ok) {
    return res.status(401).json({ message: "Invalid credentials" });
  }

  const token = jwt.sign(
    { userId: user.id, role: user.role, district_code: user.district_code },
    process.env.JWT_SECRET,
    { expiresIn: "1d" }
  );

  res.json({ token });
});

module.exports = router;
