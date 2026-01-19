const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const pool = require("../db");

const router = express.Router();

/**
 * SIGNUP
 */
router.post("/signup", async (req, res) => {
  const { username, password, role, district_code } = req.body;

  if (!username || !password || !role) {
    return res.status(400).json({ message: "Missing required fields" });
  }

  try {
    // check if user already exists
    const existing = await pool.query(
      "SELECT id FROM users WHERE username = $1",
      [username]
    );

    if (existing.rows.length > 0) {
      return res.status(400).json({ message: "Username already exists" });
    }

    // hash password
    const passwordHash = await bcrypt.hash(password, 10);

    // insert user
    const userResult = await pool.query(
      `
      INSERT INTO users (username, password_hash, role, district_code)
      VALUES ($1, $2, $3, $4)
      RETURNING id, role
      `,
      [username, passwordHash, role, district_code || null]
    );

    const userId = userResult.rows[0].id;

    // role-specific inserts
    if (role === "VENDOR") {
      await pool.query(
        `
        INSERT INTO vendors (user_id, vendor_name)
        VALUES ($1, $2)
        `,
        [userId, username]
      );
    }

    if (role === "DISTRICT_VERIFIER") {
      if (!district_code) {
        return res
          .status(400)
          .json({ message: "District is required for verifier" });
      }
      // no separate table needed, district already stored in users
    }

    return res.json({ message: "User created successfully" });
  } catch (err) {
    console.error("Signup error:", err);
    return res.status(500).json({ message: "Signup failed" });
  }
});

/**
 * LOGIN
 */
router.post("/login", async (req, res) => {
  const { username, password } = req.body;

  try {
    const result = await pool.query(
      "SELECT * FROM users WHERE username = $1",
      [username]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const user = result.rows[0];

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const token = jwt.sign(
      {
        userId: user.id,
        role: user.role,
        district_code: user.district_code || null,
      },
      process.env.JWT_SECRET,
      { expiresIn: "1d" }
    );

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        district_code: user.district_code,
      },
    });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ message: "Login failed" });
  }
});

module.exports = router;
