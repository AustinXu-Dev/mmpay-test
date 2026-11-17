'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Readable, Writable } = require('node:stream');
const { createApp } = require('./server');

async function request(handler, method, url, value, headers = {}) {
  const chunks = [];
  const req = Readable.from(value === undefined ? [] : [JSON.stringify(value)]);
  req.method = method;
  req.url = url;
  req.headers = headers;
  const res = new Writable({ write(chunk, encoding, callback) { chunks.push(chunk); callback(); } });
  res.writeHead = (status, responseHeaders) => { res.statusCode = status; res.headers = responseHeaders; };
  res.end = chunk => { if (chunk) chunks.push(Buffer.from(chunk)); Writable.prototype.end.call(res); };
  await handler(req, res);
  return { status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString()) };
}

test('demo creates a fixed amount order and completes it', async () => {
  const { handler } = createApp({ demo: true });
  const created = await request(handler, 'POST', '/api/orders', { amount: 1 });
  assert.equal(created.status, 201);
  const order = created.body;
  assert.equal(order.amount, 1000);
  assert.equal(order.status, 'PENDING');
  const completed = await request(handler, 'POST', '/api/demo/complete', { orderId: order.orderId });
  assert.equal(completed.body.status, 'SUCCESS');
  const checked = await request(handler, 'GET', `/api/orders/${order.orderId}`);
  assert.equal(checked.body.status, 'SUCCESS');
});

test('webhook requires signature and delegates verification to SDK', async () => {
  let listened = false;
  const sdk = {
    pay: async payload => ({ ...payload, status: 'PENDING' }),
    get: async payload => ({ ...payload, amount: 1000, currency: 'MMK', status: 'PENDING' }),
    listen: async () => { listened = true; },
    onTxCreate() { return this; }, onTxSuccess() { return this; }, onTxFail() { return this; },
    onTxRefund() { return this; }, onTxCancel() { return this; }, onTxExpire() { return this; },
    onHeartbeat() { return this; }, on() { return this; }
  };
  const { handler } = createApp({ demo: false, sdk });
  const missing = await request(handler, 'POST', '/api/webhook', {});
  assert.equal(missing.status, 400);
  assert.equal(listened, false);
  const signed = await request(handler, 'POST', '/api/webhook', {}, { 'x-mmpay-nonce': 'n', 'x-mmpay-signature': 's' });
  assert.equal(signed.status, 200);
  assert.equal(listened, true);
});

test('sandbox status survives a new function instance', async () => {
  const sdk = {
    pay: async payload => ({ ...payload, status: 'PENDING', qr: 'sample-qr' }),
    get: async ({ orderId }) => ({ orderId, amount: 1000, currency: 'MMK', status: 'SUCCESS', qr: 'sample-qr', transactionRefId: 'TX-1' }),
    onTxCreate() { return this; }, onTxSuccess() { return this; }, onTxFail() { return this; },
    onTxRefund() { return this; }, onTxCancel() { return this; }, onTxExpire() { return this; },
    onHeartbeat() { return this; }, on() { return this; }
  };
  const first = createApp({ demo: false, sdk });
  const created = await request(first.handler, 'POST', '/api/orders');
  const second = createApp({ demo: false, sdk });
  const checked = await request(second.handler, 'GET', `/api/orders/${created.body.orderId}`);
  assert.equal(checked.status, 200);
  assert.equal(checked.body.status, 'SUCCESS');
  assert.equal(checked.body.transactionRefId, 'TX-1');
});
