// npm install --no-save @electric-sql/pglite, then node --test tests/analytics.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { serveStore } from '../server/store.mjs';

test('daily reporting, country collection, privacy and protected admin API', async () => {
  const db = new PGlite();
  const base = await readFile(new URL('../supabase/schema.sql', import.meta.url), 'utf8');
  await db.exec(base.replace('  country text,\n', ''));
  const migration = await readFile(new URL('../supabase/analytics.sql', import.meta.url), 'utf8');
  await db.exec(migration); await db.exec(migration);
  const secret = 'test-password-only-at-least-20';
  const services = { database: () => db, adminPassword: secret };
  const admin = { Authorization: 'Basic ' + btoa('admin:' + secret) };
  const report = days => serveStore(new Request('https://veyrase.store/api/admin/statistics?days=' + days, { headers: admin }), services);
  assert.equal((await serveStore(new Request('https://veyrase.store/api/admin/statistics'), services)).status, 401);
  assert.equal((await report(8)).status, 400);
  let data = await (await report(7)).json();
  assert.equal(data.daily.length, 7);
  assert.ok(data.daily.every(d => d.visitors === 0 && d.paid_orders === 0));
  const oldEnv = process.env.VERCEL;
  process.env.VERCEL = '1';
  const visit = async (country, cookie, extra = {}) => {
    const headers = { Origin: 'https://veyrase.store', 'Content-Type': 'application/json', 'x-vercel-ip-country': country, ...extra };
    if (cookie) headers.Cookie = cookie;
    return serveStore(new Request('https://veyrase.store/api/analytics', {method:'POST', headers, body:JSON.stringify({event:'add_to_cart'})}), services);
  };
  try {
    const first = await visit('PL'); assert.equal(first.status, 200);
    const cookie = first.headers.get('set-cookie').split(';')[0];
    await visit('US', cookie); // Repeat visit: one browser, first country retained.
    await visit('DE', null, {'Sec-GPC':'1'});
    await visit('DE', null, {'DNT':'1'});
    const second = await visit('invalid'); assert.equal(second.status, 200);
    const id = cookie.split('=')[1];
    const now = new Date().toISOString();
    const yesterday = new Date(Date.now()-86400000).toISOString().slice(0,10);
    const outside = new Date(Date.now()-8*86400000).toISOString().slice(0,10);
    await db.query('INSERT INTO veyrase.visitor_days VALUES ($1,$2,0),($1,$3,0)',[id,yesterday,outside]);
    await db.query(`INSERT INTO veyrase.orders (id,request_id,visitor_id,name,email,sku,size_id,qty,subtotal,currency,created_at,paid_at)
      VALUES ('test','test',$1,'Test','test@example.com','test','20',1,4000,'USD',$2,$3)`,[id,yesterday+'T23:59:59Z',now]);
    data = await (await report(7)).json();
    assert.equal(data.totals.visitors,2);
    assert.equal(data.countries.find(c=>c.country==='PL').visitors,1);
    assert.equal(data.countries.find(c=>c.country===null).visitors,1);
    assert.equal(data.daily[0].visitors,2);
    assert.equal(data.daily[0].paid_orders,1);
    assert.equal(data.daily[1].orders,1);
    assert.equal(data.daily[1].visitors,1);
    assert.equal(data.daily.reduce((n,d)=>n+d.visitors,0),3);
    assert.equal((await (await report(30)).json()).daily.length,30);
    assert.equal((await (await report(90)).json()).daily.length,90);
    delete process.env.VERCEL;
    await visit('US');
    assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM veyrase.visitors WHERE country IS NULL')).rows[0].n,2);
  } finally {
    if (oldEnv === undefined) delete process.env.VERCEL; else process.env.VERCEL=oldEnv;
    await db.close();
  }
});
