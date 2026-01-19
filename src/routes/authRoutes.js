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
    return res.status(400).json({ message: "All fields are required" });
  }

  if (role === "DISTRICT_VERIFIER" && !district_code) {
    return res
      .status(400)
      .json({ message: "District is required for verifier" });
  }

  try {
    // Check existing user
    const existing = await pool.query(
      "SELECT id FROM users WHERE username = $1",
      [username]
    );

    if (existing.rows.length > 0) {
      return res.status(400).json({ message: "Username already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user
    const userResult = await pool.query(
      `
      INSERT INTO users (username, password, role, district_code)
      VALUES ($1, $2, $3, $4)
      RETURNING id
      `,
      [username, hashedPassword, role, district_code || null]
    );

    const userId = userResult.rows[0].id;

    // Role-specific inserts
    if (role === "VENDOR") {
      await pool.query(
        "INSERT INTO vendors (user_id) VALUES ($1)",
        [userId]
      );
    }

    if (role === "DISTRICT_VERIFIER") {
      await pool.query(
        "INSERT INTO verifiers (user_id, district_code) VALUES ($1, $2)",
        [userId, district_code]
      );
    }

    // HQ_ADMIN → no extra table

    res.status(201).json({ message: "User created successfully" });
  } catch (err) {
    console.error("Signup error:", err);
    res.status(500).json({ message: "Signup failed" });
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
    const isValid = await bcrypt.compare(password, user.password);

    if (!isValid) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const token = jwt.sign(
      {
        userId: user.id,
        role: user.role,
        district_code: user.district_code,
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
