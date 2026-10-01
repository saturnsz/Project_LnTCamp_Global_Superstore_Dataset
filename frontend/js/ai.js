'use strict';
/* ===========================================
   StoreIQ Admin ΓÇö AI Predictor JS
   Unified form: Classification & Regression concurrent
   =========================================== */

// API_BASE_URL diambil dari dashboard.js (sudah diload duluan)

// === Timeout Helper ===
// PythonAnywhere free tier bisa sleep -> butuh ~60 detik wake-up
const FETCH_TIMEOUT_MS = 90000; // 90 detik

async function fetchWithTimeout(url, options) {
  options = options || {};
  const controller = new AbortController();
  const timer = setTimeout(function () { controller.abort(); }, FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, Object.assign({}, options, { signal: controller.signal }));
    return res;
  } finally {
    clearTimeout(timer);
  }
}

// === Sub-category Map ===
const SUBCATEGORIES = {
  'Furniture': ['Bookcases', 'Chairs', 'Furnishings', 'Tables'],
  'Office Supplies': ['Appliances', 'Art', 'Binders', 'Envelopes', 'Fasteners', 'Labels', 'Paper', 'Storage', 'Supplies'],
  'Technology': ['Accessories', 'Copiers', 'Machines', 'Phones'],
};

// === Slider Sync ===
function syncSlider(inputId, value) {
  document.getElementById(inputId).value = value;
  document.getElementById(inputId + '-val').textContent = value + '%';
}

// === Subcategory Update ===
function updateSubcategory(prefix) {
  var cat = document.getElementById(prefix + '-category').value;
  var select = document.getElementById(prefix + '-subcategory');
  var subs = SUBCATEGORIES[cat] || [];
  select.innerHTML = subs.map(function (s) {
    return '<option value="' + s + '">' + s + '</option>';
  }).join('');
}

// === Initialize subcategories on page load ===
function initAiSubcategories() {
  if (document.getElementById('u-category')) updateSubcategory('u');
  if (document.getElementById('p-category')) updateSubcategory('p');
}
window.addEventListener('pagesLoaded', initAiSubcategories);
document.addEventListener('pagesLoaded', initAiSubcategories);
document.addEventListener('DOMContentLoaded', initAiSubcategories);

// === Get Form Values from unified form ===
function getUnifiedFormValues() {
  function get(id) { return document.getElementById('u-' + id); }
  return {
    sales:          parseFloat(get('sales').value) || 0,
    discount:       parseFloat(get('discount').value) || 0,
    shipping_cost:  parseFloat(get('shipping').value) || 0,
    quantity:       parseInt(get('quantity').value) || 1,
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
var _serverAwake = false;

async function ensureServerAwake(btnId, wakeMsg, readyMsg) {
  if (_serverAwake) return;
  setBtnText(btnId, '<span class="loading-spinner"></span> ' + wakeMsg);
  try {
    var res = await fetchWithTimeout(API_BASE_URL + '/');
    if (res.ok) {
      _serverAwake = true;
      setTimeout(function () { _serverAwake = false; }, 5 * 60 * 1000);
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
  if (json && json.detail) return json.detail;
  if (json && json.message) return json.message;
  if (Array.isArray(json)) return json.map(function (e) { return e.msg || JSON.stringify(e); }).join('; ');
  return 'Prediksi gagal (unknown error)';
}

// === Net Revenue Status ===
function getNetRevenueStatus(profit) {
  if (profit > 0)  return { label: 'PROFIT',     cls: 'net-profit' };
  if (profit === 0) return { label: 'BREAK EVEN', cls: 'net-break-even' };
  return { label: 'LOSS', cls: 'net-loss' };
}

// ===================================================
//   COMBINED PREDICT (Concurrent Classification + Regression)
// ===================================================
async function predictCombined() {
  var data = getUnifiedFormValues();
  if (!validateInputs(data)) return;

  setBtnLoading('unifiedPredictBtn', true);

  try {
    await ensureServerAwake('unifiedPredictBtn', 'Membangunkan server AI...', 'Menganalisis...');
    setBtnText('unifiedPredictBtn', '<span class="loading-spinner"></span> Menghitung estimasi &amp; status profit...');

    // Try combined endpoint first, fall back to concurrent separate calls
    var json;
    try {
      var combinedRes = await fetchWithTimeout(API_BASE_URL + '/api/predict/combined', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      json = await combinedRes.json();

      if (!combinedRes.ok || json.status !== 'success') {
        throw new Error(parseBackendError(json));
      }

      showClfResult(json.classification);
      showRegResult(json.regression, data);
      var profitEst = json.regression.estimated_profit;
      var netStatus = json.regression.net_status || (profitEst > 0 ? 'PROFIT' : profitEst === 0 ? 'BREAK EVEN' : 'LOSS');
      showToast(
        'Estimasi Profit: $' + profitEst.toFixed(2) + ' (' + netStatus + ')',
        json.classification.is_profit ? 'success' : 'error',
        4000
      );

    } catch (combinedErr) {
      // Fallback: call regression endpoint
      console.warn('Combined endpoint failed, falling back to regression call:', combinedErr.message);
      setBtnText('unifiedPredictBtn', '<span class="loading-spinner"></span> Menghitung via model regresi...');

      var regRes = await fetchWithTimeout(API_BASE_URL + '/api/predict/regress', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      var regJson = await regRes.json();
      if (!regRes.ok || regJson.status !== 'success') throw new Error(parseBackendError(regJson));

      var isProfitable = regJson.is_profitable;
      var simulatedClf = {
        prediction: regJson.net_status || (isProfitable ? 'PROFIT' : 'LOSS'),
        is_profit: isProfitable,
        confidence: 100.0,
        rule_derived: true,
        profit_probability: isProfitable ? 100.0 : 0.0,
        loss_probability: isProfitable ? 0.0 : 100.0
      };

      showClfResult(simulatedClf);
      showRegResult(regJson, data);
      showToast(
        'Estimasi Profit: $' + regJson.estimated_profit.toFixed(2) + ' (' + regJson.net_status + ')',
        isProfitable ? 'success' : 'error',
        4000
      );
    }

  } catch (e) {
    var msg = (e.name === 'AbortError')
      ? 'Request timeout (90 detik). Server AI mungkin overload, coba lagi.'
      : e.message;
    showToast('Gagal melakukan prediksi: ' + msg, 'error');
    console.error(e);
  } finally {
    setBtnLoading('unifiedPredictBtn', false, '<i class="fa-solid fa-bolt"></i> Hitung Estimasi &amp; Kelayakan Profit');
  }
}

// === Show Classification Result (Derived Deterministically) ===
function showClfResult(json) {
  var result = document.getElementById('clfResult');
  var icon = document.getElementById('clfResultIcon');
  var value = document.getElementById('clfResultValue');
  var conf = document.getElementById('clfResultConf');
  var profitPct = document.getElementById('clfProfitPct');
  var lossPct = document.getElementById('clfLossPct');
  var profitBar = document.getElementById('clfProfitBar');
  var lossBar = document.getElementById('clfLossBar');

  result.className = 'ai-result show ' + (json.is_profit ? 'result-profit' : 'result-loss');
  result.style.opacity = '1';

  icon.innerHTML = json.is_profit
    ? '<i class="fa-solid fa-circle-check"></i>'
    : '<i class="fa-solid fa-circle-xmark"></i>';
  value.textContent = json.prediction;
  value.className = 'result-value ' + (json.is_profit ? 'profit-val' : 'loss-val');
  conf.textContent = json.rule_derived
    ? (json.is_profit ? 'Ambang terpenuhi: Profit > $0' : 'Ambang tidak terpenuhi: Profit Γëñ $0')
    : 'Keyakinan: ' + json.confidence + '%';

  if (profitPct) profitPct.textContent = json.is_profit ? '100%' : '0%';
  if (lossPct) lossPct.textContent = json.is_profit ? '0%' : '100%';

  setTimeout(function () {
    if (profitBar) profitBar.style.width = json.is_profit ? '100%' : '0%';
    if (lossBar) lossBar.style.width = json.is_profit ? '0%' : '100%';
  }, 100);
}

// === Show Regression Result ===
function showRegResult(json, inputData) {
  var result = document.getElementById('regResult');
  var icon = document.getElementById('regResultIcon');
  var value = document.getElementById('regResultValue');
  var status = document.getElementById('regResultStatus');
  var margin = document.getElementById('regMarginPct');
  var bar = document.getElementById('regMarginBar');
  var summary = document.getElementById('regSummary');
  var netBadge = document.getElementById('netRevenueStatus');

  var profit = json.estimated_profit;
  var sales = inputData.sales;
  var discount = inputData.discount;
  var shipping = inputData.shipping_cost;
  var qty = inputData.quantity;
  var marginPct = sales > 0 ? ((profit / sales) * 100) : 0;
  var barWidth = Math.min(Math.abs(marginPct), 100);

  var netInfo = getNetRevenueStatus(profit);

  var isProfitable = profit > 0;
  result.className = 'ai-result show ' + (isProfitable ? 'result-profit' : profit === 0 ? 'result-neutral' : 'result-loss');
  result.style.opacity = '1';

  icon.innerHTML = profit > 0
    ? '<i class="fa-solid fa-arrow-trend-up"></i>'
    : profit === 0
      ? '<i class="fa-solid fa-equals"></i>'
      : '<i class="fa-solid fa-arrow-trend-down"></i>';

  value.textContent = '$' + profit.toFixed(2);
  value.className = 'result-value ' + (profit > 0 ? 'profit-val' : profit === 0 ? '' : 'loss-val');

  if (profit > 0) {
    status.textContent = 'STATUS AMAN: Transaksi menghasilkan keuntungan.';
  } else if (profit === 0) {
    status.textContent = 'BREAK EVEN: Transaksi tidak untung, tidak rugi.';
  } else {
    status.textContent = 'PERINGATAN: Transaksi ini diprediksi MERUGIKAN!';
  }

  // Net revenue badge
  netBadge.textContent = netInfo.label;
  netBadge.className = 'net-revenue-badge ' + netInfo.cls;

  margin.textContent = marginPct.toFixed(1) + '%';
  setTimeout(function () { bar.style.width = barWidth + '%'; }, 100);

  summary.innerHTML =
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">' +
    '<div><i class="fa-solid fa-money-bill-1"></i> <strong>Sales:</strong> $' + sales.toFixed(2) + '</div>' +
    '<div><i class="fa-solid fa-tag"></i> <strong>Diskon:</strong> ' + discount + '%</div>' +
    '<div><i class="fa-solid fa-box"></i> <strong>Shipping:</strong> $' + shipping.toFixed(2) + '</div>' +
    '<div><i class="fa-solid fa-square-poll-horizontal"></i> <strong>Qty:</strong> ' + qty + '</div>' +
    '<div><i class="fa-solid fa-chart-column"></i> <strong>Discount Impact:</strong> -$' + (sales * discount / 100).toFixed(2) + '</div>' +
    '<div><i class="fa-solid fa-chart-line"></i> <strong>Profit Margin:</strong> ' + marginPct.toFixed(1) + '%</div>' +
    '</div>';
}

// === Expose to window ===
window.predictCombined   = predictCombined;
window.syncSlider        = syncSlider;
window.updateSubcategory = updateSubcategory;

// ===================================================
//   ORDER PRIORITY TRIAGE
// ===================================================

// === Get Priority Form Values ===
function getPriorityFormValues() {
  function get(id) { return document.getElementById('p-' + id); }
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
    region:        get('region').value,
  };
}

// === Predict Priority ===
async function predictPriority() {
  var data = getPriorityFormValues();
  if (!validateInputs(data)) return;

  setBtnLoading('priorityPredictBtn', true);

  try {
    await ensureServerAwake('priorityPredictBtn', 'Membangunkan server AI...', 'Menganalisis prioritas...');
    setBtnText('priorityPredictBtn', '<span class="loading-spinner"></span> Mendeteksi prioritas...');

    var res = await fetchWithTimeout(API_BASE_URL + '/api/predict/priority', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });

    var json = await res.json();

    if (!res.ok || json.status !== 'success') {
      throw new Error(parseBackendError(json));
    }

    showPriorityResult(json);

    var urgencyToastType = json.urgency === 'critical' || json.urgency === 'high' ? 'error' : 'success';
    showToast(
      'Prioritas Pesanan: ' + json.priority_label + ' (Keyakinan: ' + json.confidence + '%)',
      urgencyToastType,
      4000
    );

  } catch (e) {
    var msg = (e.name === 'AbortError')
      ? 'Request timeout (90 detik). Server AI mungkin overload, coba lagi.'
      : e.message;
    showToast('Gagal mendeteksi prioritas: ' + msg, 'error');
    console.error(e);
  } finally {
    setBtnLoading('priorityPredictBtn', false, '<i class="fa-solid fa-magnifying-glass-chart"></i> Deteksi Prioritas Pesanan');
  }
}

// === Show Priority Result ===
var PRIORITY_ICONS = {
  critical: 'fa-triangle-exclamation',
  urgent:   'fa-triangle-exclamation',   // binary: Urgent (prediction=1)
  high:     'fa-circle-chevron-up',
  medium:   'fa-circle-minus',
  low:      'fa-circle-check',
  normal:   'fa-circle-check',           // binary: Normal (prediction=0)
};

function showPriorityResult(json) {
  var box        = document.getElementById('priorityResult');
  var badge      = document.getElementById('priorityBadge');
  var badgeIcon  = document.getElementById('priorityBadgeIcon');
  var badgeLabel = document.getElementById('priorityBadgeLabel');
  var confEl     = document.getElementById('priorityConfidence');
  var msgEl      = document.getElementById('priorityMessage');

  // Animate in
  box.style.opacity = '1';
  box.style.transition = 'opacity 0.4s ease';

  // Apply urgency class to badge
  badge.className = 'priority-badge priority-badge-' + json.urgency;
  var iconClass = PRIORITY_ICONS[json.urgency] || 'fa-circle-question';
  badgeIcon.className = 'fa-solid ' + iconClass;
  badgeLabel.textContent = json.priority_label;
  confEl.textContent = 'Keyakinan model: ' + json.confidence + '%';
  msgEl.textContent = json.message;

  // Per-class probability bars
  var cp = json.class_probs || {};
  var barMap = {
    Urgent:   { bar: 'barUrgent',   pct: 'pctUrgent' },
    Normal:   { bar: 'barNormal',   pct: 'pctNormal' },
    Critical: { bar: 'barCritical', pct: 'pctCritical' },
    High:     { bar: 'barHigh',     pct: 'pctHigh' },
    Medium:   { bar: 'barMedium',   pct: 'pctMedium' },
    Low:      { bar: 'barLow',      pct: 'pctLow' },
  };

  Object.keys(barMap).forEach(function (label) {
    var pct  = cp[label] !== undefined ? cp[label] : 0;
    var ids  = barMap[label];
    var pctEl = document.getElementById(ids.pct);
    var barEl = document.getElementById(ids.bar);
    if (pctEl) pctEl.textContent = pct + '%';
    setTimeout(function () {
      if (barEl) barEl.style.width = pct + '%';
    }, 100);
  });
}

// === Expose priority functions ===
window.predictPriority = predictPriority;
