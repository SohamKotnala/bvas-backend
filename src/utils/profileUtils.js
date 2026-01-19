async function updateVendorProfileStatus(pool, vendorId) {
  const result = await pool.query(
    `
    SELECT vendor_name, district_code, is_active
    FROM vendors
    WHERE id = $1
    `,
    [vendorId]
  );

  if (result.rows.length === 0) return;

  const v = result.rows[0];

  const isComplete =
    v.vendor_name &&
    v.district_code &&
    v.is_active === true;

  await pool.query(
    `
    UPDATE vendors
    SET profile_complete = $1
    WHERE id = $2
    `,
    [isComplete, vendorId]
  );
}

module.exports = { updateVendorProfileStatus };
