/* ===========================================
   StoreIQ Admin — AI Predictor JS
   Classification & Regression with XGBoost
   =========================================== */

'use strict';

// ─── Sub-category Map ─────────────────────────
const SUBCATEGORIES = {
  'Furniture':       ['Bookcases', 'Chairs', 'Furnishings', 'Tables'],
  'Office Supplies': ['Appliances', 'Art', 'Binders', 'Envelopes', 'Fasteners', 'Labels', 'Paper', 'Storage', 'Supplies'],
  'Technology':      ['Accessories', 'Copiers', 'Machines', 'Phones'],
};

// ─── Slider Sync ──────────────────────────────
function syncSlider(inputId, value) {
  document.getElementById(inputId).value = value;
  document.getElementById(inputId + '-val').textContent = value + '%';
}

// ─── Subcategory Update ───────────────────────
function updateSubcategory(prefix) {
  const cat    = document.getElementById(`${prefix}-category`).value;
  const select = document.getElementById(`${prefix}-subcategory`);
  const subs   = SUBCATEGORIES[cat] || [];

  select.innerHTML = subs.map(s => `<option value="${s}">${s}</option>`).join('');
}

// ─── Initialize subcategories on page load ────
window.addEventListener('DOMContentLoaded', () => {
  updateSubcategory('clf');
  updateSubcategory('reg');
});

// ─── Get Form Values ──────────────────────────
function getFormValues(prefix) {
  const get = id => document.getElementById(`${prefix}-${id}`);

  return {
    sales:         parseFloat(get('sales').value)    || 0,
    discount:      parseFloat(get('discount').value) || 0,
    shipping_cost: parseFloat(get('shipping').value) || 0,
    quantity:      parseInt(get('quantity').value)   || 1,
    category:      get('category').value,
    sub_category:  get('subcategory').value,
    segment:       get('segment').value,
    market:        get('market').value,
    ship_mode:     get('shipmode').value,
    order_priority: get('priority').value,
    region:        get('region').value,
  };
}

// ─── Validate Inputs ──────────────────────────
function validateInputs(data) {
  if (!data.sales || data.sales <= 0) {
    showToast('Sales harus lebih dari 0', 'error');
    return false;
  }
  if (data.shipping_cost < 0) {
    showToast('Biaya kirim tidak boleh negatif', 'error');
    return false;
  }
  if (data.quantity < 1) {
    showToast('Kuantitas minimal 1', 'error');
    return false;
  }
  return true;
}

// ─── Set Button Loading State ─────────────────
function setBtnLoading(btnId, loading) {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  const textEl = btn.querySelector('.btn-text');
  if (loading) {
    btn.classList.add('loading');
    textEl.innerHTML = `<span class="loading-spinner"></span> Memproses...`;
  } else {
    btn.classList.remove('loading');
  }
}

// ─── Classification Predict ───────────────────
async function predictClassify() {
  const data = getFormValues('clf');
  if (!validateInputs(data)) return;

  setBtnLoading('clfPredictBtn', true);
  document.getElementById('clfPredictBtn').querySelector('.btn-text').innerHTML =
    `<span class="loading-spinner"></span> Menganalisis...`;

  try {
    const res  = await fetch('/api/predict/classify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    const json = await res.json();

    if (json.status !== 'success') throw new Error(json.message || 'Prediction failed');

    showClfResult(json);
    showToast(`Prediksi: ${json.prediction} (${json.confidence}%)`, json.is_profit ? 'success' : 'error');

  } catch(e) {
    showToast('Gagal melakukan prediksi: ' + e.message, 'error');
    console.error(e);
  } finally {
    document.getElementById('clfPredictBtn').querySelector('.btn-text').textContent =
      ' Deteksi Status Transaksi';
    document.getElementById('clfPredictBtn').classList.remove('loading');
  }
}

function showClfResult(json) {
  const result    = document.getElementById('clfResult');
  const icon      = document.getElementById('clfResultIcon');
  const value     = document.getElementById('clfResultValue');
  const conf      = document.getElementById('clfResultConf');
  const profitPct = document.getElementById('clfProfitPct');
  const lossPct   = document.getElementById('clfLossPct');
  const profitBar = document.getElementById('clfProfitBar');
  const lossBar   = document.getElementById('clfLossBar');

  result.classList.add('show');
  result.className = `ai-result show ${json.is_profit ? 'result-profit' : 'result-loss'}`;

  icon.textContent  = json.is_profit ? '' : '';
  value.textContent = json.prediction;
  value.className   = `result-value ${json.is_profit ? 'profit-val' : 'loss-val'}`;
  conf.textContent  = `Keyakinan model: ${json.confidence}%`;

  profitPct.textContent = json.profit_probability + '%';
  lossPct.textContent   = json.loss_probability  + '%';

  // Animate bars after a brief delay
  setTimeout(() => {
    profitBar.style.width = json.profit_probability + '%';
    lossBar.style.width   = json.loss_probability  + '%';
  }, 100);
}

// ─── Regression Predict ───────────────────────
async function predictRegress() {
  const data = getFormValues('reg');
  if (!validateInputs(data)) return;

  document.getElementById('regPredictBtn').querySelector('.btn-text').innerHTML =
    `<span class="loading-spinner"></span> Menghitung...`;
  document.getElementById('regPredictBtn').classList.add('loading');

  try {
    const res  = await fetch('/api/predict/regress', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    const json = await res.json();

    if (json.status !== 'success') throw new Error(json.message || 'Prediction failed');

    showRegResult(json, data);
    showToast(`Estimasi Profit: $${json.estimated_profit.toFixed(2)}`, json.is_profitable ? 'success' : 'error');

  } catch(e) {
    showToast('Gagal menghitung estimasi: ' + e.message, 'error');
    console.error(e);
  } finally {
    document.getElementById('regPredictBtn').querySelector('.btn-text').textContent =
      ' Estimasi Profit Sekarang';
    document.getElementById('regPredictBtn').classList.remove('loading');
  }
}

function showRegResult(json, inputData) {
  const result = document.getElementById('regResult');
  const icon   = document.getElementById('regResultIcon');
  const value  = document.getElementById('regResultValue');
  const status = document.getElementById('regResultStatus');
  const margin = document.getElementById('regMarginPct');
  const bar    = document.getElementById('regMarginBar');
  const summary = document.getElementById('regSummary');

  result.classList.add('show');
  result.className = `ai-result show ${json.is_profitable ? 'result-profit' : 'result-loss'}`;

  const profit = json.estimated_profit;
  const sales  = inputData.sales;
  const marginPct = sales > 0 ? ((profit / sales) * 100) : 0;
  const barWidth  = Math.min(Math.abs(marginPct), 100);

  icon.textContent  = profit >= 0 ? '' : '';
  value.textContent = `$${profit.toFixed(2)}`;
  value.className   = `result-value ${profit >= 0 ? 'profit-val' : 'loss-val'}`;
  status.textContent = profit >= 0
    ? ' STATUS AMAN: Transaksi menghasilkan keuntungan.'
    : ' PERINGATAN: Transaksi ini diprediksi MERUGIKAN!';

  margin.textContent = marginPct.toFixed(1) + '%';
  setTimeout(() => { bar.style.width = barWidth + '%'; }, 100);

  // Summary
  const discount = inputData.discount;
  const shipping = inputData.shipping_cost;
  const qty      = inputData.quantity;
  summary.innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
      <div> <strong>Sales:</strong> $${sales.toFixed(2)}</div>
      <div> <strong>Diskon:</strong> ${discount}%</div>
      <div> <strong>Shipping:</strong> $${shipping.toFixed(2)}</div>
      <div> <strong>Qty:</strong> ${qty}</div>
      <div> <strong>Discount Impact:</strong> -$${(sales * discount/100).toFixed(2)}</div>
      <div> <strong>Profit Margin:</strong> ${marginPct.toFixed(1)}%</div>
    </div>
  `;
}
