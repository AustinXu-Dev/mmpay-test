# MyanMyanPay payment flow tester

A small sandbox checkout for someone else to test from Myanmar. It creates a server-side **1,000 MMK** order, displays the returned MMQR, polls the order status, and accepts signed webhooks through the official Node SDK. A local demo mode exercises the interface without credentials.

## Run locally

Requires Node.js 18 or newer.

```sh
cp .env.example .env
npm install
npm start
```

Open <http://localhost:3000>. The default `DEMO_MODE=true` lets you create an order and click **Simulate success**. This only changes local memory; it does not contact MyanMyanPay.

## Test the actual sandbox

1. Register a MyanMyanPay Developer account and get the Sandbox App ID, publishable key, secret key, and API base URL from the Developer Dashboard.
2. Set `DEMO_MODE=false` and the four `MMPAY_*` values in `.env`. Keep `.env` private.
3. For webhook testing, expose this server at a public HTTPS URL and set `PUBLIC_BASE_URL` to its origin, for example `https://your-test-host.example`. The callback URL becomes `https://your-test-host.example/api/webhook`. Alternatively configure that URL in the dashboard. A local server without a public URL can still check status by polling.
4. Start the app and give the tester its public URL. The tester clicks **Create test payment** and notes the order ID.
5. In the Developer Dashboard, go to **Developers → Sandbox Txn → Pending**, select that order, and click **Do a success callback**. The page polls every five seconds, or the tester can click **Check status**.

Sandbox QR codes **cannot** be paid with a real banking app. The dashboard simulator is the required way to complete them. The dashboard account holder may need to perform step 5 for the tester.

The app keeps orders only in memory, so restarting the server clears the local order list. It is a sandbox test harness, not a production checkout. Do not use production keys or accept real payments with it.

## API

- `POST /api/orders`: create a fixed-amount order.
- `GET /api/orders/:orderId`: retrieve current status from MyanMyanPay while pending.
- `GET /api/orders/:orderId/qr`: render returned MMQR as PNG.
- `POST /api/webhook`: verify a callback using `MMPaySDK.listen`.
- `POST /api/demo/complete`: local demo only.

The browser never receives the secret key. Order IDs are generated on the server and the amount is fixed there, so a tester cannot change it in a browser request.

Documentation: [MyanMyanPay Node SDK](https://docs.myanmyanpay.com/sdk-node/), [API reference](https://docs.myanmyanpay.com/api/), [sandbox quick start](https://myanmyanpay.com/start).
