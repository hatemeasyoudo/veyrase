import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {serveStore} from '../server/store.mjs';

test('pricing authorization, migration fallback, totals, retries and historical orders',async()=>{
 const db=new PGlite();
 for(const name of ['schema','checkout']) await db.exec(await readFile(new URL('../supabase/'+name+'.sql',import.meta.url),'utf8'));
 const services={database:()=>db,adminPassword:'test-only-strong-password-123'};
 const call=(path,method='GET',data,auth=false)=>serveStore(new Request('https://veyrase.store'+path,{method,headers:{Origin:'https://veyrase.store','Content-Type':'application/json',DNT:'1',...(auth?{Authorization:'Basic '+btoa('admin:'+services.adminPassword)}:{})},...(data?{body:JSON.stringify(data)}:{})}),services);
 const data={requestId:crypto.randomUUID(),firstName:'A',lastName:'B',email:'a@example.com',phone:'+1234567890',country:'US',city:'City',street:'Street 1',postalCode:'12345',items:[{sku:'BRC-CROSS-001',sizeId:'20',qty:2}],quotedTotal:10000};
 assert.equal((await call('/api/admin/pricing')).status,401);
 assert.equal((await call('/api/admin/pricing','PUT',{unitPrice:1,deliveryFee:0})).status,401);
 assert.equal((await (await call('/api/pricing')).json()).unitPrice,4000);
 const old=await call('/api/orders','POST',data);assert.equal(old.status,201);assert.equal((await old.json()).total,10000);
 assert.equal((await call('/api/admin/pricing','PUT',{unitPrice:5000,deliveryFee:0},true)).status,503);
 const sql=await readFile(new URL('../supabase/pricing.sql',import.meta.url),'utf8');await db.exec(sql);
 for(const bad of [{unitPrice:-1,deliveryFee:0},{unitPrice:1.1,deliveryFee:0},{unitPrice:100,deliveryFee:-1},{unitPrice:'100',deliveryFee:0}])assert.equal((await call('/api/admin/pricing','PUT',bad,true)).status,400);
 const updated=await call('/api/admin/pricing','PUT',{unitPrice:5555,deliveryFee:0},true);assert.equal(updated.status,200);
 await db.exec(sql);assert.equal((await (await call('/api/pricing')).json()).unitPrice,5555);
 const replay=await call('/api/orders','POST',data);assert.equal(replay.status,200);assert.equal((await replay.json()).total,10000);
 data.requestId=crypto.randomUUID();assert.equal((await call('/api/orders','POST',data)).status,409);
 data.quotedTotal=11110;const fresh=await call('/api/orders','POST',data);assert.equal(fresh.status,201);assert.equal((await fresh.json()).deliveryFee,0);
 const rows=(await db.query('SELECT subtotal,shipping FROM veyrase.orders ORDER BY created_at')).rows;
 assert.equal(rows[0].subtotal,8000);assert.equal(rows[0].shipping.deliveryFee,2000);assert.equal(rows[1].subtotal,11110);
 await db.close();
});
