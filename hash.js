const bcrypt = require("bcryptjs");

async function run() {
  const passwords = {
    vendor1: "vendor@123",
    verifier1: "verifier@123",
    hq1: "hq@123"
  };

  for (const [user, pass] of Object.entries(passwords)) {
    const hash = await bcrypt.hash(pass, 10);
    console.log(user, "=>", hash);
  }
}

run();