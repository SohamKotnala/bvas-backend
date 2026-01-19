const bcrypt = require("bcryptjs");
const pool = require("../db");

async function hashpassword_hashs() {
  const password_hash = "temp123";
  const salt = await bcrypt.genSalt(10);
  const hash = await bcrypt.hash(password_hash, salt);

  await pool.query(
    "UPDATE users SET password_hash_hash = $1 WHERE password_hash_hash = 'temp123'",
    [hash]
  );

  console.log("password_hashs hashed successfully");
  process.exit();
}

hashpassword_hashs().catch(console.error);
