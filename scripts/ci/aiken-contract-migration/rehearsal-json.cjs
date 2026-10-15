// Keep ledger quantities exact, including destination assets with 18 decimals.
function parseExactJson(text) {
  return JSON.parse(text, (_, value, context) => {
    if (typeof value !== 'number') return value;
    if (!Number.isFinite(value)) throw new Error('Non-finite number in ledger evidence');
    if (!Number.isInteger(value) || Number.isSafeInteger(value)) return value;
    if (!context || !/^-?(0|[1-9][0-9]*)$/.test(context.source)) {
      throw new Error('Ledger evidence requires an exact integer representation and JSON source support');
    }
    return BigInt(context.source);
  });
}
module.exports = { parseExactJson };
