function toPositiveInteger(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function toNonNegativeInteger(value, options = {}) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isInteger(parsed) && parsed >= 0) {
    return parsed;
  }

  const fallback = options && Number.isInteger(options.fallback) && options.fallback >= 0
    ? options.fallback
    : 0;
  return fallback;
}

module.exports = {
  toPositiveInteger,
  toNonNegativeInteger,
};
