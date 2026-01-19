const express = require("express");
const pool = require("../db");
const {
  authenticateToken,
  authorizeRoles,
} = require("../middleware/authMiddleware");

const router = express.Router();

/**
 * Create new bill
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
      const vendorResult = await pool.query(
        "SELECT id FROM vendors WHERE user_id = $1",
        [userId]
      );

      if (vendorResult.rows.length === 0) {
        return res.status(403).json({ message: "Vendor profile not found" });
      }

      const vendorId = vendorResult.rows[0].id;

      const existingBill = await pool.query(
        `
        SELECT id, status
        FROM bills
        WHERE vendor_id = $1
          AND month = $2
          AND year = $3
          AND district_code = $4
          AND status IN ('DRAFT', 'READY_FOR_VERIFICATION', 'REJECTED')
        `,
        [vendorId, month, year, district_code]
      );

      if (existingBill.rows.length > 0) {
        return res.status(400).json({
          message: "Bill already exists for this month and district",
        });
      }

      const billResult = await pool.query(
        `
        INSERT INTO bills (vendor_id, month, year, district_code, status)
        VALUES ($1, $2, $3, $4, 'DRAFT')
        RETURNING *
        `,
        [vendorId, month, year, district_code]
      );

      await pool.query(
        `
        INSERT INTO bill_actions (bill_id, action, performed_by, role)
        VALUES ($1, 'CREATED', $2, 'VENDOR')
        `,
        [billResult.rows[0].id, userId]
      );

      res.status(201).json({
        message: "Bill created successfully",
        bill: billResult.rows[0],
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Server error" });
    }
  }
);

/**
 * Get all bills for logged-in vendor
 */
router.get(
  "/bills",
  authenticateToken,
  authorizeRoles("VENDOR"),
  async (req, res) => {
    try {
      const userId = req.user.userId;

      const vendorResult = await pool.query(
        "SELECT id FROM vendors WHERE user_id = $1",
        [userId]
      );

      if (vendorResult.rows.length === 0) {
        return res.status(404).json({
          message: "Vendor profile not found",
        });
      }

      const vendorId = vendorResult.rows[0].id;

      const billsResult = await pool.query(
        `
        SELECT
          id,
          month,
          year,
          district_code,
          status
        FROM bills
        WHERE vendor_id = $1
        ORDER BY id DESC
        `,
        [vendorId]
      );

      res.json(billsResult.rows);
    } catch (err) {
      console.error("GET VENDOR BILLS ERROR:", err);
      res.status(500).json({
        message: "Failed to load bills",
      });
    }
  }
);


/**
 * Add bill items
 */
router.post(
  "/bills/:billId/items",
  authenticateToken,
  authorizeRoles("VENDOR"),
  async (req, res) => {
    const { billId } = req.params;
    const { items } = req.body;
    const userId = req.user.userId;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: "Items array required" });
    }

    try {
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

      for (const item of items) {
        const eposQty = Math.floor(Math.random() * 500);

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
            eposQty,
          ]
        );
      }

      res.json({ message: "Items added successfully" });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Server error" });
    }
  }
);

/**
 * Submit bill for verification
 */
router.post(
  "/bills/:billId/submit",
  authenticateToken,
  authorizeRoles("VENDOR"),
  async (req, res) => {
    const { billId } = req.params;
    const userId = req.user.userId;

    try {
      // Get bill + ownership
      const billResult = await pool.query(
        `
        SELECT b.id, b.status, v.user_id
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


      // Ensure bill has items
      const itemsResult = await pool.query(
        "SELECT COUNT(*) FROM bill_items WHERE bill_id = $1",
        [billId]
      );

      if (parseInt(itemsResult.rows[0].count, 10) === 0) {
        return res.status(400).json({
          message: "Cannot submit bill without items",
        });
      }

      // Update status
      await pool.query(
        `
        UPDATE bills
        SET status = 'READY_FOR_VERIFICATION',
            submitted_at = NOW()
        WHERE id = $1
        `,
        [billId]
      );

      // Log action
      await pool.query(
        `
        INSERT INTO bill_actions (bill_id, action, performed_by, role)
        VALUES ($1, 'SUBMITTED', $2, 'VENDOR')
        `,
        [billId, userId]
      );

      res.json({ message: "Bill submitted successfully" });
    } catch (err) {
      console.error("SUBMIT BILL ERROR:", err);
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
    const { role, userId, district_code } = req.user;

    try {
      const billResult = await pool.query(
        "SELECT * FROM bills WHERE id = $1",
        [billId]
      );

      if (billResult.rows.length === 0) {
        return res.status(404).json({ message: "Bill not found" });
      }

      const bill = billResult.rows[0];

      if (role === "VENDOR") {
        const vendorCheck = await pool.query(
          "SELECT id FROM vendors WHERE user_id = $1",
          [userId]
        );

        if (
          vendorCheck.rows.length === 0 ||
          vendorCheck.rows[0].id !== bill.vendor_id
        ) {
          return res.status(403).json({ message: "Access denied" });
        }
      }

      if (role === "DISTRICT_VERIFIER") {
        if (bill.district_code !== district_code) {
          return res.status(403).json({ message: "Access denied" });
        }
      }

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

      const actionsResult = await pool.query(
        `
        SELECT action, remarks, role, created_at
        FROM bill_actions
        WHERE bill_id = $1
        ORDER BY created_at DESC
        `,
        [billId]
      );

      res.json({
        bill,
        items: itemsResult.rows,
        actions: actionsResult.rows,
        rejection_count: bill.rejection_count,
        rejection_display: `${bill.rejection_count}/5`,
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Server error" });
    }
  }
);

router.post(
  "/bills/:billId/resubmit",
  authenticateToken,
  authorizeRoles("VENDOR"),
  async (req, res) => {
    const { billId } = req.params;
    const userId = req.user.userId;
    const { remarks } = req.body;

    try {
      const billResult = await pool.query(
        `
        SELECT b.status, b.is_locked, b.rejection_count, v.user_id
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
          message: "Only rejected bills can be resubmitted",
        });
      }

      if (bill.is_locked) {
        return res.status(403).json({
          message: "Bill is locked. Contact HQ.",
        });
      }

      await pool.query(
        `
        UPDATE bills
        SET status = 'READY_FOR_VERIFICATION',
            remarks = NULL
        WHERE id = $1
        `,
        [billId]
      );

      await pool.query(
        `
        INSERT INTO bill_actions (bill_id, action, performed_by, role, remarks)
        VALUES ($1, 'RESUBMITTED', $2, 'VENDOR', $3)
        `,
        [billId, userId, remarks || null]
      );

      res.json({ message: "Bill resubmitted successfully" });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Server error" });
    }
  }
);

router.delete(
  "/bills/:billId/items/:itemId",
  authenticateToken,
  authorizeRoles("VENDOR"),
  async (req, res) => {
    const { billId, itemId } = req.params;
    const userId = req.user.userId;

    try {
      const billCheck = await pool.query(
        `
        SELECT b.status, v.user_id
        FROM bills b
        JOIN vendors v ON b.vendor_id = v.id
        WHERE b.id = $1
        `,
        [billId]
      );

      if (billCheck.rows.length === 0) {
        return res.status(404).json({ message: "Bill not found" });
      }

      if (billCheck.rows[0].user_id !== userId) {
        return res.status(403).json({ message: "Access denied" });
      }

      if (!["DRAFT", "REJECTED"].includes(billCheck.rows[0].status)) {
        return res.status(400).json({
          message: "Items cannot be modified in current bill state",
        });
      }

      await pool.query(
        "DELETE FROM bill_items WHERE id = $1 AND bill_id = $2",
        [itemId, billId]
      );

      res.json({ message: "Item deleted successfully" });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Server error" });
    }
  }
);
router.delete(
  "/bills/:billId/items",
  authenticateToken,
  authorizeRoles("VENDOR"),
  async (req, res) => {
    const { billId } = req.params;
    const userId = req.user.userId;

    try {
      const billCheck = await pool.query(
        `
        SELECT b.status, v.user_id
        FROM bills b
        JOIN vendors v ON b.vendor_id = v.id
        WHERE b.id = $1
        `,
        [billId]
      );

      if (billCheck.rows.length === 0) {
        return res.status(404).json({ message: "Bill not found" });
      }

      if (billCheck.rows[0].user_id !== userId) {
        return res.status(403).json({ message: "Access denied" });
      }

      if (billCheck.rows[0].status !== "REJECTED") {
        return res.status(400).json({
          message: "Items can only be cleared after rejection",
        });
      }

      await pool.query(
        "DELETE FROM bill_items WHERE bill_id = $1",
        [billId]
      );

      res.json({ message: "Items cleared successfully" });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Server error" });
    }
  }
);

module.exports = router;
