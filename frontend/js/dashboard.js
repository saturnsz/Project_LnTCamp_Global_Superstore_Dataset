'use strict';
const API_BASE_URL = 'https://adwyaalk.pythonanywhere.com';
/* ===========================================
   StoreIQ Admin — Dashboard JS
   =========================================== */

// ─── State ────────────────────────────
const state = {
  currentPage: 'dashboard',
  sidebarCollapsed: false,
  pages: {
    orders: { page: 1, limit: 20, total: 0, q: '', data: [], timer: null },
    products: { page: 1, limit: 20, total: 0, q: '', data: [], timer: null },
    customers: { page: 1, limit: 20, total: 0, q: '', data: [], timer: null },
    locations: { page: 1, limit: 20, total: 0, q: '', data: [], timer: null },
  },
  charts: {},
  initialized: {},
  dashboardData: {
    subcatRaw: [],
    regionRaw: [],
    segmentRaw: [],
    quantityRaw: [],
    subcatMetric: 'sales',
    regionMetric: 'sales',
    segmentMetric: 'sales',
  },
  dashboardFilters: {},
};

// ─── Chart.js Global Defaults ─────────────────
Chart.defaults.color = '#8888aa';
Chart.defaults.borderColor = 'rgba(255,255,255,0.06)';
Chart.defaults.font.family = "'Inter', sans-serif";
Chart.defaults.font.size = 12;

// ─── Color Palettes ───────────────────────────
const COLORS = { blue: '#4f8ef7', purple: '#8b5cf6', green: '#22c55e', red: '#ef4444', orange: '#f59e0b', cyan: '#06b6d4', pink: '#ec4899' };
const PALETTE = ['#4f8ef7', '#8b5cf6', '#22c55e', '#f59e0b', '#06b6d4', '#ef4444', '#ec4899', '#a78bfa', '#34d399', '#fbbf24', '#60a5fa', '#f87171'];
const PALETTE_ALPHA = (color, a = 0.7) => color + Math.round(a * 255).toString(16).padStart(2, '0');

// ─── Helpers ──────────────────────────────────
function fmt(n, prefix = '$') {
  if (n == null || isNaN(n)) return '—';
  const abs = Math.abs(n);
  if (abs >= 1e6) return (n < 0 ? '-' : '') + prefix + (abs / 1e6).toFixed(2) + 'M';
  if (abs >= 1e3) return (n < 0 ? '-' : '') + prefix + (abs / 1e3).toFixed(1) + 'K';
  return (n < 0 ? '-' : '') + prefix + abs.toFixed(2);
}

function fmtNum(n) { return n == null ? '—' : Number(n).toLocaleString(); }
function fmtPct(n) { return n != null ? n.toFixed(1) + '%' : '—'; }
function fmtDate(d) { return !d ? '—' : d.substring(0, 10); }
function esc(s) { return !s ? '—' : String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

function profitBadge(profit) {
  if (profit == null) return '<span class="badge badge-muted">—</span>';
  const cls = profit >= 0 ? 'badge-success' : 'badge-danger';
  const sign = profit >= 0 ? '+' : '';
  return `<span class="badge ${cls}">${sign}$${Math.abs(profit).toFixed(2)}</span>`;
}

function segmentBadge(seg) {
  const map = { 'Consumer': 'badge-info', 'Corporate': 'badge-purple', 'Home Office': 'badge-cyan' };
  return `<span class="badge ${map[seg] || 'badge-muted'}">${seg}</span>`;
}

function priorityBadge(p) {
  const map = { 'Critical': 'badge-danger', 'High': 'badge-warning', 'Medium': 'badge-info', 'Low': 'badge-muted' };
  return `<span class="badge ${map[p] || 'badge-muted'}">${p}</span>`;
}

function marketBadge(m) { return `<span class="badge badge-muted">${m}</span>`; }

function shipmodeBadge(sm) {
  const map = { 'Same Day': 'badge-danger', 'First Class': 'badge-warning', 'Second Class': 'badge-info', 'Standard Class': 'badge-muted' };
  return `<span class="badge ${map[sm] || 'badge-muted'}">${sm}</span>`;
}

// ─── Build filter query string ─────────────────
function buildFilterQS(extra) {
  const f = state.dashboardFilters;
  const params = new URLSearchParams();
  if (f.date_start) params.set('date_start', f.date_start);
  if (f.date_end) params.set('date_end', f.date_end);
  if (f.region) params.set('region', f.region);
  if (f.market) params.set('market', f.market);
  if (extra) Object.entries(extra).forEach(([k, v]) => params.set(k, v));
  const qs = params.toString();
  return qs ? '?' + qs : '';
}

// ─── Dashboard Loading Overlay ─────────────────
function showDashboardLoading() {
  const el = document.getElementById('dashboardLoadingOverlay');
  if (el) el.classList.add('visible');
}
function hideDashboardLoading() {
  const el = document.getElementById('dashboardLoadingOverlay');
  if (el) el.classList.remove('visible');
}

// ─── Toast ────────────────────────────────────
function showToast(message, type = 'info', duration = 3000) {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  const icons = { success: '✓', error: '✕', info: 'ℹ' };
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span>${icons[type] || 'ℹ'}</span><span>${message}</span>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.animation = 'none';
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(20px)';
    toast.style.transition = 'all 0.3s';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// ─── Navigation ───────────────────────────────
function navigateTo(pageName) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

  const pageEl = document.getElementById(`page-${pageName}`);
  if (pageEl) pageEl.classList.add('active');

  const navItem = document.querySelector(`.nav-item[data-page="${pageName}"]`);
  if (navItem) navItem.classList.add('active');

  state.currentPage = pageName;

  const titles = {
    dashboard: ['Dashboard', 'Global Superstore Analytics'],
    orders: ['Orders', 'Transaction management'],
    products: ['Products', 'Product catalog'],
    customers: ['Customers', 'Customer directory'],
    locations: ['Locations', 'Geographic distribution'],
    ai: ['AI Predictor', 'XGBoost Transaction Intelligence'],
  };

  const [title, subtitle] = titles[pageName] || ['Page', ''];
  document.getElementById('topbarTitle').textContent = title;
  document.getElementById('topbarSubtitle').textContent = subtitle;

  const tablePages = ['orders', 'products', 'customers', 'locations'];
  document.getElementById('topSearchBar').style.display = tablePages.includes(pageName) ? 'flex' : 'none';

  if (!state.initialized[pageName]) {
    state.initialized[pageName] = true;
    if (pageName === 'dashboard') initDashboard();
    else if (tablePages.includes(pageName)) loadTablePage(pageName, 1);
  }

  if (window.innerWidth <= 900) {
    document.getElementById('sidebar').classList.remove('mobile-open');
    document.getElementById('mobileOverlay').classList.remove('show');
    document.body.style.overflow = '';
  }
}

function toggleSidebar() {
  state.sidebarCollapsed = !state.sidebarCollapsed;
  document.getElementById('sidebar').classList.toggle('collapsed', state.sidebarCollapsed);
  document.getElementById('mainContent').classList.toggle('expanded', state.sidebarCollapsed);
}

function toggleMobileMenu() {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('mobileOverlay');
  if (sidebar.classList.contains('mobile-open')) {
    sidebar.classList.remove('mobile-open');
    overlay.classList.remove('show');
    document.body.style.overflow = '';
  } else {
    sidebar.classList.add('mobile-open');
    overlay.classList.add('show');
    document.body.style.overflow = 'hidden';
  }
}

function refreshCurrentPage() {
  const p = state.currentPage;
  state.initialized[p] = false;
  if (p === 'dashboard') {
    Object.values(state.charts).forEach(c => c.destroy());
    state.charts = {};
    initDashboard();
  } else {
    loadTablePage(p, 1);
  }
  showToast('Data refreshed', 'success');
}

// ─── Dashboard Filters ─────────────────────────
function applyDashboardFilter() {
  state.dashboardFilters = {
    date_start: document.getElementById('filterDateStart').value,
    date_end: document.getElementById('filterDateEnd').value,
    region: document.getElementById('filterRegion').value,
    market: document.getElementById('filterMarket').value,
  };
  const hasFilter = Object.values(state.dashboardFilters).some(v => v);
  document.getElementById('filterActiveTag').style.display = hasFilter ? 'flex' : 'none';
  reloadDashboardCharts();
}

function resetDashboardFilter() {
  document.getElementById('filterDateStart').value = '2011-01-01';
  document.getElementById('filterDateEnd').value = '2014-12-31';
  document.getElementById('filterRegion').value = '';
  document.getElementById('filterMarket').value = '';
  state.dashboardFilters = {};
  document.getElementById('filterActiveTag').style.display = 'none';
  reloadDashboardCharts();
}

function destroyChart(id) {
  if (state.charts[id]) { state.charts[id].destroy(); delete state.charts[id]; }
}

function createChart(id, config) {
  destroyChart(id);
  const canvas = document.getElementById(id);
  if (!canvas) return;
  state.charts[id] = new Chart(canvas.getContext('2d'), config);
  return state.charts[id];
}

// ─── INIT DASHBOARD (Single Request) ──────────
async function initDashboard() {
  showDashboardLoading();
  try {
    // Wake up ping + single fetch for all dashboard data
    const url = API_BASE_URL + '/api/dashboard-summary' + buildFilterQS();
    const res = await fetch(url);
    if (!res.ok) throw new Error('API Error');
    const data = await res.json();

    renderKPI(data.kpi);
    renderChartRevenueYear(data.revenue_by_year);
    renderChartCategory(data.sales_by_category);
    renderChartMarket(data.profit_by_market);

    state.dashboardData.subcatRaw = data.top_subcategory;
    renderSubcatChart(state.dashboardData.subcatMetric);

    renderChartShipMode(data.orders_by_shipmode);

    state.dashboardData.segmentRaw = data.segment_stats;
    renderSegmentChart(state.dashboardData.segmentMetric);

    state.dashboardData.regionRaw = data.region_stats;
    renderRegionChart(state.dashboardData.regionMetric);

    state.dashboardData.quantityRaw = data.quantity_stats;
    renderChartQuantityVsRevenue();
    renderChartAvgPrice();

  } catch (e) {
    console.error('Dashboard load error:', e);
    showToast('Dashboard data load failed. Please wait for server wakeup.', 'error');
  } finally {
    hideDashboardLoading();
  }
}

function reloadDashboardCharts() {
  Object.values(state.charts).forEach(c => c.destroy());
  state.charts = {};
  initDashboard();
}

// ─── Render Dashboard Components ──────────────
function renderKPI(d) {
  document.getElementById('kpiRevenue').textContent = fmt(d.total_revenue);
  document.getElementById('kpiProfit').textContent = fmt(d.total_profit);
  document.getElementById('kpiOrders').textContent = fmtNum(d.total_orders);
  document.getElementById('kpiCustomers').textContent = fmtNum(d.total_customers);
  document.getElementById('kpiQuantity').textContent = fmtNum(d.total_quantity);
  document.getElementById('kpiDiscount').textContent = fmtPct(d.avg_discount_pct);
  document.getElementById('gStatOrders').textContent = fmtNum(d.total_orders);
  document.getElementById('gStatCustomers').textContent = fmtNum(d.total_customers);
  document.getElementById('gStatItems').textContent = fmtNum(d.total_items);
}

function renderChartRevenueYear(data) {
  createChart('chartRevenueYear', {
    type: 'bar',
    data: {
      labels: data.map(d => d.year),
      datasets: [
        { label: 'Revenue', data: data.map(d => d.revenue), backgroundColor: PALETTE_ALPHA(COLORS.blue, 0.7), borderRadius: 6, yAxisID: 'y' },
        { label: 'Profit', data: data.map(d => d.profit), backgroundColor: PALETTE_ALPHA(COLORS.green, 0.7), borderRadius: 6, yAxisID: 'y' },
        { label: 'Quantity', data: data.map(d => d.quantity), type: 'line', borderColor: COLORS.orange, backgroundColor: PALETTE_ALPHA(COLORS.orange, 0.15), borderWidth: 2, pointRadius: 4, pointBackgroundColor: COLORS.orange, yAxisID: 'y2' },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { tooltip: { callbacks: { label: ctx => ctx.dataset.label === 'Quantity' ? `Quantity: ${fmtNum(ctx.raw)} units` : `${ctx.dataset.label}: $${(ctx.raw / 1000).toFixed(1)}K` } } },
      scales: {
        x: { grid: { display: false } },
        y: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { callback: v => '$' + (v / 1000).toFixed(0) + 'K' }, position: 'left' },
        y2: { position: 'right', grid: { display: false }, ticks: { callback: v => fmtNum(v) + ' u' } }
      }
    }
  });
}

function renderChartCategory(data) {
  const colors = [COLORS.blue, COLORS.purple, COLORS.orange];
  createChart('chartCategory', {
    type: 'doughnut',
    data: { labels: data.map(d => d.category), datasets: [{ data: data.map(d => d.sales), backgroundColor: colors.map(c => PALETTE_ALPHA(c, 0.8)), borderWidth: 2, hoverOffset: 8 }] },
    options: { cutout: '65%', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => [`Revenue: ${fmt(ctx.raw)}`, `Qty: ${fmtNum(data[ctx.dataIndex].quantity)} units`] } } } }
  });
  document.getElementById('categoryLegend').innerHTML = data.map((d, i) => `
    <div class="stat-row"><span class="stat-row-label"><span class="stat-row-dot" style="background:${colors[i]};"></span>${d.category}</span><span class="stat-row-value">${fmt(d.sales)}</span></div>
  `).join('');
}

function renderChartMarket(data) {
  createChart('chartMarket', {
    type: 'bar',
    data: {
      labels: data.map(d => d.market),
      datasets: [
        { label: 'Sales', data: data.map(d => d.sales), backgroundColor: PALETTE_ALPHA(COLORS.blue, 0.6), borderRadius: 4 },
        { label: 'Profit', data: data.map(d => d.profit), backgroundColor: PALETTE_ALPHA(COLORS.green, 0.7), borderRadius: 4 },
      ]
    },
    options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, scales: { x: { ticks: { callback: v => '$' + (v / 1000).toFixed(0) + 'K' } } } }
  });
}

function renderSubcatChart(metric) {
  const data = state.dashboardData.subcatRaw;
  const isQty = metric === 'quantity';
  createChart('chartSubcat', {
    type: 'bar',
    data: { labels: data.map(d => d.sub_category), datasets: [{ label: isQty ? 'Quantity' : 'Revenue', data: data.map(d => isQty ? d.quantity : d.sales), backgroundColor: data.map((_, i) => PALETTE_ALPHA(PALETTE[i % PALETTE.length], 0.75)), borderRadius: 5 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { grid: { display: false } }, y: { ticks: { callback: v => isQty ? fmtNum(v) : '$' + (v / 1000).toFixed(0) + 'K' } } } }
  });
}

function toggleSubcatMetric(metric, btn) {
  state.dashboardData.subcatMetric = metric;
  document.querySelectorAll('#subcatToggleRevenue, #subcatToggleQty').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderSubcatChart(metric);
}

function renderChartShipMode(data) {
  createChart('chartShipMode', {
    type: 'pie',
    data: { labels: data.map(d => d.ship_mode), datasets: [{ data: data.map(d => d.order_count), backgroundColor: [COLORS.blue, COLORS.purple, COLORS.orange, COLORS.cyan].map(c => PALETTE_ALPHA(c, 0.8)) }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } }
  });
}

function renderSegmentChart(metric) {
  const data = state.dashboardData.segmentRaw;
  const isQty = metric === 'quantity';
  createChart('chartSegment', {
    type: 'doughnut',
    data: { labels: data.map(d => d.segment), datasets: [{ data: data.map(d => isQty ? d.quantity : d.sales), backgroundColor: [COLORS.blue, COLORS.purple, COLORS.cyan].map(c => PALETTE_ALPHA(c, 0.8)) }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } }
  });
}

function toggleSegmentMetric(metric, btn) {
  state.dashboardData.segmentMetric = metric;
  document.querySelectorAll('#segmentToggleRevenue, #segmentToggleQty').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderSegmentChart(metric);
}

function renderRegionChart(metric) {
  const data = state.dashboardData.regionRaw;
  const isQty = metric === 'quantity';
  createChart('chartRegion', {
    type: 'bar',
    data: { labels: data.map(d => d.region), datasets: [{ label: isQty ? 'Quantity' : 'Revenue', data: data.map(d => isQty ? d.quantity : d.sales), backgroundColor: data.map((_, i) => PALETTE_ALPHA(PALETTE[i % PALETTE.length], 0.75)), borderRadius: 4 }] },
    options: {
      responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } },
      scales: { x: { ticks: { font: { size: 10 } } }, y: { ticks: { callback: v => isQty ? fmtNum(v) : '$' + (v / 1000).toFixed(0) + 'K' } } },
      onClick: (evt, elements) => { if (elements.length) openDrilldown(data[elements[0].index].region); },
      onHover: (evt, elements) => { evt.native.target.style.cursor = elements.length ? 'pointer' : 'default'; }
    }
  });
}

function toggleRegionMetric(metric, btn) {
  state.dashboardData.regionMetric = metric;
  document.querySelectorAll('#regionToggleRevenue, #regionToggleQty').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderRegionChart(metric);
}

function renderChartQuantityVsRevenue() {
  const data = state.dashboardData.quantityRaw;
  createChart('chartQuantityVsRevenue', {
    type: 'bubble',
    data: {
      datasets: [{
        label: 'Sub-Category',
        data: data.map(d => ({ x: d.quantity, y: d.revenue, r: Math.max(5, Math.sqrt(d.avg_unit_price) * 1.2), label: d.sub_category, avg_unit_price: d.avg_unit_price, profit: d.profit })),
        backgroundColor: data.map((_, i) => PALETTE_ALPHA(PALETTE[i % PALETTE.length], 0.6)),
        borderColor: data.map((_, i) => PALETTE[i % PALETTE.length]),
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => `📦 ${ctx.raw.label} | Rev: ${fmt(ctx.raw.y)} | Qty: ${ctx.raw.x}` } } },
      scales: { x: { title: { display: true, text: 'Quantity' } }, y: { title: { display: true, text: 'Revenue' } } }
    }
  });
}

function renderChartAvgPrice() {
  const sorted = [...state.dashboardData.quantityRaw].sort((a, b) => b.avg_unit_price - a.avg_unit_price).slice(0, 8);
  createChart('chartAvgPrice', {
    type: 'bar',
    data: { labels: sorted.map(d => d.sub_category), datasets: [{ label: 'Avg Unit Price ($)', data: sorted.map(d => d.avg_unit_price), backgroundColor: sorted.map((_, i) => PALETTE_ALPHA(PALETTE[i % PALETTE.length], 0.75)), borderRadius: 5 }] },
    options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { ticks: { callback: v => '$' + v.toFixed(0) } } } }
  });
}

// ─── Region Drill-Down ────────────────────────
async function openDrilldown(region) {
  document.getElementById('drilldownTitle').textContent = `🔍 ${region} — Explorer`;
  document.getElementById('drilldownModal').classList.add('open');
  document.getElementById('drilldownBackdrop').classList.add('open');
  document.body.style.overflow = 'hidden';

  try {
    const d = await fetch(API_BASE_URL + `/api/region-drilldown?region=${encodeURIComponent(region)}`).then(r => r.json());
    renderDrillTrend(d.trend);
    renderDrillSubcat(d.top_subcategories);
    renderDrillSegments(d.segments);
    renderDrillCountries(d.top_countries);
  } catch (e) {
    showToast('Failed to load region data', 'error');
  }
}

function closeDrilldown() {
  document.getElementById('drilldownModal').classList.remove('open');
  document.getElementById('drilldownBackdrop').classList.remove('open');
  document.body.style.overflow = '';
  destroyChart('drillTrend'); destroyChart('drillCountries');
}

function renderDrillTrend(trend) {
  createChart('drillTrend', {
    type: 'line',
    data: {
      labels: trend.map(d => d.year),
      datasets: [
        { label: 'Revenue', data: trend.map(d => d.sales), borderColor: COLORS.blue, backgroundColor: PALETTE_ALPHA(COLORS.blue, 0.15), fill: true },
        { label: 'Profit', data: trend.map(d => d.profit), borderColor: COLORS.green, backgroundColor: PALETTE_ALPHA(COLORS.green, 0.1), fill: true },
      ]
    },
    options: { responsive: true, maintainAspectRatio: false }
  });
}

function renderDrillSubcat(rows) {
  document.getElementById('drillSubcatBody').innerHTML = rows.map(r => `<tr><td><strong>${esc(r.sub_category)}</strong></td><td><span class="badge badge-info">${esc(r.category)}</span></td><td>${fmt(r.sales)}</td><td>${fmtNum(r.quantity)}</td><td><span class="badge badge-warning">${fmt(r.avg_unit_price)}</span></td><td>${profitBadge(r.profit)}</td></tr>`).join('');
}

function renderDrillSegments(segments) {
  const total = segments.reduce((s, r) => s + r.sales, 0);
  document.getElementById('drillSegments').innerHTML = segments.map((seg, i) => {
    const pct = total > 0 ? ((seg.sales / total) * 100).toFixed(1) : 0;
    return `<div class="drill-segment-row"><div class="drill-seg-label"><span class="stat-row-dot" style="background:${PALETTE[i % PALETTE.length]};"></span><span>${segmentBadge(seg.segment)}</span></div><div class="drill-seg-bars"><div class="drill-seg-bar-wrap"><div class="drill-seg-bar" style="width:${pct}%;background:${PALETTE[i % PALETTE.length]};"></div></div><span class="drill-seg-pct">${pct}%</span></div><div class="drill-seg-stats"><span>${fmt(seg.sales)}</span><span style="color:var(--text-muted);">${fmtNum(seg.quantity)} units</span></div></div>`;
  }).join('');
}

function renderDrillCountries(countries) {
  createChart('drillCountries', {
    type: 'bar',
    data: {
      labels: countries.map(d => d.country),
      datasets: [
        { label: 'Revenue', data: countries.map(d => d.sales), backgroundColor: PALETTE_ALPHA(COLORS.blue, 0.7) },
        { label: 'Profit', data: countries.map(d => d.profit), backgroundColor: PALETTE_ALPHA(COLORS.green, 0.7) },
      ]
    },
    options: { responsive: true, maintainAspectRatio: false, scales: { x: { ticks: { maxRotation: 30, font: { size: 10 } } } } }
  });
}

// ─── Table Loader ─────────────────────────────
async function loadTablePage(type, page) {
  const s = state.pages[type];
  s.page = page;
  const url = `${API_BASE_URL}/api/${type}?page=${page}&limit=${s.limit}&q=${encodeURIComponent(s.q)}`;
  try {
    const json = await fetch(url).then(r => r.json());
    s.total = json.total; s.data = json.data;
    renderTable(type, json.data);
    renderPagination(type, page, json.total, s.limit);
    const el = document.getElementById(`${type}Info`);
    if (el) el.textContent = `Showing ${fmtNum((page - 1) * s.limit + 1)}–${fmtNum(Math.min(page * s.limit, json.total))} of ${fmtNum(json.total)} records`;
  } catch (e) { showToast(`Failed to load ${type} data`, 'error'); }
}

function renderTable(type, data) {
  const tbody = document.getElementById(`${type}Tbody`);
  if (!tbody) return;
  if (!data || !data.length) { tbody.innerHTML = `<tr><td colspan="20"><div class="empty-state"><div class="empty-state-text">No records found</div></div></td></tr>`; return; }

  const rows = {
    orders: row => `<td><span class="primary-text">${esc(row.order_id_raw)}</span></td><td><div class="primary-text">${esc(row.customer_name)}</div><div class="muted-text">${esc(row.city)}, ${esc(row.country)}</div></td><td>${segmentBadge(row.segment)}</td><td><span class="primary-text">${esc(row.category)}</span></td><td>${esc(row.sub_category)}</td><td><span class="primary-text">${fmt(row.sales)}</span></td><td>${profitBadge(row.profit)}</td><td>${fmtPct(row.discount_pct)}</td><td>${row.quantity}</td><td>${shipmodeBadge(row.ship_mode)}</td><td>${priorityBadge(row.order_priority)}</td><td>${marketBadge(row.market)}</td><td>${esc(row.country)}</td><td><span class="muted-text">${fmtDate(row.order_date)}</span></td>`,
    products: row => `<td><span class="muted-text" style="font-size:11px;">${esc(row.product_id)}</span></td><td><span class="badge badge-info">${esc(row.category)}</span></td><td>${esc(row.sub_category)}</td><td><span class="primary-text" style="max-width:280px;display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(row.product_name)}</span></td><td>${fmt(row.avg_sales)}</td><td>${profitBadge(row.total_profit)}</td><td><span class="badge badge-muted">${fmtNum(row.times_sold)}x</span></td>`,
    customers: row => `<td><span class="muted-text" style="font-size:11px;">${esc(row.customer_id)}</span></td><td><span class="primary-text">${esc(row.customer_name)}</span></td><td>${segmentBadge(row.segment)}</td><td><span class="badge badge-muted">${fmtNum(row.total_orders)}</span></td><td><span class="primary-text">${fmt(row.total_sales)}</span></td><td>${profitBadge(row.total_profit)}</td><td>${fmtPct(row.avg_discount)}</td>`,
    locations: row => `<td><span class="primary-text">${esc(row.city)}</span></td><td>${esc(row.state) || '—'}</td><td>${esc(row.country)}</td><td>${esc(row.region)}</td><td>${marketBadge(row.market)}</td><td>${fmtNum(row.total_orders)}</td><td><span class="primary-text">${fmt(row.total_sales)}</span></td><td>${profitBadge(row.total_profit)}</td>`
  };
  tbody.innerHTML = data.map(row => `<tr>${rows[type](row)}</tr>`).join('');
}

function renderPagination(type, currentPage, total, limit) {
  const totalPages = Math.ceil(total / limit);
  const container = document.getElementById(`${type}Pagination`);
  if (!container) return;
  let html = `<div class="pagination-info">Page ${currentPage} of ${totalPages}</div>`;
  html += `<button class="page-btn" onclick="loadTablePage('${type}', 1)" ${currentPage <= 1 ? 'disabled' : ''}>«</button>`;
  html += `<button class="page-btn" onclick="loadTablePage('${type}', ${currentPage - 1})" ${currentPage <= 1 ? 'disabled' : ''}>‹</button>`;
  for (let i = Math.max(1, currentPage - 2); i <= Math.min(totalPages, Math.max(1, currentPage - 2) + 4); i++) {
    html += `<button class="page-btn ${i === currentPage ? 'active' : ''}" onclick="loadTablePage('${type}', ${i})">${i}</button>`;
  }
  html += `<button class="page-btn" onclick="loadTablePage('${type}', ${currentPage + 1})" ${currentPage >= totalPages ? 'disabled' : ''}>›</button>`;
  html += `<button class="page-btn" onclick="loadTablePage('${type}', ${totalPages})" ${currentPage >= totalPages ? 'disabled' : ''}>»</button>`;
  container.innerHTML = html;
}

// ─── Export CSV ───────────────────────────────
function exportTable(type) {
  const data = state.pages[type].data;
  if (!data || !data.length) { showToast('No data to export', 'error'); return; }
  const headers = Object.keys(data[0]);
  const csv = [headers.join(','), ...data.map(row => headers.map(h => String(row[h] || '').includes(',') ? `"${row[h]}"` : row[h]).join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${type}_export.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Events ─────────────────────────────
document.getElementById('topSearchInput').addEventListener('input', function () {
  const p = state.currentPage;
  if (!['orders', 'products', 'customers', 'locations'].includes(p)) return;
  const s = state.pages[p];
  clearTimeout(s.timer);
  s.timer = setTimeout(() => { s.q = this.value; loadTablePage(p, 1); }, 350);
});

window.addEventListener('pagesLoaded', () => { 
  // Silent ping to wake up pythonanywhere backend early
  fetch(API_BASE_URL + '/').catch(() => {});
  
  if (sessionStorage.getItem("storeiq_logged_in") === "true") {
    navigateTo('dashboard'); 
  }
});
window.addEventListener('resize', () => {
  if (window.innerWidth > 900) {
    document.getElementById('sidebar').classList.remove('mobile-open');
    document.getElementById('mobileOverlay').classList.remove('show');
    document.body.style.overflow = '';
  }
});

// ─── Expose to window ─────────────────────────
Object.assign(window, {
  navigateTo, toggleSidebar, toggleMobileMenu, refreshCurrentPage, exportTable, showToast,
  applyDashboardFilter, resetDashboardFilter, toggleSubcatMetric, toggleRegionMetric, toggleSegmentMetric, openDrilldown, closeDrilldown
});
