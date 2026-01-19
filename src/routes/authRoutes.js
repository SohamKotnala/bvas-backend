const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const pool = require("../db");

const router = express.Router();

router.post("/login", async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ message: "Username and password required" });
  }

  try {
    const result = await pool.query(
      "SELECT id, username, password_hash, role, district_code FROM users WHERE username = $1 AND is_active = true",
      [username]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const user = result.rows[0];
    const isMatch = await bcrypt.compare(password, user.password_hash);

    if (!isMatch) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

const token = jwt.sign(
  {
    userId: user.id,
    role: user.role,
    district: user.district_code || null,
  },
  process.env.JWT_SECRET,
  { expiresIn: "8h" }
);

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        district: user.district_code,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

router.post("/signup", async (req, res) => {
  const { username, password, role, district_code } = req.body;

  if (!username || !password || !role) {
    return res.status(400).json({ message: "Required fields missing" });
  }

  // allowed roles
  const allowedRoles = ["VENDOR", "DISTRICT_VERIFIER", "HQ_ADMIN"];
  if (!allowedRoles.includes(role)) {
    return res.status(400).json({ message: "Invalid role" });
  }

  try {
    // check if username exists
    const existing = await pool.query(
      "SELECT id FROM users WHERE username = $1",
      [username]
    );

    if (existing.rows.length > 0) {
      return res.status(400).json({ message: "Username already exists" });
    }

    // hash password
    const salt = await bcrypt.genSalt(10);
    const password_hash = await bcrypt.hash(password, salt);

    // create user
    const userResult = await pool.query(
      `
      INSERT INTO users (username, password_hash, role, district_code, is_active)
      VALUES ($1, $2, $3, $4, true)
      RETURNING id, role
      `,
      [
        username,
        password_hash,
        role,
        role === "DISTRICT_VERIFIER" ? district_code : null,
      ]
    );

    const userId = userResult.rows[0].id;

    // auto-create vendor profile
    if (role === "VENDOR") {
      await pool.query(
        `
        INSERT INTO vendors (user_id, vendor_name)
        VALUES ($1, $2)
        `,
        [userId, username]
      );
    }

    res.status(201).json({
      message: "User created successfully",
      userId,
      role,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;
