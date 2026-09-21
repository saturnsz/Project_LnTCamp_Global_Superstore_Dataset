'use strict';
/* ===========================================
   StoreIQ Admin — AI Predictor JS
   Classification & Regression with XGBoost
   =========================================== */

// API_BASE_URL diambil dari dashboard.js (sudah diload duluan)

// === Timeout Helper ===
// PythonAnywhere free tier bisa sleep -> butuh ~60 detik wake-up
const FETCH_TIMEOUT_MS = 90000; // 90 detik

async function fetchWithTimeout(url, options) {
  options = options || {};
  const controller = new AbortController();
  const timer = setTimeout(function() { controller.abort(); }, FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, Object.assign({}, options, { signal: controller.signal }));
    return res;
  } finally {
    clearTimeout(timer);
  }
}

// === Sub-category Map ===
const SUBCATEGORIES = {
  'Furniture':       ['Bookcases', 'Chairs', 'Furnishings', 'Tables'],
  'Office Supplies': ['Appliances', 'Art', 'Binders', 'Envelopes', 'Fasteners', 'Labels', 'Paper', 'Storage', 'Supplies'],
  'Technology':      ['Accessories', 'Copiers', 'Machines', 'Phones'],
};

// === Slider Sync ===
function syncSlider(inputId, value) {
  document.getElementById(inputId).value = value;
  document.getElementById(inputId + '-val').textContent = value + '%';
}

// === Subcategory Update ===
function updateSubcategory(prefix) {
  var cat    = document.getElementById(prefix + '-category').value;
  var select = document.getElementById(prefix + '-subcategory');
  var subs   = SUBCATEGORIES[cat] || [];
  select.innerHTML = subs.map(function(s) {
    return '<option value="' + s + '">' + s + '</option>';
  }).join('');
}

// === Initialize subcategories on page load ===
window.addEventListener('DOMContentLoaded', function() {
  updateSubcategory('clf');
  updateSubcategory('reg');
});

// === Get Form Values ===
function getFormValues(prefix) {
  function get(id) { return document.getElementById(prefix + '-' + id); }
  return {
    sales:          parseFloat(get('sales').value)    || 0,
    discount:       parseFloat(get('discount').value) || 0,
    shipping_cost:  parseFloat(get('shipping').value) || 0,
    quantity:       parseInt(get('quantity').value)   || 1,
    category:       get('category').value,
    sub_category:   get('subcategory').value,
    segment:        get('segment').value,
    market:         get('market').value,
    ship_mode:      get('shipmode').value,
    order_priority: get('priority').value,
    region:         get('region').value,
  };
}

// === Validate Inputs ===
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

// === Button Helpers ===
function setBtnText(btnId, html) {
  var btn = document.getElementById(btnId);
  if (!btn) return;
  btn.querySelector('.btn-text').innerHTML = html;
}

function setBtnLoading(btnId, loading, originalText) {
  var btn = document.getElementById(btnId);
  if (!btn) return;
  if (loading) {
    btn.classList.add('loading');
    btn.disabled = true;
  } else {
    btn.classList.remove('loading');
    btn.disabled = false;
    if (originalText) btn.querySelector('.btn-text').innerHTML = originalText;
  }
}

// === Wake-up Ping ===
// PythonAnywhere free tier tidur setelah idle -> ping dulu sebelum predict
var _serverAwake = false;

async function ensureServerAwake(btnId, wakeMsg, readyMsg) {
  if (_serverAwake) return;
  setBtnText(btnId, '<span class="loading-spinner"></span> ' + wakeMsg);
  try {
    var res = await fetchWithTimeout(API_BASE_URL + '/');
    if (res.ok) {
      _serverAwake = true;
      // Reset setelah 5 menit (server bisa tidur lagi)
      setTimeout(function() { _serverAwake = false; }, 5 * 60 * 1000);
    }
  } catch (e) {
    if (e.name === 'AbortError') {
      throw new Error('Server AI tidak merespons (timeout). Coba lagi beberapa saat.');
    }
    throw new Error('Tidak dapat terhubung ke server AI: ' + e.message);
  }
  setBtnText(btnId, '<span class="loading-spinner"></span> ' + readyMsg);
}

// === Parse Backend Error ===
function parseBackendError(json) {
  if (json && json.detail)  return json.detail;
  if (json && json.message) return json.message;
  if (Array.isArray(json))  return json.map(function(e) { return e.msg || JSON.stringify(e); }).join('; ');
  return 'Prediksi gagal (unknown error)';
}

// === Classification Predict ===
async function predictClassify() {
  var data = getFormValues('clf');
  if (!validateInputs(data)) return;

  setBtnLoading('clfPredictBtn', true);

  try {
    await ensureServerAwake('clfPredictBtn', 'Membangunkan server AI...', 'Menganalisis...');
    setBtnText('clfPredictBtn', '<span class="loading-spinner"></span> Menganalisis...');

    var res = await fetchWithTimeout(API_BASE_URL + '/api/predict/classify', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(data),
    });

    var json = await res.json();

    if (!res.ok || json.status !== 'success') {
      throw new Error(parseBackendError(json));
    }

    showClfResult(json);
    showToast('Prediksi: ' + json.prediction + ' (' + json.confidence + '%)', json.is_profit ? 'success' : 'error');

  } catch (e) {
    var msg = (e.name === 'AbortError')
      ? 'Request timeout (90 detik). Server AI mungkin overload, coba lagi.'
      : e.message;
    showToast('Gagal melakukan prediksi: ' + msg, 'error');
    console.error(e);
  } finally {
    setBtnLoading('clfPredictBtn', false, '&#129302; Deteksi Status Transaksi');
  }
}

function showClfResult(json) {
  var result    = document.getElementById('clfResult');
  var icon      = document.getElementById('clfResultIcon');
  var value     = document.getElementById('clfResultValue');
  var conf      = document.getElementById('clfResultConf');
  var profitPct = document.getElementById('clfProfitPct');
  var lossPct   = document.getElementById('clfLossPct');
  var profitBar = document.getElementById('clfProfitBar');
  var lossBar   = document.getElementById('clfLossBar');

  result.className = 'ai-result show ' + (json.is_profit ? 'result-profit' : 'result-loss');

  icon.textContent  = json.is_profit ? '📈' : '📉';
  value.textContent = json.prediction;
  value.className   = 'result-value ' + (json.is_profit ? 'profit-val' : 'loss-val');
  conf.textContent  = 'Keyakinan model: ' + json.confidence + '%';

  profitPct.textContent = json.profit_probability + '%';
  lossPct.textContent   = json.loss_probability   + '%';

  setTimeout(function() {
    profitBar.style.width = json.profit_probability + '%';
    lossBar.style.width   = json.loss_probability   + '%';
  }, 100);
}

// === Regression Predict ===
async function predictRegress() {
  var data = getFormValues('reg');
  if (!validateInputs(data)) return;

  setBtnLoading('regPredictBtn', true);

  try {
    await ensureServerAwake('regPredictBtn', 'Membangunkan server AI...', 'Menghitung...');
    setBtnText('regPredictBtn', '<span class="loading-spinner"></span> Menghitung...');

    var res = await fetchWithTimeout(API_BASE_URL + '/api/predict/regress', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(data),
    });

    var json = await res.json();

    if (!res.ok || json.status !== 'success') {
      throw new Error(parseBackendError(json));
    }

    showRegResult(json, data);
    showToast('Estimasi Profit: $' + json.estimated_profit.toFixed(2), json.is_profitable ? 'success' : 'error');

  } catch (e) {
    var msg = (e.name === 'AbortError')
      ? 'Request timeout (90 detik). Server AI mungkin overload, coba lagi.'
      : e.message;
    showToast('Gagal menghitung estimasi: ' + msg, 'error');
    console.error(e);
  } finally {
    setBtnLoading('regPredictBtn', false, '&#128200; Estimasi Profit Sekarang');
  }
}

function showRegResult(json, inputData) {
  var result  = document.getElementById('regResult');
  var icon    = document.getElementById('regResultIcon');
  var value   = document.getElementById('regResultValue');
  var status  = document.getElementById('regResultStatus');
  var margin  = document.getElementById('regMarginPct');
  var bar     = document.getElementById('regMarginBar');
  var summary = document.getElementById('regSummary');

  var profit    = json.estimated_profit;
  var sales     = inputData.sales;
  var discount  = inputData.discount;
  var shipping  = inputData.shipping_cost;
  var qty       = inputData.quantity;
  var marginPct = sales > 0 ? ((profit / sales) * 100) : 0;
  var barWidth  = Math.min(Math.abs(marginPct), 100);

  result.className = 'ai-result show ' + (json.is_profitable ? 'result-profit' : 'result-loss');

  icon.textContent  = profit >= 0 ? '💰' : '⚠️';
  value.textContent = '$' + profit.toFixed(2);
  value.className   = 'result-value ' + (profit >= 0 ? 'profit-val' : 'loss-val');
  status.textContent = profit >= 0
    ? '✅ STATUS AMAN: Transaksi menghasilkan keuntungan.'
    : '🚨 PERINGATAN: Transaksi ini diprediksi MERUGIKAN!';

  margin.textContent = marginPct.toFixed(1) + '%';
  setTimeout(function() { bar.style.width = barWidth + '%'; }, 100);

  summary.innerHTML =
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">' +
    '<div>💵 <strong>Sales:</strong> $' + sales.toFixed(2) + '</div>' +
    '<div>🏷️ <strong>Diskon:</strong> ' + discount + '%</div>' +
    '<div>📦 <strong>Shipping:</strong> $' + shipping.toFixed(2) + '</div>' +
    '<div>🔢 <strong>Qty:</strong> ' + qty + '</div>' +
    '<div>📉 <strong>Discount Impact:</strong> -$' + (sales * discount / 100).toFixed(2) + '</div>' +
    '<div>📊 <strong>Profit Margin:</strong> ' + marginPct.toFixed(1) + '%</div>' +
    '</div>';
}

// === Expose to window ===
window.predictClassify   = predictClassify;
window.predictRegress    = predictRegress;
window.syncSlider        = syncSlider;
window.updateSubcategory = updateSubcategory;
