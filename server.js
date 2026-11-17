'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const AMOUNT = 1000;
const CURRENCY = 'MMK';
const TERMINAL = new Set(['SUCCESS', 'FAILED', 'REFUNDED', 'CANCELLED', 'EXPIRED']);
const ROOT = path.join(__dirname, 'public');

function loadEnv(file = path.join(__dirname, '.env')) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (match && !Object.hasOwn(process.env, match[1])) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
}

function createApp(options = {}) {
  loadEnv();
  const demo = options.demo ?? process.env.DEMO_MODE !== 'false';
  const orders = new Map();
  const sdk = options.sdk ?? (demo ? null : makeSdk());
  const publicBaseUrl = (options.publicBaseUrl ?? process.env.PUBLIC_BASE_URL ?? '').replace(/\/$/, '');

  if (sdk) {
    const update = tx => {
      const order = orders.get(tx.orderId);
      if (!order || tx.amount !== AMOUNT || (tx.currency && tx.currency !== CURRENCY)) return;
      order.status = tx.status;
      order.transactionRefId = tx.transactionRefId ?? order.transactionRefId;
      order.updatedAt = new Date().toISOString();
    };
    sdk.onTxCreate(update).onTxSuccess(update).onTxFail(update).onTxRefund(update)
      .onTxCancel(update).onTxExpire(update).onHeartbeat(update)
      .on('error', error => console.error('MMPay SDK:', error));
  }

  async function handler(req, res) {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (req.method === 'GET' && url.pathname === '/api/config') {
        return json(res, 200, { demo, amount: AMOUNT, currency: CURRENCY });
      }
      if (req.method === 'POST' && url.pathname === '/api/orders') {
        const orderId = `TEST-${randomUUID()}`;
        const payload = { orderId, amount: AMOUNT, currency: CURRENCY,
          items: [{ name: 'Payment flow test', amount: AMOUNT, quantity: 1 }] };
        if (publicBaseUrl) payload.callbackUrl = `${publicBaseUrl}/api/webhook`;
        const result = demo
          ? { orderId, status: 'PENDING', qr: `DEMO-${orderId}`, vendorQrRefId: `DEMO-${orderId.slice(-8)}` }
          : await sdk.pay(payload);
        if (!demo) validatePaymentResult(result, 'create payment');
        const order = {
          orderId, amount: AMOUNT, currency: CURRENCY, status: result.status ?? 'PENDING',
          qr: result.qr ?? null, vendorQrRefId: result.vendorQrRefId ?? null,
          transactionRefId: null, updatedAt: new Date().toISOString()
        };
        orders.set(orderId, order);
        return json(res, 201, order);
      }
      const match = url.pathname.match(/^\/api\/orders\/(TEST-[a-f0-9-]+)$/);
      if (match && req.method === 'GET') {
        let order = orders.get(match[1]);
        if (!order && demo) return json(res, 404, { error: 'Order not found on this server.' });
        if (!demo && (!order || !TERMINAL.has(order.status))) {
          const result = await sdk.get({ orderId: match[1] });
          validatePaymentResult(result, 'retrieve payment');
          if (result.amount !== AMOUNT || (result.currency && result.currency !== CURRENCY)) {
            return json(res, 502, { error: 'Payment amount or currency mismatch.' });
          }
          order = {
            orderId: match[1], amount: AMOUNT, currency: CURRENCY,
            status: result.status, qr: result.qr ?? order?.qr ?? null,
            vendorQrRefId: result.vendorQrRefId ?? order?.vendorQrRefId ?? null,
            transactionRefId: result.transactionRefId ?? order?.transactionRefId ?? null,
            updatedAt: new Date().toISOString()
          };
          orders.set(match[1], order);
        }
        return json(res, 200, order);
      }
      const qrMatch = url.pathname.match(/^\/api\/orders\/(TEST-[a-f0-9-]+)\/qr$/);
      if (qrMatch && req.method === 'GET') {
        let order = orders.get(qrMatch[1]);
        if (!order && !demo) {
          const result = await sdk.get({ orderId: qrMatch[1] });
          validatePaymentResult(result, 'retrieve payment QR');
          if (result.amount !== AMOUNT || (result.currency && result.currency !== CURRENCY)) {
            return json(res, 502, { error: 'Payment amount or currency mismatch.' });
          }
          order = result;
        }
        if (!order?.qr || demo) return json(res, 404, { error: 'QR not found.' });
        const QRCode = require('qrcode');
        const png = await QRCode.toBuffer(order.qr, { width: 300, margin: 2 });
        res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' });
        return res.end(png);
      }
      if (req.method === 'POST' && url.pathname === '/api/webhook') {
        if (demo) return json(res, 404, { error: 'Webhook unavailable in demo mode.' });
        const body = await readBody(req);
        const nonce = req.headers['x-mmpay-nonce'];
        const signature = req.headers['x-mmpay-signature'];
        if (!nonce || !signature) return json(res, 400, { error: 'Missing signature headers.' });
        // The official SDK verifies the HMAC signature and nonce before events fire.
        await sdk.listen(JSON.stringify(JSON.parse(body)), nonce, signature);
        return json(res, 200, { received: true });
      }
      if (demo && req.method === 'POST' && url.pathname === '/api/demo/complete') {
        const { orderId } = JSON.parse(await readBody(req));
        const order = orders.get(orderId);
        if (!order) return json(res, 404, { error: 'Order not found.' });
        if (order.status !== 'PENDING') return json(res, 409, { error: 'Order is no longer pending.' });
        order.status = 'SUCCESS';
        order.transactionRefId = `DEMO-${randomUUID().slice(0, 8)}`;
        order.updatedAt = new Date().toISOString();
        return json(res, 200, order);
      }
      if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/app.js' || url.pathname === '/style.css')) {
        const name = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
        const types = { 'index.html': 'text/html', 'app.js': 'text/javascript', 'style.css': 'text/css' };
        res.writeHead(200, { 'Content-Type': `${types[name]}; charset=utf-8`, 'Cache-Control': 'no-store' });
        return fs.createReadStream(path.join(ROOT, name)).pipe(res);
      }
      return json(res, 404, { error: 'Not found.' });
    } catch (error) {
      console.error(error);
      return json(res, error.statusCode || 500, { error: error.message || 'Unexpected server error.' });
    }
  }
  return { handler, orders };
}

function validatePaymentResult(result, operation) {
  if (!result || result instanceof Error || result.success === false ||
      !['PENDING', ...TERMINAL].includes(result.status)) {
    const detail = typeof result?.message === 'string' ? result.message : 'No valid payment status returned.';
    const error = new Error(`MyanMyanPay could not ${operation}. ${detail}`);
    error.statusCode = 502;
    throw error;
  }
}

function makeSdk() {
  const keys = ['MMPAY_APP_ID', 'MMPAY_PUBLISHABLE_KEY', 'MMPAY_SECRET_KEY', 'MMPAY_API_BASE_URL'];
  const missing = keys.filter(key => !process.env[key]);
  if (missing.length) throw new Error(`Missing sandbox configuration: ${missing.join(', ')}`);
  const { MMPaySDK } = require('mmpay-node-sdk');
  return new MMPaySDK({
    appId: process.env.MMPAY_APP_ID,
    publishableKey: process.env.MMPAY_PUBLISHABLE_KEY,
    secretKey: process.env.MMPAY_SECRET_KEY,
    apiBaseUrl: process.env.MMPAY_API_BASE_URL
  });
}

function json(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
}

function readBody(req) {
  if (req.body !== undefined) return Promise.resolve(typeof req.body === 'string' ? req.body : JSON.stringify(req.body));
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 64 * 1024) { reject(new Error('Request body too large.')); req.destroy(); }
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

if (require.main === module) {
  const { handler } = createApp();
  const port = Number(process.env.PORT || 3000);
  http.createServer(handler).listen(port, () => console.log(`Payment tester: http://localhost:${port}`));
}

// Vercel's Node preset loads this file directly and requires a function export.
// Keep the app lazy so importing the module does not require sandbox keys.
let deployedHandler;
function handleDeployedRequest(req, res) {
  deployedHandler ??= createApp().handler;
  return deployedHandler(req, res);
}
handleDeployedRequest.createApp = createApp;
module.exports = handleDeployedRequest;
