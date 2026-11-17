const $ = id => document.getElementById(id);
let currentOrder = null;
let timer = null;
let demo = true;

async function api(path, options) {
  const response = await fetch(path, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

function showError(error) {
  $('error').textContent = error.message;
  $('error').hidden = false;
}

function render(order) {
  currentOrder = order;
  $('initial').hidden = true;
  $('payment').hidden = false;
  $('error').hidden = true;
  $('order-id').textContent = order.orderId;
  $('qr-ref').textContent = order.vendorQrRefId || '—';
  $('tx-ref').textContent = order.transactionRefId || '—';
  $('status').textContent = order.status;
  $('status').className = `status ${order.status === 'SUCCESS' ? 'success' : order.status === 'PENDING' ? '' : 'failed'}`;
  $('status-title').textContent = order.status === 'SUCCESS' ? 'Payment confirmed' : order.status === 'PENDING' ? 'Waiting for payment' : `Payment ${order.status.toLowerCase()}`;
  $('status-help').textContent = order.status === 'PENDING'
    ? (demo ? 'Use Simulate success to complete this local demo order.' : 'Simulate this order in the MyanMyanPay Developer Dashboard, then check status.')
    : 'This is the latest status reported by the payment server.';
  $('demo-complete').hidden = !demo || order.status !== 'PENDING';
  $('qr-wrap').hidden = !order.qr || demo;
  if (order.qr && !demo) $('qr').src = `/api/orders/${encodeURIComponent(order.orderId)}/qr`;
  clearInterval(timer);
  if (order.status === 'PENDING') timer = setInterval(refresh, 5000);
}

async function refresh() {
  if (!currentOrder) return;
  try { render(await api(`/api/orders/${encodeURIComponent(currentOrder.orderId)}`)); }
  catch (error) { clearInterval(timer); showError(error); }
}

$('create').addEventListener('click', async () => {
  $('create').disabled = true;
  $('error').hidden = true;
  try { render(await api('/api/orders', { method: 'POST' })); }
  catch (error) { showError(error); }
  finally { $('create').disabled = false; }
});
$('refresh').addEventListener('click', refresh);
$('again').addEventListener('click', () => {
  clearInterval(timer);
  currentOrder = null;
  $('payment').hidden = true;
  $('initial').hidden = false;
  $('error').hidden = true;
});
$('demo-complete').addEventListener('click', async () => {
  try { render(await api('/api/demo/complete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orderId: currentOrder.orderId }) })); }
  catch (error) { showError(error); }
});

api('/api/config').then(config => {
  demo = config.demo;
  $('mode').textContent = demo ? 'LOCAL DEMO' : 'SANDBOX';
  if (demo) document.querySelector('aside').hidden = true;
}).catch(showError);
