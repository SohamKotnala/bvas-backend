const express = require("express");
const pool = require("../db");
const {
  authenticateToken,
  authorizeRoles,
} = require("../middleware/authMiddleware");

const router = express.Router();

/**
 * Submit a new bill
 */
router.post(
  "/bills",
  authenticateToken,
  authorizeRoles("VENDOR"),
  async (req, res) => {
    const { month, year, district_code } = req.body;
    const userId = req.user.userId;

  if (!month || !year || !district_code) {
  return res.status(400).json({
    message: "Month, year, and district are required",
  });
}


    try {
      // Find vendor linked to this user
      const vendorResult = await pool.query(
        "SELECT id FROM vendors WHERE user_id = $1",
        [userId]
      );

      if (vendorResult.rows.length === 0) {
        return res.status(400).json({ message: "Vendor profile not found" });
      }

      const vendorId = vendorResult.rows[0].id;

    // 🔒 Check if bill already exists for this vendor + month + year + district
const existingBill = await pool.query(
  `
  SELECT id, status
  FROM bills
  WHERE vendor_id = $1
    AND month = $2
    AND year = $3
    AND district_code = $4
  `,
  [vendorId, month, year, district_code]
);

if (existingBill.rows.length > 0) {
  return res.status(400).json({
    message: "Bill already exists for this month and district",
    bill_id: existingBill.rows[0].id,
    status: existingBill.rows[0].status,
  });
}

// ✅ Create bill only if none exists
const billResult = await pool.query(
  `
  INSERT INTO bills (vendor_id, month, year, district_code, status)
  VALUES ($1, $2, $3, $4, 'DRAFT')
  RETURNING *
  `,
  [vendorId, month, year, district_code]
);



      // Audit log
      await pool.query(
        `INSERT INTO bill_actions (bill_id, action, performed_by, role)
         VALUES ($1, 'CREATED', $2, 'VENDOR')`,
        [billResult.rows[0].id, userId]
      );

      res.status(201).json({
        message: "Bill submitted successfully",
        bill: billResult.rows[0],
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Server error" });
    }
  }
);


/**
 * Add bill items (draft or rejected bills only)
 */
router.post(
  "/bills/:billId/items",
  authenticateToken,
  authorizeRoles("VENDOR"),
  async (req, res) => {
    const { billId } = req.params;
    const { items } = req.body;
    const userId = req.user.userId;

    console.log("ADD ITEMS billId:", billId);


    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: "Items array required" });
    }

    try {
      // 🔒 SINGLE SOURCE OF TRUTH CHECK
      const billResult = await pool.query(
        `
        SELECT b.id, b.status, b.district_code, v.user_id
        FROM bills b
        JOIN vendors v ON b.vendor_id = v.id
        WHERE b.id = $1
        `,
        [billId]
      );

      if (billResult.rows.length === 0) {
        return res.status(404).json({ message: "Bill not found" });
      }

      const bill = billResult.rows[0];

      if (bill.user_id !== userId) {
        return res.status(403).json({ message: "Access denied" });
      }

      if (!["DRAFT", "REJECTED"].includes(bill.status)) {
        return res.status(400).json({
          message: "Items can only be added to draft or rejected bills",
        });
      }

      // 🔥 INSERT ITEMS
      for (const item of items) {
        await pool.query(
          `
          INSERT INTO bill_items
(bill_id, district_code, commodity, vendor_quantity, unit, epos_quantity)
VALUES ($1, $2, $3, $4, $5, $6)

          `,
          [
  billId,
  bill.district_code,
  item.commodity,
  item.vendor_quantity,
  item.unit || "kg",
  Math.floor(Math.random() * 500),
]

        );
      }

      return res.json({ message: "Items added successfully" });
    } catch (err) {
      console.error("ADD ITEMS ERROR:", err);
      return res.status(500).json({ message: "Server error" });
    }
  }
);





/**
 * Submit draft bill for verification
 */
router.post(
  "/bills/:billId/submit",
  authenticateToken,
  authorizeRoles("VENDOR"),
  async (req, res) => {
    const { billId } = req.params;
    const userId = req.user.userId;

    try {
      const billResult = await pool.query(
        `
        SELECT b.*, v.user_id
        FROM bills b
        JOIN vendors v ON b.vendor_id = v.id
        WHERE b.id = $1
        `,
        [billId]
      );

      if (billResult.rows.length === 0) {
        return res.status(404).json({ message: "Bill not found" });
      }

      const bill = billResult.rows[0];

      if (bill.user_id !== userId) {
        return res.status(403).json({ message: "Access denied" });
      }

      if (bill.status !== "DRAFT") {
        return res.status(400).json({
          message: "Only draft bills can be submitted",
        });
      }

      // Item check
      const itemsResult = await pool.query(
        "SELECT COUNT(*) FROM bill_items WHERE bill_id = $1",
        [billId]
      );

      if (parseInt(itemsResult.rows[0].count, 10) === 0) {
        return res.status(400).json({
          message: "Cannot submit bill without items",
        });
      }

      await pool.query(
        `
        UPDATE bills
        SET status = 'READY_FOR_VERIFICATION'
        WHERE id = $1
        `,
        [billId]
      );

      await pool.query(
        `
        INSERT INTO bill_actions (bill_id, action, performed_by, role)
        VALUES ($1, 'SUBMITTED', $2, 'VENDOR')
        `,
        [billId, userId]
      );

      res.json({ message: "Bill submitted for verification" });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Server error" });
    }
  }
);


/**
 * Get vendor bills (dashboard)
 */
router.get(
  "/bills",
  authenticateToken,
  authorizeRoles("VENDOR"),
  async (req, res) => {
    const userId = req.user.userId;

    try {
      const vendorResult = await pool.query(
        "SELECT id FROM vendors WHERE user_id = $1",
        [userId]
      );

      if (vendorResult.rows.length === 0) {
        return res.status(400).json({ message: "Vendor profile not found" });
      }

      const vendorId = vendorResult.rows[0].id;

      const billsResult = await pool.query(
          `SELECT id, month, year, district_code, status, submitted_at, rejection_count


         FROM bills
         WHERE vendor_id = $1
         ORDER BY id DESC`,
        [vendorId]
      );

      res.json(billsResult.rows);
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Server error" });
    }
  }
);

/**
 * Get bill details (vendor / verifier / HQ)
 */
router.get(
  "/bills/:billId",
  authenticateToken,
  async (req, res) => {
    const { billId } = req.params;
    const { role, userId } = req.user;

    try {
      // Fetch bill
     const billResult = await pool.query(
  `
  SELECT b.*
  FROM bills b
  WHERE b.id = $1
  `,
  [billId]
);

      if (billResult.rows.length === 0) {
        return res.status(404).json({ message: "Bill not found" });
      }

      const bill = billResult.rows[0];

      // Vendor can see ONLY own bill
      if (role === "VENDOR") {
        const vendorCheck = await pool.query(
          "SELECT id FROM vendors WHERE user_id = $1",
          [userId]
        );

        if (vendorCheck.rows[0].id !== bill.vendor_id) {
          return res.status(403).json({ message: "Access denied" });
        }
      }

      // District verifier can see ONLY district bills
if (role === "DISTRICT_VERIFIER") {
  if (bill.district_code && bill.district_code !== req.user.district) {
    return res.status(403).json({ message: "Access denied" });
  }
}


      // Fetch bill items
    const itemsResult = await pool.query(
  `
SELECT
  id,
  commodity,
  vendor_quantity,
  unit,
  epos_quantity,
  (vendor_quantity - epos_quantity) AS difference
FROM bill_items

WHERE bill_id = $1
  `,
  [billId]
);

const lastActions = await pool.query(
  `
  SELECT action, remarks, role, created_at
  FROM bill_actions
  WHERE bill_id = $1
  ORDER BY created_at DESC
  LIMIT 2
  `,
  [billId]
);

let latestVerifierRemark = null;

if (Array.isArray(lastActions.rows)) {
  const verifierAction = lastActions.rows.find(
    a => a.role === "DISTRICT_VERIFIER"
  );
  latestVerifierRemark = verifierAction ? verifierAction.remarks : null;
}

res.json({
  bill,
  items: itemsResult.rows,
  rejection_count: bill.rejection_count,
  rejection_limit: 5,
  rejection_display: `${bill.rejection_count}/5`,
  latest_verifier_remark: latestVerifierRemark,
  actions: lastActions.rows,
});


    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Server error" });
    }
  }
);

/**
 * Re-submit rejected bill (max 5 times)
 */
router.post(
  "/bills/:billId/resubmit",
  authenticateToken,
  authorizeRoles("VENDOR"),
  async (req, res) => {
    const { billId } = req.params;
    const userId = req.user.userId;
    const { remarks } = req.body;

    try {
      // 1️⃣ Fetch bill + ownership
      const billResult = await pool.query(
        `
        SELECT b.*, v.user_id
        FROM bills b
        JOIN vendors v ON b.vendor_id = v.id
        WHERE b.id = $1
        `,
        [billId]
      );

      if (billResult.rows.length === 0) {
        return res.status(404).json({ message: "Bill not found" });
      }

      const bill = billResult.rows[0];

      // 2️⃣ Ownership check
      if (bill.user_id !== userId) {
        return res.status(403).json({ message: "Access denied" });
      }

      // 3️⃣ Status check
      if (bill.status !== "REJECTED") {
        return res.status(400).json({
          message: "Only rejected bills can be re-submitted",
        });
      }

      // 4️⃣ Locked check
      if (bill.is_locked) {
        return res.status(403).json({
          message: "Bill is locked. Contact HQ.",
        });
      }

      // 5️⃣ Rejection limit check
      if (bill.rejection_count >= 5) {
        await pool.query(
          `UPDATE bills SET is_locked = TRUE WHERE id = $1`,
          [billId]
        );

        return res.status(403).json({
          message: "Maximum resubmission limit reached. Bill locked.",
        });
      }

      // ===============================
      // ✅ EXACT PLACE FOR ITEM CHECK
      // ===============================
      const itemsResult = await pool.query(
        "SELECT COUNT(*) FROM bill_items WHERE bill_id = $1",
        [billId]
      );

      if (parseInt(itemsResult.rows[0].count, 10) === 0) {
        return res.status(400).json({
          message: "Cannot resubmit bill without items",
        });
      }
      // ===============================
      // 🔒 DO NOT MOVE THIS BLOCK
      // ===============================

      // 6️⃣ Reset bill for verification
      await pool.query(
        `
        UPDATE bills
        SET status = 'READY_FOR_VERIFICATION',
            verified_by = NULL,
            verified_at = NULL,
            remarks = NULL
        WHERE id = $1
        `,
        [billId]
      );

      // 7️⃣ Audit log (vendor remarks optional)
      await pool.query(
        `
        INSERT INTO bill_actions (bill_id, action, performed_by, role, remarks)
        VALUES ($1, 'RESUBMITTED', $2, 'VENDOR', $3)
        `,
        [billId, userId, remarks || null]
      );

      res.json({
  message: "Bill re-submitted successfully",
  rejection_count: bill.rejection_count,
  rejection_limit: 5,
  rejection_display: `${bill.rejection_count}/5`,
});
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Server error" });
    }
  }
);


/**
 * Delete single bill item
 */
router.delete(
  "/bills/:billId/items/:itemId",
  authenticateToken,
  authorizeRoles("VENDOR"),
  async (req, res) => {
    const { billId, itemId } = req.params;
    const userId = req.user.userId;

    try {
      const billResult = await pool.query(
        `
        SELECT b.status, v.user_id
        FROM bills b
        JOIN vendors v ON b.vendor_id = v.id
        WHERE b.id = $1
        `,
        [billId]
      );

      if (billResult.rows.length === 0) {
        return res.status(404).json({ message: "Bill not found" });
      }

      const bill = billResult.rows[0];

      if (bill.user_id !== userId) {
        return res.status(403).json({ message: "Access denied" });
      }

      if (!["DRAFT", "REJECTED"].includes(bill.status)) {
        return res.status(400).json({
          message: "Items cannot be modified in current bill state",
        });
      }

      await pool.query(
        `
        DELETE FROM bill_items
        WHERE id = $1 AND bill_id = $2
        `,
        [itemId, billId]
      );

      res.json({ message: "Item deleted successfully" });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Server error" });
    }
  }
);

/**
 * Delete bill items (only for rejected bills)
 */
router.delete(
  "/bills/:billId/items",
  authenticateToken,
  authorizeRoles("VENDOR"),
  async (req, res) => {
    const { billId } = req.params;
    const userId = req.user.userId;

    try {
      const billResult = await pool.query(
        `
        SELECT b.*, v.user_id
        FROM bills b
        JOIN vendors v ON b.vendor_id = v.id
        WHERE b.id = $1
        `,
        [billId]
      );

      if (billResult.rows.length === 0) {
        return res.status(404).json({ message: "Bill not found" });
      }

      const bill = billResult.rows[0];

      if (bill.user_id !== userId) {
        return res.status(403).json({ message: "Access denied" });
      }

      if (bill.status !== "REJECTED") {
        return res.status(400).json({
          message: "Bill items can only be edited after rejection",
        });
      }

      if (bill.is_locked) {
        return res.status(403).json({
          message: "Bill is locked. Contact HQ.",
        });
      }

      await pool.query(
        "DELETE FROM bill_items WHERE bill_id = $1",
        [billId]
      );


      res.json({ message: "Bill items deleted successfully" });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Server error" });
    }
  }
);


module.exports = router;

