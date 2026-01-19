const express = require("express");
const pool = require("../db");
const {
  authenticateToken,
  authorizeRoles,
} = require("../middleware/authMiddleware");

const router = express.Router();

/**
 * HQ Dashboard summary
 */
router.get(
  "/dashboard",
  authenticateToken,
  authorizeRoles("HQ_ADMIN"),
  async (req, res) => {
    try {
      const summary = await pool.query(`
  SELECT
    COUNT(*) FILTER (WHERE status = 'READY_FOR_VERIFICATION') AS pending,
COUNT(*) FILTER (WHERE status = 'APPROVED') AS approved,
COUNT(*) FILTER (WHERE status = 'REJECTED') AS rejected,
    COUNT(*) FILTER (WHERE is_locked = true) AS locked,
    (SELECT COUNT(*) FROM vendors) AS total_vendors,
    (SELECT COUNT(*) FROM users WHERE role = 'DISTRICT_VERIFIER') AS total_verifiers
  FROM bills
`);

      res.json(summary.rows[0]);
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Server error" });
    }
  }
);

/**
 * HQ – View ALL bills with filters
 * ?status=
 * ?vendor_id=
 * ?verifier_id=
 * ?month=&year=
 */
router.get(
  "/bills",
  authenticateToken,
  authorizeRoles("HQ_ADMIN"),
  async (req, res) => {
    const { status, vendor_id, verifier_id, month, year } = req.query;

    try {
      const conditions = [];
      const values = [];

      if (status) {
        values.push(status);
        conditions.push(`b.status = $${values.length}`);
      }

      if (vendor_id) {
        values.push(vendor_id);
        conditions.push(`b.vendor_id = $${values.length}`);
      }

      if (verifier_id) {
        values.push(verifier_id);
        conditions.push(`b.verified_by = $${values.length}`);
      }

      if (month) {
        values.push(month);
        conditions.push(`b.month = $${values.length}`);
      }

      if (year) {
        values.push(year);
        conditions.push(`b.year = $${values.length}`);
      }

      const whereClause =
        conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

      const result = await pool.query(
        `
        SELECT
          b.id,
          b.month,
          b.year,
          b.status,
          b.rejection_count,
          b.is_locked,
          b.submitted_at,
          v.vendor_name,
          u.username AS verifier_name
        FROM bills b
        JOIN vendors v ON b.vendor_id = v.id
        LEFT JOIN users u ON b.verified_by = u.id
        ${whereClause}
        ORDER BY b.created_at DESC
        `,
        values
      );

      res.json(result.rows);
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Server error" });
    }
  }
);

/**
 * HQ – View full bill details + audit trail
 */
router.get(
  "/bills/:billId",
  authenticateToken,
  authorizeRoles("HQ_ADMIN"),
  async (req, res) => {
    const { billId } = req.params;

    try {
      const billResult = await pool.query(
        `
        SELECT b.*, v.vendor_name
        FROM bills b
        JOIN vendors v ON b.vendor_id = v.id
        WHERE b.id = $1
        `,
        [billId]
      );

      if (billResult.rows.length === 0) {
        return res.status(404).json({ message: "Bill not found" });
      }

      const itemsResult = await pool.query(
        `
        SELECT
          district_code,
          commodity,
          vendor_quantity,
          epos_quantity,
          (vendor_quantity - epos_quantity) AS difference
        FROM bill_items
        WHERE bill_id = $1
        `,
        [billId]
      );

      const actionsResult = await pool.query(
        `
        SELECT action, role, remarks, created_at
        FROM bill_actions
        WHERE bill_id = $1
        ORDER BY created_at DESC
        `,
        [billId]
      );

      res.json({
        bill: billResult.rows[0],
        items: itemsResult.rows,
        actions: actionsResult.rows,
        rejection_display: `${billResult.rows[0].rejection_count}/5`,
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Server error" });
    }
  }
);

/**
 * HQ – Unlock a locked bill
 */
router.post(
  "/bills/:billId/unlock",
  authenticateToken,
  authorizeRoles("HQ_ADMIN"),
  async (req, res) => {
    const { billId } = req.params;
    const adminId = req.user.userId;

    try {
      await pool.query(
        `
        UPDATE bills
SET
  is_locked = false,
  rejection_count = 0,
  status = 'REJECTED'
WHERE id = $1


        `,
        [billId]
      );

      await pool.query(
        `
        INSERT INTO bill_actions (bill_id, action, performed_by, role, remarks)
        VALUES ($1, 'UNLOCKED', $2, 'HQ_ADMIN', 'Bill unlocked by HQ')
        `,
        [billId, adminId]
      );

      res.json({ message: "Bill unlocked successfully" });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Server error" });
    }
  }
);

/**
 * HQ – Lock a bill manually
 */
router.post(
  "/bills/:billId/lock",
  authenticateToken,
  authorizeRoles("HQ_ADMIN"),
  async (req, res) => {
    const { billId } = req.params;
    const adminId = req.user.userId;
    const { reason } = req.body;

    try {
      await pool.query(
        `
        UPDATE bills
        SET is_locked = true
        WHERE id = $1
        `,
        [billId]
      );

      await pool.query(
        `
        INSERT INTO bill_actions
        (bill_id, action, performed_by, role, remarks)
        VALUES ($1, 'LOCKED', $2, 'HQ_ADMIN', $3)
        `,
        [billId, adminId, reason || 'Locked by HQ']
      );

      res.json({ message: "Bill locked successfully" });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Server error" });
    }
  }
);


module.exports = router;
