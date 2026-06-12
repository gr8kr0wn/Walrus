/**
 * Request validation helpers.
 * Each helper throws an object { status, message } on failure so the
 * error-handling middleware can forward it to the client.
 */

/**
 * Assert that all required fields are present and non-empty in `body`.
 * @param {Record<string, unknown>} body
 * @param {string[]} fields
 */
export function requireFields(body, fields) {
  const missing = fields.filter(
    (f) => body[f] === undefined || body[f] === null || body[f] === ""
  );
  if (missing.length > 0) {
    const err = new Error(`Missing required fields: ${missing.join(", ")}`);
    err.status = 400;
    throw err;
  }
}

/**
 * Assert that `value` looks like a Sui object ID (0x + 64 hex chars).
 * Accepts shorter IDs too since testnet sometimes returns them.
 * @param {string} value
 * @param {string} fieldName
 */
export function requireSuiAddress(value, fieldName = "address") {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{1,64}$/.test(value)) {
    const err = new Error(`Invalid Sui address for field "${fieldName}": ${value}`);
    err.status = 400;
    throw err;
  }
}

/**
 * Assert that `value` is a positive integer (as number or numeric string).
 * @param {unknown} value
 * @param {string} fieldName
 */
export function requirePositiveInt(value, fieldName = "value") {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    const err = new Error(`"${fieldName}" must be a positive integer, got: ${value}`);
    err.status = 400;
    throw err;
  }
}
