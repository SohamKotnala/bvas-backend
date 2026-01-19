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
    return res.status(400).json({ message: "Missing fields" });
  }

  try {
    const passwordHash = await bcrypt.hash(password, 10);

    const result = await pool.query(
      `
      INSERT INTO users (username, password_hash, role, district_code)
      VALUES ($1, $2, $3, $4)
      RETURNING id
      `,
      [username, passwordHash, role, district_code || null]
    );

    const userId = result.rows[0].id;

    if (role === "VENDOR") {
      await pool.query(
        `
        INSERT INTO vendors (user_id, vendor_name)
        VALUES ($1, $2)
        `,
        [userId, username]
      );
    }

    return res.status(201).json({
      message: "Signup successful",
    });
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

  if (!username || !password) {
    return res.status(400).json({ message: "Missing fields" });
  }

  try {
    const result = await pool.query(
      `
      SELECT id, password_hash, role, district_code
      FROM users
      WHERE username = $1
      `,
      [username]
    );

    if (!result.rows.length) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const user = result.rows[0];

    const isValid = await bcrypt.compare(password, user.password_hash);
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

    return res.json({ token });
  } catch (err) {
    console.error("Login error:", err);
    return res.status(500).json({ message: "Login failed" });
  }
});

module.exports = router;
