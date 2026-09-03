/**
 * Shared CSV export helpers for the admin panel.
 *
 * These started life as file-local consts inside adminWallet.controller.js for the
 * withdrawals export. Every other admin export needs the same escaping, the same
 * Excel quirks handling and the same response headers, so they live here now —
 * one implementation means the sheets cannot drift apart.
 *
 * The output is CSV rather than a real .xlsx because there is no xlsx dependency
 * in this project. Excel opens these directly; the BOM added by sendCsv is what
 * makes it pick up UTF-8 so ₹ and non-Latin names render correctly.
 */

// Hard cap so one export can never try to buffer a whole collection into memory.
const DEFAULT_EXPORT_LIMIT = 20000;

/**
 * Escape a value for a CSV cell.
 *
 * Also neutralises CSV/Excel formula injection: a cell starting with = + - @ or a
 * control char is executed by Excel, so a user-supplied name like
 * "=HYPERLINK(...)" would run on the admin's machine. Prefixing with a single
 * quote makes Excel treat it as text.
 */
const csvCell = (value) => {
  if (value === null || value === undefined) return '';
  let str = String(value);
  if (/^[=+\-@\t\r]/.test(str)) {
    str = `'${str}`;
  }
  // Escape embedded quotes and always quote — safe for commas and newlines.
  return `"${str.replace(/"/g, '""')}"`;
};

/**
 * For identifiers that must survive Excel untouched.
 *
 * A plain long number becomes scientific notation and leading zeros get
 * stripped, which would corrupt a bank account number or a transaction ref.
 * `="..."` forces Excel to treat it as literal text. The value is reduced to a
 * safe character set first so it cannot break out of the formula.
 */
const csvTextCell = (value) => {
  if (value === null || value === undefined || value === '') return '';
  const safe = String(value).replace(/[^A-Za-z0-9/\-_]/g, '');
  if (!safe) return '';
  return `"=""${safe}"""`;
};

/** ISO-ish UTC timestamp: "2026-09-02 14:30:00". Empty string for no date. */
const formatDateTime = (date) =>
  date ? new Date(date).toISOString().replace('T', ' ').slice(0, 19) : '';

/** Fixed-2 money string, or '' when the value is not a number. */
const money = (value) => (typeof value === 'number' ? value.toFixed(2) : '');

/**
 * Build a Mongo date-range condition for a single field.
 *
 * Handles each bound independently — several list endpoints only applied their
 * date filter when BOTH startDate and endDate were present, which silently
 * ignored a single-sided range. A bare `YYYY-MM-DD` end date is expanded to the
 * end of that day so "up to the 5th" includes the 5th.
 *
 * @returns {object|null} e.g. { $gte: Date, $lte: Date }, or null if no valid bound.
 */
const buildDateRange = (startDate, endDate) => {
  if (!startDate && !endDate) return null;

  const range = {};

  if (startDate) {
    const from = new Date(startDate);
    if (!isNaN(from.getTime())) range.$gte = from;
  }

  if (endDate) {
    const to = new Date(endDate);
    if (!isNaN(to.getTime())) {
      // Include the whole end day when a bare date (YYYY-MM-DD) is given.
      if (String(endDate).length <= 10) to.setHours(23, 59, 59, 999);
      range.$lte = to;
    }
  }

  return Object.keys(range).length > 0 ? range : null;
};

/**
 * Send a CSV download response.
 *
 * @param {object}   res       Express response.
 * @param {object}   options
 * @param {string}   options.filename   Base name, without the date stamp or extension.
 * @param {string[]} options.headers    Column headings.
 * @param {string[]} options.rows       Pre-joined CSV row strings.
 * @param {string}   [options.suffix]   Extra filename part, e.g. a status filter.
 * @param {object}   [options.req]      Used to attribute the export in the audit log.
 * @param {object}   [options.audit]    Extra detail for the audit log (filters, counts).
 */
const sendCsv = (res, { filename, headers, rows, suffix = '', req = null, audit = {} }) => {
  const csv = [headers.map(csvCell).join(','), ...rows].join('\r\n');

  // Admin exports can contain personal and financial data — always leave a trail
  // of who downloaded what.
  console.log(`📥 ADMIN EXPORT: ${filename}`, {
    adminId: req?.user?._id,
    rows: rows.length,
    ...audit,
  });

  const stamp = new Date().toISOString().slice(0, 10);
  const safeSuffix = suffix ? `-${String(suffix).replace(/[^A-Za-z0-9_-]/g, '')}` : '';
  const outName = `${filename}${safeSuffix}-${stamp}.csv`;

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${outName}"`);
  res.setHeader('Cache-Control', 'no-store');
  // Leading BOM so Excel detects UTF-8.
  return res.status(200).send(`\uFEFF${csv}`);
};

/** Uniform 500 for a failed export. */
const csvError = (res, label, error) => {
  console.error(`Error exporting ${label}:`, error);
  return res.status(500).json({
    success: false,
    message: `Failed to export ${label}`,
    error: error.message,
  });
};

module.exports = {
  DEFAULT_EXPORT_LIMIT,
  csvCell,
  csvTextCell,
  formatDateTime,
  money,
  buildDateRange,
  sendCsv,
  csvError,
};
