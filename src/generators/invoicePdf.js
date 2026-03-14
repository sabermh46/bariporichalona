/**
 * Rent payment invoice PDF generator.
 * Keep this file separate so design/structure can be modified independently.
 */
const PDFDocument = require("pdfkit");

/**
 * Generate an invoice PDF for a rent payment.
 * @param {Object} data - Invoice data
 * @param {string} data.renterName - Renter name
 * @param {string} data.houseName - House name
 * @param {string|number} data.flatNumber - Flat number
 * @param {number} data.totalAmount - Total amount paid
 * @param {Date|string} data.paymentDate - Payment date
 * @param {string} [data.transactionId] - Transaction ID
 * @param {number} [data.baseRent] - Base rent amount
 * @param {number} [data.amenitiesTotal] - Amenities total
 * @param {number} [data.lateFee] - Late fee amount
 * @param {Array<{name: string, charge: number}>} [data.amenities] - Amenity line items
 * @param {string} [data.forMonth] - For month (YYYY-MM)
 * @returns {Promise<Buffer>} PDF buffer
 */
async function generateRentInvoicePdf(data) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: "A4" });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const appName = process.env.APP_NAME || "Bari Porichalona";

    // --- Design: header ---
    doc.fontSize(22).font("Helvetica-Bold").text("Payment Receipt", { align: "center" });
    doc.moveDown(0.5);
    doc.fontSize(10).font("Helvetica").text(appName, { align: "center" });
    doc.moveDown(1.5);

    // --- Design: recipient & property ---
    doc.fontSize(11).font("Helvetica-Bold").text("Bill To", 50, doc.y);
    doc.font("Helvetica").fontSize(10);
    doc.text(data.renterName || "—", 50, doc.y + 4);
    doc.moveDown(0.3);
    doc.text(`${data.houseName || "—"} — Flat ${data.flatNumber != null ? data.flatNumber : "—"}`, 50, doc.y);
    if (data.forMonth) {
      doc.text(`Period: ${data.forMonth}`, 50, doc.y + 14);
    }
    doc.moveDown(1.2);

    // --- Design: payment info ---
    const payDate = data.paymentDate
      ? (typeof data.paymentDate === "object" && data.paymentDate.toLocaleDateString
          ? data.paymentDate.toLocaleDateString()
          : String(data.paymentDate))
      : "—";
    doc.font("Helvetica-Bold").text("Payment Date:", 50, doc.y);
    doc.font("Helvetica").text(payDate, 180, doc.y - 12);
    doc.font("Helvetica-Bold").text("Transaction ID:", 50, doc.y + 4);
    doc.font("Helvetica").text(data.transactionId || "—", 180, doc.y - 8);
    doc.moveDown(1.2);

    // --- Design: table header ---
    const tableTop = doc.y;
    doc.font("Helvetica-Bold").fontSize(10);
    doc.text("Description", 50, tableTop);
    doc.text("Amount", 400, tableTop, { width: 100, align: "right" });
    doc.moveTo(50, tableTop + 12).lineTo(550, tableTop + 12).stroke();
    doc.moveDown(0.5);

    let y = tableTop + 20;
    doc.font("Helvetica").fontSize(10);

    const baseRent = Number(data.baseRent) || 0;
    const amenitiesTotal = Number(data.amenitiesTotal) || 0;
    const lateFee = Number(data.lateFee) || 0;

    doc.text("Base Rent", 50, y);
    doc.text(formatMoney(baseRent), 400, y, { width: 100, align: "right" });
    y += 18;

    if (data.amenities && data.amenities.length > 0) {
      for (const item of data.amenities) {
        const name = item.name || "Amenity";
        const charge = parseFloat(item.charge) || 0;
        doc.text(name, 50, y);
        doc.text(formatMoney(charge), 400, y, { width: 100, align: "right" });
        y += 16;
      }
      doc.text("Amenities (subtotal)", 50, y);
      doc.text(formatMoney(amenitiesTotal), 400, y, { width: 100, align: "right" });
      y += 18;
    } else if (amenitiesTotal > 0) {
      doc.text("Amenities", 50, y);
      doc.text(formatMoney(amenitiesTotal), 400, y, { width: 100, align: "right" });
      y += 18;
    }

    if (lateFee > 0) {
      doc.text("Late Fee", 50, y);
      doc.text(formatMoney(lateFee), 400, y, { width: 100, align: "right" });
      y += 18;
    }

    doc.moveTo(50, y + 4).lineTo(550, y + 4).stroke();
    y += 14;
    doc.font("Helvetica-Bold").text("Total Paid", 50, y);
    doc.text(formatMoney(Number(data.totalAmount) || 0), 400, y, { width: 100, align: "right" });
    doc.font("Helvetica");

    doc.moveDown(2);
    doc.fontSize(9).fillColor("#666666").text("Thank you for your payment.", 50, doc.y);
    doc.text(`This is a computer-generated receipt from ${appName}.`, 50, doc.y + 12);

    doc.end();
  });
}

function formatMoney(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return "0.00";
  return n.toFixed(2);
}

module.exports = {
  generateRentInvoicePdf,
};
