export const defaults = { unitPrice: 4000, deliveryFee: 2000, currency: 'USD' };
export async function readPricing(db, lock = false) {
  try {
    const { rows } = await db.query('SELECT unit_price, delivery_fee FROM veyrase.pricing WHERE id = 1' + (lock ? ' FOR SHARE' : ''));
    if (rows[0]) return { unitPrice: rows[0].unit_price, deliveryFee: rows[0].delivery_fee, currency: 'USD', configured: true };
    return { ...defaults, configured: false };
  } catch (error) {
    if (error.code !== '42P01') throw error;
    return { ...defaults, configured: false };
  }
}
export function validPricing(data) {
  return Number.isSafeInteger(data.unitPrice) && data.unitPrice >= 1 && data.unitPrice <= 1000000 &&
    Number.isSafeInteger(data.deliveryFee) && data.deliveryFee >= 0 && data.deliveryFee <= 1000000;
}
