import { readPricing, validPricing } from './pricing.mjs';
import { adminPage } from './admin-page.mjs';

const product = { sku: 'BRC-CROSS-001', sizeId: '20', currency: 'USD' };
const visitorCookie = 'veyrase_vid';
const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const orderReference = /^V-[0-9A-F]{12}$/;
const encoder = new TextEncoder();
const privateHeaders = {
  'Cache-Control': 'no-store, private',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin'
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function json(data, status = 200, cookie) {
  const headers = { ...privateHeaders, 'Content-Type': 'application/json; charset=utf-8' };
  if (cookie) headers['Set-Cookie'] = cookie;
  return new Response(JSON.stringify(data), { status, headers });
}

function clearText(value, max) {
  return typeof value === 'string' ? value.trim().slice(0, max).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '') : '';
}

function field(value, max, label) {
  const clean = clearText(value, max + 1);
  if (!clean || clean.length > max) throw new HttpError(400, 'Enter a valid ' + label + '.');
  return clean;
}

function optionalField(value, max, label) {
  return value == null || (typeof value === 'string' && !value.trim()) ? null : field(value, max, label);
}

function emailAddress(input) {
  const email = field(input, 254, 'email address').toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'Enter a valid email address.');
  return email;
}

function requestId(input) {
  if (typeof input !== 'string' || !uuid.test(input)) throw new HttpError(400, 'Reload the page and try again.');
  return input;
}

async function readJson(request) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') || '')) {
    throw new HttpError(415, 'Send a JSON request.');
  }
  const reader = request.body?.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = '';
  if (!reader) throw new HttpError(400, 'Request is empty.');
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > 8192) {
      await reader.cancel();
      throw new HttpError(413, 'Message is too long.');
    }
    text += decoder.decode(value, { stream: true });
  }
  try {
    const data = JSON.parse(text + decoder.decode());
    if (data && typeof data === 'object' && !Array.isArray(data)) return data;
  } catch {}
  throw new HttpError(400, 'Invalid request.');
}

function trafficSource(data) {
  const campaignPart = value => {
    const part = clearText(value, 80).toLowerCase();
    return /^[a-z0-9][a-z0-9._/-]*$/.test(part) ? part : '';
  };
  const medium = campaignPart(data.medium);
  const campaign = campaignPart(data.campaign);
  let source = campaignPart(data.source);
  if (!source) {
    try {
      const referrer = new URL(clearText(data.referrer, 500));
      if (['https:', 'http:'].includes(referrer.protocol)) source = referrer.hostname.replace(/^www\./, '');
    } catch {}
    if (source === 'veyrase.store') source = '';
    if (/(^|\.)instagram\.com$/.test(source)) source = 'instagram';
    if (/(^|\.)tiktok\.com$/.test(source)) source = 'tiktok';
    if (/(^|\.)google\.[a-z.]+$/.test(source)) source = 'google';
  }
  return [source || 'direct', medium, campaign];
}

function analyticsContext(request, data, now) {
  if (request.headers.get('Sec-GPC') === '1' || request.headers.get('DNT') === '1') return {};
  const existing = request.headers.get('Cookie')?.match(/(?:^|;\s*)veyrase_vid=([^;]+)/)?.[1];
  const hasId = uuid.test(existing || '');
  const id = hasId ? existing : crypto.randomUUID();
  const cookie = hasId ? undefined :
    `${visitorCookie}=${id}; Max-Age=7776000; Path=/; HttpOnly; SameSite=Lax${new URL(request.url).protocol === 'https:' ? '; Secure' : ''}`;
  return { id, cookie, attribution: trafficSource(data), day: now.slice(0, 10), country: process.env.VERCEL === "1" && /^[A-Z]{2}$/.test(request.headers.get("x-vercel-ip-country") || "") ? request.headers.get("x-vercel-ip-country") : null };
}

async function recordTraffic(db, tracker, now, added) {
  if (!tracker.id) return;
  await db.query(`INSERT INTO veyrase.visitors AS existing (id, source, medium, campaign, created_at, country)
    VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (id) DO UPDATE SET country = COALESCE(existing.country, excluded.country)`, [tracker.id, ...tracker.attribution, now, tracker.country]);
  await db.query(`INSERT INTO veyrase.visitor_days AS existing (visitor_id, day, added)
    VALUES ($1, $2, $3)
    ON CONFLICT (visitor_id, day) DO UPDATE SET added = GREATEST(existing.added, excluded.added)`,
    [tracker.id, tracker.day, Number(added)]);
}

async function visit(request, db, data, now) {
  if (!['visit', 'add_to_cart'].includes(data.event)) throw new HttpError(400, 'Unknown event.');
  const tracker = analyticsContext(request, data, now);
  if (tracker.id) await db.transaction(client => recordTraffic(client, tracker, now, data.event === 'add_to_cart'));
  return json({ ok: true }, 200, tracker.cookie);
}

async function newOrder(request, db, data, now) {
  const key = requestId(data.requestId);
  const shipping = {
    firstName: field(data.firstName, 80, 'first name'),
    lastName: field(data.lastName, 80, 'last name'),
    phone: field(data.phone, 35, 'phone number'),
    country: field(data.country, 100, 'country'),
    city: field(data.city, 100, 'city'),
    street: field(data.street, 160, 'street address'),
    addressLine2: optionalField(data.addressLine2, 120, 'apartment or suite'),
    region: optionalField(data.region, 100, 'state or province'),
    postalCode: data.noPostalCode === true ? null : field(data.postalCode, 24, 'postal code'),
    deliveryFee: 0
  };
  if (!/^\+?[0-9 ().-]+$/.test(shipping.phone) || !/^\d{6,15}$/.test(shipping.phone.replace(/\D/g, ''))) {
    throw new HttpError(400, 'Enter a phone number with its country code.');
  }
  const name = shipping.firstName + ' ' + shipping.lastName;
  const email = emailAddress(data.email);
  const item = Array.isArray(data.items) && data.items.length === 1 ? data.items[0] : null;
  if (!item || item.sku !== product.sku || item.sizeId !== product.sizeId ||
      !Number.isInteger(item.qty) || item.qty < 1 || item.qty > 9) {
    throw new HttpError(400, 'Check your bag and try again.');
  }
  const tracker = analyticsContext(request, data, now);
  const id = 'V-' + crypto.randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase();
  const stored = await db.transaction(async client => {
    const previous = await client.query('SELECT id, subtotal, currency, status, payment_reported_at, shipping, email FROM veyrase.orders WHERE request_id = $1', [key]);
    if (previous.rows[0]) {
      if (previous.rows[0].email !== email) throw new HttpError(409, 'Refresh the page before sending a new order.');
      return previous.rows[0];
    }
    // Savepoint keeps checkout usable before the additive settings migration is installed.
    await client.query('SAVEPOINT pricing_read');
    const prices = await readPricing(client, true);
    if (!prices.configured) await client.query('ROLLBACK TO SAVEPOINT pricing_read');
    await client.query('RELEASE SAVEPOINT pricing_read');
    const subtotal = item.qty * prices.unitPrice;
    if (data.quotedTotal !== subtotal + prices.deliveryFee ||
        (data.quotedUnitPrice !== undefined && data.quotedUnitPrice !== prices.unitPrice) ||
        (data.quotedDeliveryFee !== undefined && data.quotedDeliveryFee !== prices.deliveryFee)) {
      throw new HttpError(409, 'Prices have changed. Review the updated total and submit again.');
    }
    shipping.deliveryFee = prices.deliveryFee;
    await recordTraffic(client, tracker, now, true);
    await client.query(`INSERT INTO veyrase.orders
      (id, request_id, visitor_id, name, email, sku, size_id, qty, subtotal, currency, created_at, shipping)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb)
      ON CONFLICT (request_id) DO NOTHING`,
      [id, key, tracker.id || null, name, email, product.sku, product.sizeId, item.qty,
        subtotal, product.currency, now, JSON.stringify(shipping)]);
    const { rows } = await client.query(`SELECT id, subtotal, currency, status, payment_reported_at, shipping
      FROM veyrase.orders WHERE request_id = $1 AND email = $2`, [key, email]);
    if (!rows[0]) throw new HttpError(409, 'Refresh the page before sending a new order.');
    return rows[0];
  });
  return json({
    reference: stored.id, ...orderAmounts(stored), currency: stored.currency, paymentStatus: paymentStatus(stored)
  }, stored.id === id ? 201 : 200, tracker.cookie);
}

function orderAmounts(order) {
  const deliveryFee = order.shipping?.deliveryFee ?? 0;
  return { subtotal: order.subtotal, deliveryFee, total: order.subtotal + deliveryFee };
}

function paymentStatus(order) {
  if (order.status === 'paid' || order.status === 'shipped') return 'paid';
  if (order.status === 'cancelled') return 'cancelled';
  return order.payment_reported_at ? 'reported' : 'pending';
}

const cryptoWallets = {
  ethereum: '0x824Ff13Aff963EA0e59bA9aCa2630d75CC1F095e',
  solana: 'AHnBvBbs3pCDkZyfzVMLdheDyaCRs8ACDBvCATerdpvW'
};

async function prepareQuote(client, order, now) {
  if (order.shipping.cryptoQuote) return order.shipping.cryptoQuote;
  const cents = orderAmounts(order).total;
  // Orders with the same USD total share 9,999 sub-cent amounts. Serialize allocation.
  await client.query('SELECT pg_advisory_xact_lock(184416, $1::int)', [cents]);
  const { rows } = await client.query(`SELECT shipping->'cryptoQuote'->>'micros' AS micros
    FROM veyrase.orders WHERE status = 'pending' AND shipping ? 'cryptoQuote'
      AND subtotal + COALESCE((shipping->>'deliveryFee')::int, 0) = $1`, [cents]);
  const used = new Set(rows.map(row => Number(row.micros)));
  const start = Math.floor(Math.random() * 9999);
  for (let step = 0; step < 9999; step++) {
    const micros = cents * 10000 - 1 - ((start + step) % 9999);
    if (used.has(micros)) continue;
    const quote = { micros, amount: (micros / 1000000).toFixed(6), issuedAt: now, wallets: cryptoWallets };
    await client.query(`UPDATE veyrase.orders SET shipping = jsonb_set(shipping, '{cryptoQuote}', $1::jsonb)
      WHERE id = $2`, [JSON.stringify(quote), order.id]);
    return quote;
  }
  throw new HttpError(503, 'Crypto is currently unavailable for this total. Please use the card option.');
}

function normalizeCryptoTx(network, value) {
  if (!Object.hasOwn(cryptoWallets, network)) throw new HttpError(400, 'Select the transfer network.');
  const tx = field(value, 100, 'transaction ID');
  if (network === 'ethereum' && /^0x[0-9a-f]{64}$/i.test(tx)) return tx.toLowerCase();
  if (network === 'solana' && /^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(tx)) {
    const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    let n = 0n;
    for (const char of tx) n = n * 58n + BigInt(alphabet.indexOf(char));
    const bytes = tx.match(/^1*/)[0].length + (n ? Math.ceil(n.toString(16).length / 2) : 0);
    if (bytes === 64) return tx;
  }
  throw new HttpError(400, 'Enter the transaction ID from the selected network.');
}

async function orderPayment(db, data, now) {
  const key = requestId(data.requestId);
  if (typeof data.reference !== 'string' || !orderReference.test(data.reference)) {
    throw new HttpError(400, 'Enter a valid order number.');
  }
  const order = await db.transaction(async client => {
    const { rows: [stored] } = await client.query(`SELECT id, status, subtotal, shipping, payment_reported_at, payment_payer_reference
      FROM veyrase.orders WHERE id = $1 AND request_id = $2 AND shipping IS NOT NULL FOR UPDATE`, [data.reference, key]);
    if (!stored) throw new HttpError(404, 'Order not found.');
    const state = paymentStatus(stored);
    if (state === 'pending' && data.action === 'prepareCrypto') {
      stored.shipping.cryptoQuote = await prepareQuote(client, stored, now);
    } else if (data.action === 'reportCrypto' && (state === 'pending' || (state === 'reported' && stored.shipping.cryptoNetwork))) {
      if (!stored.shipping.cryptoQuote) throw new HttpError(409, 'Open the crypto payment details first.');
      const tx = normalizeCryptoTx(data.network, data.transactionId);
      await client.query(`UPDATE veyrase.orders SET shipping = jsonb_set(shipping, '{cryptoNetwork}', to_jsonb($1::text)),
        payment_reported_at = $2, payment_payer_reference = $3, payment_payer = NULL WHERE id = $4`,
        [data.network, now, tx, stored.id]);
      stored.shipping.cryptoNetwork = data.network;
      stored.payment_payer_reference = tx;
      stored.payment_reported_at = now;
    } else if (state === 'pending' && data.payerName != null && !data.action) {
      const payerName = field(data.payerName, 120, 'payer name');
      const payerReference = optionalField(data.payerReference, 160, 'payment reference');
      await client.query(`UPDATE veyrase.orders SET payment_reported_at = $1, payment_payer = $2, payment_payer_reference = $3
        WHERE id = $4`, [now, payerName, payerReference, stored.id]);
      stored.payment_reported_at = now;
    }
    return stored;
  });
  return json({ reference: order.id, paymentStatus: paymentStatus(order),
    cryptoQuote: order.shipping.cryptoQuote || null, cryptoNetwork: order.shipping.cryptoNetwork || null,
    cryptoTx: order.shipping.cryptoNetwork ? order.payment_payer_reference : null });

}

async function newReturn(db, data, now) {
  const key = requestId(data.requestId);
  const orderRef = field(data.orderRef, 80, 'order number');
  const email = emailAddress(data.email);
  const reason = field(data.reason, 1800, 'reason for your return');
  const id = 'R-' + crypto.randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase();
  const stored = await db.transaction(async client => {
    await client.query(`INSERT INTO veyrase.returns (id, request_id, order_ref, email, reason, created_at)
      VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (request_id) DO NOTHING`, [id, key, orderRef, email, reason, now]);
    const { rows } = await client.query('SELECT id FROM veyrase.returns WHERE request_id = $1 AND email = $2', [key, email]);
    if (!rows[0]) throw new HttpError(409, 'Refresh the page before sending a new request.');
    return rows[0];
  });
  return json({ reference: stored.id }, stored.id === id ? 201 : 200);
}

async function authenticated(request, secret) {
  const match = /^Basic (\S+)$/i.exec(request.headers.get('Authorization') || '');
  if (!match || match[1].length > 512) return false;
  let supplied;
  try {
    const bytes = Uint8Array.from(atob(match[1]), character => character.charCodeAt(0));
    supplied = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch { return false; }
  const digest = text => crypto.subtle.digest('SHA-256', encoder.encode(text));
  const [actual, expected] = await Promise.all([digest(supplied), digest('admin:' + secret)]);
  const a = new Uint8Array(actual);
  const b = new Uint8Array(expected);
  return a.reduce((diff, byte, index) => diff | (byte ^ b[index]), 0) === 0;
}

async function statistics(db, url, now) {
  const days = Number(url.searchParams.get('days') || 30);
  if (![7, 30, 90].includes(days)) throw new HttpError(400, 'Unsupported reporting period.');
  const since = new Date(new Date(now).setUTCHours(0, 0, 0, 0) - (days - 1) * 86400000).toISOString().slice(0, 10);
  const sinceTime = since + 'T00:00:00.000Z';
  const [sources, metrics, daily, countries] = await Promise.all([
    db.query(`WITH audience AS (
        SELECT visitor_id, MAX(added) AS added FROM veyrase.visitor_days WHERE day >= $1 GROUP BY visitor_id
      ), purchasers AS (
        SELECT DISTINCT visitor_id FROM veyrase.orders WHERE visitor_id IS NOT NULL AND paid_at >= $2
      )
      SELECT v.source, v.medium, v.campaign, COUNT(*)::integer AS visitors, SUM(a.added)::integer AS cart,
        COUNT(p.visitor_id)::integer AS purchasers
      FROM audience a JOIN veyrase.visitors v ON a.visitor_id = v.id
      LEFT JOIN purchasers p ON a.visitor_id = p.visitor_id
      GROUP BY v.source, v.medium, v.campaign ORDER BY visitors DESC, v.source`, [since, sinceTime]),
    db.query(`SELECT COUNT(*)::integer AS orders, COUNT(paid_at)::integer AS paid_orders
      FROM veyrase.orders WHERE created_at >= $1`, [sinceTime]),
    db.query(`WITH dates AS (
        SELECT generate_series($1::date, $2::date, interval '1 day')::date AS day
      ), traffic AS (
        SELECT day, COUNT(*)::integer AS visitors, SUM(added)::integer AS cart
        FROM veyrase.visitor_days WHERE day BETWEEN $1::date AND $2::date GROUP BY day
      ), orders AS (
        SELECT (created_at AT TIME ZONE 'UTC')::date AS day, COUNT(*)::integer AS orders
        FROM veyrase.orders WHERE created_at >= $1::date GROUP BY 1
      ), payments AS (
        SELECT (paid_at AT TIME ZONE 'UTC')::date AS day, COUNT(*)::integer AS paid_orders
        FROM veyrase.orders WHERE paid_at >= $1::date GROUP BY 1
      ) SELECT to_char(d.day, 'YYYY-MM-DD') AS day, COALESCE(t.visitors, 0) AS visitors,
        COALESCE(t.cart, 0) AS cart, COALESCE(o.orders, 0) AS orders, COALESCE(p.paid_orders, 0) AS paid_orders
      FROM dates d LEFT JOIN traffic t USING(day) LEFT JOIN orders o USING(day)
      LEFT JOIN payments p USING(day) ORDER BY d.day DESC`, [since, now.slice(0, 10)]),
    db.query(`SELECT v.country, COUNT(*)::integer AS visitors FROM veyrase.visitors v
      WHERE EXISTS (SELECT 1 FROM veyrase.visitor_days d WHERE d.visitor_id = v.id
        AND d.day BETWEEN $1::date AND $2::date)
      GROUP BY v.country ORDER BY visitors DESC, v.country NULLS LAST`, [since, now.slice(0, 10)])
  ]);
  const totals = sources.rows.reduce((sum, row) => {
    for (const key of ['visitors', 'cart', 'purchasers']) sum[key] += row[key];
    return sum;
  }, { visitors: 0, cart: 0, purchasers: 0 });
  return json({ since, days, totals, sources: sources.rows, daily: daily.rows, countries: countries.rows, ...metrics.rows[0] });
}


const orderTransitions = {
  pending: ['paid', 'cancelled'],
  paid: ['shipped']
};
const returnTransitions = {
  new: ['reviewing', 'approved', 'declined'],
  reviewing: ['approved', 'declined']
};

async function listRecords(db, kind, url) {
  const offset = Number(url.searchParams.get('offset') || 0);
  if (!Number.isSafeInteger(offset) || offset < 0) throw new HttpError(400, 'Invalid page.');
  const sql = kind === 'orders'
    ? `SELECT o.id, o.name, o.email, o.size_id, o.qty, o.subtotal, o.currency, o.status, o.created_at, o.paid_at,
          o.shipping, o.payment_reported_at, o.payment_payer, o.payment_payer_reference, o.payment_transaction_id,
          v.source FROM veyrase.orders o LEFT JOIN veyrase.visitors v ON v.id = o.visitor_id
          ORDER BY o.created_at DESC, o.id LIMIT 51 OFFSET $1`
    : 'SELECT id, order_ref, email, reason, status, created_at FROM veyrase.returns ORDER BY created_at DESC, id LIMIT 51 OFFSET $1';
  const { rows } = await db.query(sql, [offset]);
  const page = rows.slice(0, 50);
  return json({
    rows: kind === 'orders' ? page.map(order => ({ ...order, ...orderAmounts(order) })) : page,
    more: rows.length > 50
  });
}

async function changeStatus(db, kind, id, data, now) {
  const isOrder = kind === 'orders';
  const desired = data.status;
  const table = isOrder ? 'veyrase.orders' : 'veyrase.returns';
  const transitions = isOrder ? orderTransitions : returnTransitions;
  const { rows: [current] } = await db.query(`SELECT status${isOrder ? ', shipping, payment_payer_reference, payment_reported_at' : ''} FROM ${table} WHERE id = $1`, [id]);
  if (!current) throw new HttpError(404, 'Record not found.');
  if (desired === current.status) return json({ ok: true });
  if (!transitions[current.status]?.includes(desired)) throw new HttpError(409, 'This status change is unavailable.');
  let transactionId = isOrder && desired === 'paid' && current.shipping
    ? field(data.transactionId, 160, 'transaction ID') : null;
  if (transactionId && current.shipping.cryptoNetwork) {
    transactionId = normalizeCryptoTx(current.shipping.cryptoNetwork, transactionId);
    if (transactionId !== current.payment_payer_reference) throw new HttpError(409, 'The reported transaction has changed.');
  } else if (transactionId && current.shipping.cryptoQuote && !current.payment_reported_at) {
    throw new HttpError(409, 'Wait for the buyer to report their payment method.');
  }
  let result;
  try {
    result = isOrder
      ? await db.query(`UPDATE veyrase.orders
          SET status = $1, paid_at = CASE WHEN $1 = 'paid' THEN $2::timestamptz ELSE paid_at END,
            payment_transaction_id = COALESCE($5, payment_transaction_id)
          WHERE id = $3 AND status = $4 AND ($1 <> 'paid' OR
            (shipping IS NOT DISTINCT FROM $6::jsonb AND payment_payer_reference IS NOT DISTINCT FROM $7 AND
             (payment_reported_at IS NULL) = $8::boolean))`,
            [desired, now, id, current.status, transactionId, current.shipping ? JSON.stringify(current.shipping) : null,
              current.payment_payer_reference, current.payment_reported_at == null])
      : await db.query('UPDATE veyrase.returns SET status = $1 WHERE id = $2 AND status = $3', [desired, id, current.status]);
  } catch (error) {
    if (error.code === '23505' && error.constraint === 'orders_payment_transaction') {
      throw new HttpError(409, 'This transaction is already linked to another order.');
    }
    throw error;
  }
  if (result.rowCount !== 1) throw new HttpError(409, 'Record changed. Reload and try again.');
  return json({ ok: true });
}


function sameOrigin(request, url) {
  if (request.headers.get('Origin') !== url.origin) throw new HttpError(403, 'Open the store and try again.');
}

async function handle(request, { database, adminPassword }) {
  const url = new URL(request.url);
  const path = url.pathname === '/api/store' ? url.searchParams.get('__store_path') || '' : url.pathname;
  const method = request.method;
  const isAdmin = path === '/admin' || path.startsWith('/admin/') || path.startsWith('/api/admin/');
  if (!isAdmin && !path.startsWith('/api/')) throw new HttpError(404, 'Page not found.');
  if (isAdmin) {
    if (!adminPassword || adminPassword.length < 20) return new Response('Admin setup is required.', { status: 503, headers: privateHeaders });
    if (!await authenticated(request, adminPassword)) {
      return new Response('Sign in to the store dashboard.', {
        status: 401,
        headers: { ...privateHeaders, 'WWW-Authenticate': 'Basic realm="Veyrase Admin", charset="UTF-8"' }
      });
    }
    if (path === '/admin' || path === '/admin/') {
      if (method !== 'GET') throw new HttpError(405, 'Method not allowed.');
      return new Response(adminPage, {
        headers: { ...privateHeaders, 'Content-Type': 'text/html; charset=utf-8', 'X-Frame-Options': 'DENY',
          'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'" }
      });
    }
  }
  const db = database();
  if (!db) throw new HttpError(503, 'The store database is unavailable. Please try again later.');
  const now = new Date().toISOString();
  if (method === 'GET' && path === '/api/pricing') {
    const { unitPrice, deliveryFee, currency } = await readPricing(db);
    return json({ unitPrice, deliveryFee, currency });
  }
  if (isAdmin && path === '/api/admin/pricing') {
    if (method === 'GET') return json(await readPricing(db));
    if (method === 'PUT') {
      sameOrigin(request, url);
      const data = await readJson(request);
      if (!validPricing(data)) throw new HttpError(400, 'Введите цену от 0.01 до 10000 USD и доставку от 0 до 10000 USD.');
      try {
        await db.query(`INSERT INTO veyrase.pricing (id, unit_price, delivery_fee) VALUES (1, $1, $2)
          ON CONFLICT (id) DO UPDATE SET unit_price = excluded.unit_price, delivery_fee = excluded.delivery_fee, updated_at = now()`, [data.unitPrice, data.deliveryFee]);
      } catch (error) {
        if (error.code === '42P01') throw new HttpError(503, 'Сначала выполните supabase/pricing.sql в Supabase SQL Editor.');
        throw error;
      }
      return json(await readPricing(db));
    }
  }
  if (isAdmin && method === 'GET' && path === '/api/admin/statistics') return statistics(db, url, now);
  const records = /^\/api\/admin\/(orders|returns)(?:\/([VR]-[0-9A-F]{12}))?$/.exec(path);
  if (records && isAdmin && method === 'GET' && !records[2]) return listRecords(db, records[1], url);
  if (records && isAdmin && method === 'PATCH' && records[2]) {
    sameOrigin(request, url);
    return changeStatus(db, records[1], records[2], await readJson(request), now);
  }
  if (method === 'POST' && ['/api/analytics', '/api/orders', '/api/orders/payment', '/api/returns'].includes(path)) {
    sameOrigin(request, url);
    const body = await readJson(request);
    if (path === '/api/analytics') return visit(request, db, body, now);
    if (path === '/api/orders') return newOrder(request, db, body, now);
    if (path === '/api/orders/payment') return orderPayment(db, body, now);
    return newReturn(db, body, now);
  }
  throw new HttpError(404, 'Page not found.');
}

export async function serveStore(request, services) {
  try {
    return await handle(request, services);
  } catch (error) {
    if (error instanceof HttpError) return json({ error: error.message }, error.status);
    const code = typeof error.code === 'string' && /^[A-Z0-9_]+$/.test(error.code) ? error.code : 'UNKNOWN';
    console.error('Store request failed:', error.name, code);
    return json({ error: 'The store is temporarily unavailable. Please try again.' }, 500);
  }
}
