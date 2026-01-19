const express = require("express");
const pool = require("../db");
const {
  authenticateToken,
  authorizeRoles,
} = require("../middleware/authMiddleware");

const router = express.Router();

/**
 * Get bills for district verifier
 * Optional filter: ?status=READY_FOR_VERIFICATION|APPROVED|REJECTED
 */
router.get(
  "/bills",
  authenticateToken,
  authorizeRoles("DISTRICT_VERIFIER"),
  async (req, res) => {
    const { status } = req.query;
    const district = req.user.district_code;

    if (!district) {
      return res.status(403).json({
        message: "Verifier district not found in token. Please re-login.",
      });
    }

    try {
      let query = `
        SELECT b.id, b.month, b.year, b.status, b.submitted_at,
               v.vendor_name
        FROM bills b
        JOIN vendors v ON b.vendor_id = v.id
      `;

      const params = [];
      const conditions = [];

      if (status) {
        params.push(status);
        conditions.push(`b.status = $${params.length}`);
      }

      params.push(district);
      conditions.push(`b.district_code = $${params.length}`);

      if (conditions.length) {
        query += " WHERE " + conditions.join(" AND ");
      }

      query += " ORDER BY b.submitted_at ASC";

      const result = await pool.query(query, params);
      res.json(result.rows);
    } catch (err) {
      console.error("VERIFIER BILLS ERROR:", err);
      res.status(500).json({ message: "Server error" });
    }
  }
);

/**
 * Get pending bills only
 */
router.get(
  "/bills/pending",
  authenticateToken,
  authorizeRoles("DISTRICT_VERIFIER"),
  async (req, res) => {
    const district = req.user.district_code;

    if (!district) {
      return res.status(400).json({
        message: "Verifier district not found in token. Please re-login.",
      });
    }

    try {
      const result = await pool.query(
        `
        SELECT
          b.id,
          b.month,
          b.year,
          u.username AS vendor_name,
          b.rejection_count,
          (
            SELECT ba.remarks
            FROM bill_actions ba
            WHERE ba.bill_id = b.id
              AND ba.role = 'VENDOR'
            ORDER BY ba.created_at DESC
            LIMIT 1
          ) AS latest_vendor_remark
        FROM bills b
        JOIN vendors v ON b.vendor_id = v.id
        JOIN users u ON v.user_id = u.id
        WHERE b.status = 'READY_FOR_VERIFICATION'
          AND b.district_code = $1
        ORDER BY b.id DESC
        `,
        [district]
      );

      res.json(result.rows);
    } catch (err) {
      console.error("VERIFIER PENDING ERROR:", err);
      res.status(500).json({ message: "Server error" });
    }
  }
);

/**
 * APPROVED or reject a bill
 */
router.post(
  "/bills/:billId/action",
  authenticateToken,
  authorizeRoles("DISTRICT_VERIFIER"),
  async (req, res) => {
    const { billId } = req.params;
    const { action, remarks } = req.body;
    const verifierId = req.user.userId;
    const district = req.user.district_code;

    if (!["APPROVED", "REJECTED"].includes(action)) {
  return res.status(400).json({ message: "Invalid action" });
}

    if (action === "REJECTED" && !remarks) {
      return res.status(400).json({
        message: "Remarks required for rejection",
      });
    }

    try {
      const billResult = await pool.query(
        "SELECT status, district_code FROM bills WHERE id = $1",
        [billId]
      );

      if (billResult.rows.length === 0) {
        return res.status(404).json({ message: "Bill not found" });
      }

      const bill = billResult.rows[0];

      if (bill.district_code !== district) {
        return res.status(403).json({
          message: "You are not allowed to act on bills from another district",
        });
      }

      if (bill.status !== "READY_FOR_VERIFICATION") {
        return res.status(400).json({
          message: "Bill is not pending verification",
        });
      }

      if (action === "APPROVED") {
        const itemsResult = await pool.query(
          "SELECT COUNT(*) FROM bill_items WHERE bill_id = $1",
          [billId]
        );

        if (parseInt(itemsResult.rows[0].count, 10) === 0) {
          return res.status(400).json({
            message: "Cannot approve bill without bill items",
          });
        }

        const crypto = require("crypto");
        const signaturePayload = JSON.stringify({
          billId,
          approvedBy: verifierId,
          approvedAt: new Date().toISOString(),
        });

        const signedHash = crypto
          .createHash("sha256")
          .update(signaturePayload)
          .digest("hex");

        await pool.query(
          `
          UPDATE bills
          SET status = 'APPROVED',
              verified_by = $1,
              verified_at = NOW(),
              remarks = NULL,
              signed_hash = $2,
              signed_at = NOW(),
              signed_by = $1
          WHERE id = $3
          `,
          [verifierId, signedHash, billId]
        );
      } else {
        await pool.query(
          `
          UPDATE bills
          SET status = 'REJECTED',
              rejection_count = rejection_count + 1,
              verified_by = $1,
              verified_at = NOW(),
              remarks = $2
          WHERE id = $3
          `,
          [verifierId, remarks, billId]
        );
      }

      await pool.query(
        `
        INSERT INTO bill_actions (bill_id, action, performed_by, role, remarks)
VALUES ($1, $2, $3, 'DISTRICT_VERIFIER', $4)
        `,
        [billId, action, verifierId, remarks || null]
      );

      res.json({
        message:
          action === "APPROVED"
            ? "Bill approved successfully"
            : "Bill rejected successfully",
      });
    } catch (err) {
      console.error("VERIFIER ACTION ERROR:", err);
      res.status(500).json({ message: "Server error" });
    }
  }
);

module.exports = router;
