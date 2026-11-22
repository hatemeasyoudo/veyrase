import { adminPage } from './admin-page.mjs';

const product = { sku: 'BRC-CROSS-001', sizeId: '20', unitPrice: 4000, deliveryFee: 2000, currency: 'USD' };
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
  return { id, cookie, attribution: trafficSource(data), day: now.slice(0, 10) };
}

async function recordTraffic(db, tracker, now, added) {
  if (!tracker.id) return;
  await db.query(`INSERT INTO veyrase.visitors (id, source, medium, campaign, created_at)
    VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING`, [tracker.id, ...tracker.attribution, now]);
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
    deliveryFee: product.deliveryFee
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
  const subtotal = item.qty * product.unitPrice;
  if (data.quotedTotal !== subtotal + product.deliveryFee) {
    throw new HttpError(409, 'Reload checkout to see the current total, including $20 USD delivery.');
  }
  const tracker = analyticsContext(request, data, now);
  const id = 'V-' + crypto.randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase();
  const stored = await db.transaction(async client => {
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

async function orderPayment(db, data, now) {
  const key = requestId(data.requestId);
  if (typeof data.reference !== 'string' || !orderReference.test(data.reference)) {
    throw new HttpError(400, 'Enter a valid order number.');
  }
  const order = await db.transaction(async client => {
    const { rows: [stored] } = await client.query(`SELECT id, status, payment_reported_at
      FROM veyrase.orders WHERE id = $1 AND request_id = $2 AND shipping IS NOT NULL FOR UPDATE`, [data.reference, key]);
    if (!stored) throw new HttpError(404, 'Order not found.');
    if (data.payerName == null || paymentStatus(stored) !== 'pending') return stored;
    const payerName = field(data.payerName, 120, 'payer name');
    const payerReference = optionalField(data.payerReference, 160, 'payment reference');
    await client.query(`UPDATE veyrase.orders SET payment_reported_at = $1, payment_payer = $2, payment_payer_reference = $3
      WHERE id = $4`, [now, payerName, payerReference, stored.id]);
    return { ...stored, payment_reported_at: now };
  });
  return json({ reference: order.id, paymentStatus: paymentStatus(order) });
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
  const [sources, metrics] = await Promise.all([
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
      FROM veyrase.orders WHERE created_at >= $1`, [sinceTime])
  ]);
  const totals = sources.rows.reduce((sum, row) => {
    for (const key of ['visitors', 'cart', 'purchasers']) sum[key] += row[key];
    return sum;
  }, { visitors: 0, cart: 0, purchasers: 0 });
  return json({ since, days, totals, sources: sources.rows, ...metrics.rows[0] });
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
  const { rows: [current] } = await db.query(`SELECT status${isOrder ? ', shipping' : ''} FROM ${table} WHERE id = $1`, [id]);
  if (!current) throw new HttpError(404, 'Record not found.');
  if (desired === current.status) return json({ ok: true });
  if (!transitions[current.status]?.includes(desired)) throw new HttpError(409, 'This status change is unavailable.');
  const transactionId = isOrder && desired === 'paid' && current.shipping
    ? field(data.transactionId, 160, 'Revolut transaction ID') : null;
  let result;
  try {
    result = isOrder
      ? await db.query(`UPDATE veyrase.orders
          SET status = $1, paid_at = CASE WHEN $1 = 'paid' THEN $2::timestamptz ELSE paid_at END,
            payment_transaction_id = COALESCE($5, payment_transaction_id)
          WHERE id = $3 AND status = $4`, [desired, now, id, current.status, transactionId])
      : await db.query('UPDATE veyrase.returns SET status = $1 WHERE id = $2 AND status = $3', [desired, id, current.status]);
  } catch (error) {
    if (error.code === '23505' && error.constraint === 'orders_payment_transaction') {
      throw new HttpError(409, 'This Revolut transaction is already linked to another order.');
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
