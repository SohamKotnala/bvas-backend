const bcrypt = require("bcryptjs");
const pool = require("../db");

async function hashPasswords() {
  const password = "temp123";
  const salt = await bcrypt.genSalt(10);
  const hash = await bcrypt.hash(password, salt);

  await pool.query(
    "UPDATE users SET password_hash = $1 WHERE password_hash = 'temp123'",
    [hash]
  );

  console.log("Passwords hashed successfully");
  process.exit();
}

hashPasswords().catch(console.error);
