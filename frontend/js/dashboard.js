'use strict';
const API_BASE_URL = 'https://adwyaalk.pythonanywhere.com';
/* ===========================================
   StoreIQ Admin — Dashboard JS
   Navigation, Charts, Tables, Pagination
   =========================================== */

// ─── State ────────────────────────────
const state = {
  currentPage: 'dashboard',
  sidebarCollapsed: false,
  pages: {
    orders:    { page: 1, limit: 20, total: 0, q: '', data: [], timer: null },
    products:  { page: 1, limit: 20, total: 0, q: '', data: [], timer: null },
    customers: { page: 1, limit: 20, total: 0, q: '', data: [], timer: null },
    locations: { page: 1, limit: 20, total: 0, q: '', data: [], timer: null },
  },
  charts: {},
  initialized: {},
  // Dashboard cached data for toggle charts
  dashboardData: {
    subcatRaw: [],
    regionRaw: [],
    segmentRaw: [],
    quantityRaw: [],
    subcatMetric: 'sales',
    regionMetric: 'sales',
    segmentMetric: 'sales',
  },
  // Active dashboard filters
  dashboardFilters: {},
};

// ─── Chart.js Global Defaults ─────────────────
Chart.defaults.color = '#8888aa';
Chart.defaults.borderColor = 'rgba(255,255,255,0.06)';
Chart.defaults.font.family = "'Inter', sans-serif";
Chart.defaults.font.size = 12;

// ─── Color Palettes ───────────────────────────
const COLORS = {
  blue:   '#4f8ef7',
  purple: '#8b5cf6',
  green:  '#22c55e',
  red:    '#ef4444',
  orange: '#f59e0b',
  cyan:   '#06b6d4',
  pink:   '#ec4899',
};

const PALETTE = [
  '#4f8ef7','#8b5cf6','#22c55e','#f59e0b',
  '#06b6d4','#ef4444','#ec4899','#a78bfa',
  '#34d399','#fbbf24','#60a5fa','#f87171',
];

const PALETTE_ALPHA = (color, a=0.7) => color + Math.round(a*255).toString(16).padStart(2,'0');

// ─── Helpers ──────────────────────────────────
function fmt(n, prefix='$') {
  if (n == null || isNaN(n)) return '—';
  const abs = Math.abs(n);
  if (abs >= 1e6) return (n < 0 ? '-' : '') + prefix + (abs/1e6).toFixed(2) + 'M';
  if (abs >= 1e3) return (n < 0 ? '-' : '') + prefix + (abs/1e3).toFixed(1) + 'K';
  return (n < 0 ? '-' : '') + prefix + abs.toFixed(2);
}

function fmtNum(n) {
  if (n == null) return '—';
  return Number(n).toLocaleString();
}

function fmtPct(n) { return n != null ? n.toFixed(1) + '%' : '—'; }

function profitBadge(profit) {
  if (profit == null) return '<span class="badge badge-muted">—</span>';
  const cls = profit >= 0 ? 'badge-success' : 'badge-danger';
  const sign = profit >= 0 ? '+' : '';
  return `<span class="badge ${cls}">${sign}$${Math.abs(profit).toFixed(2)}</span>`;
}

function netStatusBadge(profit) {
  if (profit == null) return '<span class="badge badge-muted">—</span>';
  if (profit > 0)  return '<span class="badge badge-success">PROFIT</span>';
  if (profit === 0) return '<span class="badge badge-neutral">BREAK EVEN</span>';
  return '<span class="badge badge-danger">LOSS</span>';
}

function segmentBadge(seg) {
  const map = { 'Consumer': 'badge-info', 'Corporate': 'badge-purple', 'Home Office': 'badge-cyan' };
  return `<span class="badge ${map[seg] || 'badge-muted'}">${seg}</span>`;
}

function priorityBadge(p) {
  const map = { 'Critical': 'badge-danger', 'High': 'badge-warning', 'Medium': 'badge-info', 'Low': 'badge-muted' };
  return `<span class="badge ${map[p] || 'badge-muted'}">${p}</span>`;
}

function marketBadge(m) {
  return `<span class="badge badge-muted">${m}</span>`;
}

function shipmodeBadge(sm) {
  const map = { 'Same Day': 'badge-danger', 'First Class': 'badge-warning', 'Second Class': 'badge-info', 'Standard Class': 'badge-muted' };
  return `<span class="badge ${map[sm] || 'badge-muted'}">${sm}</span>`;
}

function fmtDate(d) {
  if (!d) return '—';
  return d.substring(0, 10);
}

function esc(s) {
  if (!s) return '—';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ─── Build filter query string ─────────────────
function buildFilterQS(extra) {
  const f = state.dashboardFilters;
  const params = new URLSearchParams();
  if (f.date_start) params.set('date_start', f.date_start);
  if (f.date_end)   params.set('date_end',   f.date_end);
  if (f.region)     params.set('region',     f.region);
  if (f.market)     params.set('market',     f.market);
  if (extra)        Object.entries(extra).forEach(([k,v]) => params.set(k, v));
  const qs = params.toString();
  return qs ? '?' + qs : '';
}

// ─── Dashboard Loading Overlay ─────────────────
function showDashboardLoading() {
  const el = document.getElementById('dashboardLoadingOverlay');
  if (el) { el.classList.add('visible'); }
}
function hideDashboardLoading() {
  const el = document.getElementById('dashboardLoadingOverlay');
  if (el) { el.classList.remove('visible'); }
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
    orders:    ['Orders', 'Transaction management'],
    products:  ['Products', 'Product catalog'],
    customers: ['Customers', 'Customer directory'],
    locations: ['Locations', 'Geographic distribution'],
    ai:        ['AI Predictor', 'XGBoost Transaction Intelligence'],
  };

  const [title, subtitle] = titles[pageName] || ['Page', ''];
  document.getElementById('topbarTitle').textContent = title;
  document.getElementById('topbarSubtitle').textContent = subtitle;

  // Show search bar for table pages
  const tablePages = ['orders','products','customers','locations'];
  document.getElementById('topSearchBar').style.display = tablePages.includes(pageName) ? 'flex' : 'none';

  // Init page once
  if (!state.initialized[pageName]) {
    state.initialized[pageName] = true;
    if (pageName === 'dashboard') initDashboard();
    else if (tablePages.includes(pageName)) loadTablePage(pageName, 1);
  }
  // Auto-close mobile menu when navigating
  const isMobile = window.innerWidth <= 900;
  if (isMobile) {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('mobileOverlay');
    sidebar.classList.remove('mobile-open');
    overlay.classList.remove('show');
    document.body.style.overflow = '';
  }
}

function toggleSidebar() {
  state.sidebarCollapsed = !state.sidebarCollapsed;
  document.getElementById('sidebar').classList.toggle('collapsed', state.sidebarCollapsed);
  document.getElementById('mainContent').classList.toggle('expanded', state.sidebarCollapsed);
}

function toggleMobileMenu() {
  const sidebar  = document.getElementById('sidebar');
  const overlay  = document.getElementById('mobileOverlay');
  const isOpen   = sidebar.classList.contains('mobile-open');

  if (isOpen) {
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
  const start  = document.getElementById('filterDateStart').value;
  const end    = document.getElementById('filterDateEnd').value;
  const region = document.getElementById('filterRegion').value;
  const market = document.getElementById('filterMarket').value;

  state.dashboardFilters = {};
  if (start)  state.dashboardFilters.date_start = start;
  if (end)    state.dashboardFilters.date_end   = end;
  if (region) state.dashboardFilters.region     = region;
  if (market) state.dashboardFilters.market     = market;

  // Show "Filter active" tag
  const tag = document.getElementById('filterActiveTag');
  const hasFilter = start || end || region || market;
  if (tag) tag.style.display = hasFilter ? 'flex' : 'none';

  // Reload all charts
  reloadDashboardCharts();
}

function resetDashboardFilter() {
  document.getElementById('filterDateStart').value = '2011-01-01';
  document.getElementById('filterDateEnd').value   = '2014-12-31';
  document.getElementById('filterRegion').value    = '';
  document.getElementById('filterMarket').value    = '';
  state.dashboardFilters = {};
  const tag = document.getElementById('filterActiveTag');
  if (tag) tag.style.display = 'none';
  reloadDashboardCharts();
}

async function reloadDashboardCharts() {
  // Destroy existing charts
  Object.values(state.charts).forEach(c => c.destroy());
  state.charts = {};
  showDashboardLoading();
  try {
    await Promise.all([
      loadKPI(),
      loadChartRevenueYear(),
      loadChartCategory(),
      loadChartMarket(),
      loadChartSubcat(),
      loadChartShipMode(),
      loadChartSegment(),
      loadChartRegion(),
      loadChartQuantityVsRevenue(),
      loadChartAvgPrice(),
    ]);
  } finally {
    hideDashboardLoading();
  }
}

// ─── Dashboard Init ───────────────────────────
async function initDashboard() {
  showDashboardLoading();
  try {
    await Promise.all([
      loadKPI(),
      loadChartRevenueYear(),
      loadChartCategory(),
      loadChartMarket(),
      loadChartSubcat(),
      loadChartShipMode(),
      loadChartSegment(),
      loadChartRegion(),
      loadChartQuantityVsRevenue(),
      loadChartAvgPrice(),
    ]);
  } finally {
    hideDashboardLoading();
  }
}

// ─── KPI ──────────────────────────────────────
async function loadKPI() {
  try {
    const d = await fetch(API_BASE_URL + '/api/kpi' + buildFilterQS()).then(r => r.json());

    document.getElementById('kpiRevenue').textContent   = fmt(d.total_revenue);
    document.getElementById('kpiProfit').textContent    = fmt(d.total_profit);
    document.getElementById('kpiOrders').textContent    = fmtNum(d.total_orders);
    document.getElementById('kpiCustomers').textContent = fmtNum(d.total_customers);
    document.getElementById('kpiQuantity').textContent  = fmtNum(d.total_quantity);
    document.getElementById('kpiDiscount').textContent  = fmtPct(d.avg_discount_pct);

    document.getElementById('gStatOrders').textContent    = fmtNum(d.total_orders);
    document.getElementById('gStatCustomers').textContent = fmtNum(d.total_customers);
    document.getElementById('gStatItems').textContent     = fmtNum(d.total_items);
  } catch(e) {
    showToast('Failed to load KPI data', 'error');
  }
}

// ─── Chart Helpers ────────────────────────────
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

// ─── Revenue by Year ──────────────────────────
async function loadChartRevenueYear() {
  try {
    const data = await fetch(API_BASE_URL + '/api/revenue-by-year' + buildFilterQS()).then(r => r.json());
    const labels = data.map(d => d.year);
    createChart('chartRevenueYear', {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Revenue',
            data: data.map(d => d.revenue),
            backgroundColor: PALETTE_ALPHA(COLORS.blue, 0.7),
            borderColor: COLORS.blue,
            borderWidth: 1,
            borderRadius: 6,
            yAxisID: 'y',
          },
          {
            label: 'Profit',
            data: data.map(d => d.profit),
            backgroundColor: PALETTE_ALPHA(COLORS.green, 0.7),
            borderColor: COLORS.green,
            borderWidth: 1,
            borderRadius: 6,
            yAxisID: 'y',
          },
          {
            label: 'Quantity',
            data: data.map(d => d.quantity),
            type: 'line',
            borderColor: COLORS.orange,
            backgroundColor: PALETTE_ALPHA(COLORS.orange, 0.15),
            borderWidth: 2,
            pointRadius: 4,
            pointBackgroundColor: COLORS.orange,
            tension: 0.3,
            fill: false,
            yAxisID: 'y2',
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'top', labels: { boxWidth: 12, padding: 16 } },
          tooltip: {
            callbacks: {
              label: ctx => {
                if (ctx.dataset.label === 'Quantity') return `Quantity: ${fmtNum(ctx.raw)} units`;
                return `${ctx.dataset.label}: $${(ctx.raw/1000).toFixed(1)}K`;
              }
            }
          }
        },
        scales: {
          x: { grid: { display: false } },
          y: {
            grid: { color: 'rgba(255,255,255,0.04)' },
            ticks: { callback: v => '$' + (v/1000).toFixed(0) + 'K' },
            position: 'left',
          },
          y2: {
            position: 'right',
            grid: { display: false },
            ticks: { callback: v => fmtNum(v) + ' u' },
          },
        }
      }
    });
  } catch(e) { console.error('Revenue chart error', e); }
}

// ─── Category Donut ───────────────────────────
async function loadChartCategory() {
  try {
    const data = await fetch(API_BASE_URL + '/api/sales-by-category' + buildFilterQS()).then(r => r.json());
    const colors = [COLORS.blue, COLORS.purple, COLORS.orange];
    createChart('chartCategory', {
      type: 'doughnut',
      data: {
        labels: data.map(d => d.category),
        datasets: [{
          data: data.map(d => d.sales),
          backgroundColor: colors.map(c => PALETTE_ALPHA(c, 0.8)),
          borderColor: colors,
          borderWidth: 2,
          hoverOffset: 8,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '65%',
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: ctx => {
                const d = data[ctx.dataIndex];
                return [`Revenue: ${fmt(ctx.raw)}`, `Qty: ${fmtNum(d.quantity)} units`, `Avg/unit: ${fmt(d.avg_unit_price)}`];
              }
            }
          }
        }
      }
    });

    // Custom legend
    const legend = document.getElementById('categoryLegend');
    legend.innerHTML = data.map((d, i) => `
      <div class="stat-row">
        <span class="stat-row-label">
          <span class="stat-row-dot" style="background:${colors[i]};"></span>
          ${d.category}
        </span>
        <span class="stat-row-value">${fmt(d.sales)}</span>
      </div>
    `).join('');
  } catch(e) { console.error('Category chart error', e); }
}

// ─── Market Horizontal Bar ────────────────────
async function loadChartMarket() {
  try {
    const data = await fetch(API_BASE_URL + '/api/profit-by-market' + buildFilterQS()).then(r => r.json());
    createChart('chartMarket', {
      type: 'bar',
      data: {
        labels: data.map(d => d.market),
        datasets: [
          {
            label: 'Sales',
            data: data.map(d => d.sales),
            backgroundColor: PALETTE_ALPHA(COLORS.blue, 0.6),
            borderRadius: 4,
          },
          {
            label: 'Profit',
            data: data.map(d => d.profit),
            backgroundColor: PALETTE_ALPHA(COLORS.green, 0.7),
            borderRadius: 4,
          },
        ]
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'top', labels: { boxWidth: 10, padding: 14 } },
          tooltip: { callbacks: {
            label: ctx => `${ctx.dataset.label}: ${fmt(ctx.raw)}`
          }}
        },
        scales: {
          x: {
            grid: { color: 'rgba(255,255,255,0.04)' },
            ticks: { callback: v => '$' + (v/1000).toFixed(0) + 'K' }
          },
          y: { grid: { display: false } }
        }
      }
    });
  } catch(e) { console.error('Market chart error', e); }
}

// ─── Sub-Category Bar (togglable) ─────────────
async function loadChartSubcat() {
  try {
    const data = await fetch(API_BASE_URL + '/api/top-subcategory' + buildFilterQS()).then(r => r.json());
    state.dashboardData.subcatRaw = data;
    renderSubcatChart(state.dashboardData.subcatMetric);
  } catch(e) { console.error('Subcategory chart error', e); }
}

function renderSubcatChart(metric) {
  const data = state.dashboardData.subcatRaw;
  if (!data.length) return;

  const isQty = metric === 'quantity';
  createChart('chartSubcat', {
    type: 'bar',
    data: {
      labels: data.map(d => d.sub_category),
      datasets: [{
        label: isQty ? 'Quantity (units)' : 'Revenue',
        data: data.map(d => isQty ? d.quantity : d.sales),
        backgroundColor: data.map((_, i) => PALETTE_ALPHA(PALETTE[i % PALETTE.length], 0.75)),
        borderRadius: 5,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: {
          label: ctx => isQty
            ? `Qty: ${fmtNum(ctx.raw)} units`
            : `Revenue: ${fmt(ctx.raw)}`,
          afterLabel: ctx => {
            const d = data[ctx.dataIndex];
            return isQty
              ? `Revenue: ${fmt(d.sales)}`
              : `Qty: ${fmtNum(d.quantity)} units | Avg/unit: ${fmt(d.avg_unit_price)}`;
          }
        }}
      },
      scales: {
        x: { grid: { display: false }, ticks: { maxRotation: 35 } },
        y: {
          grid: { color: 'rgba(255,255,255,0.04)' },
          ticks: { callback: v => isQty ? fmtNum(v) : '$' + (v/1000).toFixed(0) + 'K' }
        }
      }
    }
  });
}

function toggleSubcatMetric(metric, btn) {
  state.dashboardData.subcatMetric = metric;
  document.querySelectorAll('#subcatToggleRevenue, #subcatToggleQty').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderSubcatChart(metric);
}

// ─── Ship Mode Pie ────────────────────────────
async function loadChartShipMode() {
  try {
    const data = await fetch(API_BASE_URL + '/api/orders-by-shipmode' + buildFilterQS()).then(r => r.json());
    const colors = [COLORS.blue, COLORS.purple, COLORS.orange, COLORS.cyan];
    createChart('chartShipMode', {
      type: 'pie',
      data: {
        labels: data.map(d => d.ship_mode),
        datasets: [{
          data: data.map(d => d.order_count),
          backgroundColor: colors.map(c => PALETTE_ALPHA(c, 0.8)),
          borderColor: colors,
          borderWidth: 2,
          hoverOffset: 6,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom', labels: { boxWidth: 10, padding: 12, font: { size: 11 } } },
          tooltip: { callbacks: { label: ctx => `${ctx.label}: ${fmtNum(ctx.raw)} orders` } }
        }
      }
    });
  } catch(e) { console.error('ShipMode chart error', e); }
}

// ─── Segment Doughnut (togglable) ─────────────
async function loadChartSegment() {
  try {
    const data = await fetch(API_BASE_URL + '/api/segment-stats' + buildFilterQS()).then(r => r.json());
    state.dashboardData.segmentRaw = data;
    renderSegmentChart(state.dashboardData.segmentMetric);
  } catch(e) { console.error('Segment chart error', e); }
}

function renderSegmentChart(metric) {
  const data = state.dashboardData.segmentRaw;
  if (!data.length) return;
  const colors = [COLORS.blue, COLORS.purple, COLORS.cyan];
  const isQty = metric === 'quantity';
  createChart('chartSegment', {
    type: 'doughnut',
    data: {
      labels: data.map(d => d.segment),
      datasets: [{
        data: data.map(d => isQty ? d.quantity : d.sales),
        backgroundColor: colors.map(c => PALETTE_ALPHA(c, 0.8)),
        borderColor: colors,
        borderWidth: 2,
        hoverOffset: 6,
        cutout: '60%',
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { boxWidth: 10, padding: 12, font: { size: 11 } } },
        tooltip: { callbacks: {
          label: ctx => {
            const d = data[ctx.dataIndex];
            return isQty ? `${ctx.label}: ${fmtNum(ctx.raw)} units` : `${ctx.label}: ${fmt(ctx.raw)}`;
          }
        }}
      }
    }
  });
}

function toggleSegmentMetric(metric, btn) {
  state.dashboardData.segmentMetric = metric;
  document.querySelectorAll('#segmentToggleRevenue, #segmentToggleQty').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderSegmentChart(metric);
}

// ─── Region Bar (togglable + drilldown) ───────
async function loadChartRegion() {
  try {
    const data = await fetch(API_BASE_URL + '/api/region-stats' + buildFilterQS()).then(r => r.json());
    state.dashboardData.regionRaw = data;
    renderRegionChart(state.dashboardData.regionMetric);
  } catch(e) { console.error('Region chart error', e); }
}

function renderRegionChart(metric) {
  const data = state.dashboardData.regionRaw;
  if (!data.length) return;
  const isQty = metric === 'quantity';
  const chart = createChart('chartRegion', {
    type: 'bar',
    data: {
      labels: data.map(d => d.region),
      datasets: [{
        label: isQty ? 'Quantity (units)' : 'Revenue',
        data: data.map(d => isQty ? d.quantity : d.sales),
        backgroundColor: data.map((_, i) => PALETTE_ALPHA(PALETTE[i % PALETTE.length], 0.75)),
        borderRadius: 4,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: {
          label: ctx => isQty ? `Qty: ${fmtNum(ctx.raw)} units` : `Revenue: ${fmt(ctx.raw)}`,
          afterLabel: ctx => {
            const d = data[ctx.dataIndex];
            return [
              `Profit: ${fmt(d.profit)}`,
              `Qty: ${fmtNum(d.quantity)} units`,
              `Avg/unit: ${fmt(d.avg_unit_price)}`,
              '🔍 Click to explore this region',
            ];
          }
        }}
      },
      scales: {
        x: { grid: { display: false }, ticks: { maxRotation: 40, font: { size: 10 } } },
        y: {
          grid: { color: 'rgba(255,255,255,0.04)' },
          ticks: { callback: v => isQty ? fmtNum(v) : '$' + (v/1000).toFixed(0) + 'K' }
        }
      },
      onClick: (evt, elements) => {
        if (elements.length) {
          const idx = elements[0].index;
          openDrilldown(data[idx].region);
        }
      },
      onHover: (evt, elements) => {
        evt.native.target.style.cursor = elements.length ? 'pointer' : 'default';
      },
    }
  });
}

function toggleRegionMetric(metric, btn) {
  state.dashboardData.regionMetric = metric;
  document.querySelectorAll('#regionToggleRevenue, #regionToggleQty').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderRegionChart(metric);
}

// ─── Quantity vs Revenue Bubble Chart ─────────
async function loadChartQuantityVsRevenue() {
  try {
    const data = await fetch(API_BASE_URL + '/api/quantity-stats' + buildFilterQS()).then(r => r.json());
    state.dashboardData.quantityRaw = data;

    const maxRev = Math.max(...data.map(d => d.revenue));
    const bubbleData = data.map(d => ({
      x: d.quantity,
      y: d.revenue,
      r: Math.max(5, Math.sqrt(d.avg_unit_price) * 1.2),
      label: d.sub_category,
      avg_unit_price: d.avg_unit_price,
      profit: d.profit,
    }));

    createChart('chartQuantityVsRevenue', {
      type: 'bubble',
      data: {
        datasets: [{
          label: 'Sub-Category',
          data: bubbleData,
          backgroundColor: data.map((_, i) => PALETTE_ALPHA(PALETTE[i % PALETTE.length], 0.6)),
          borderColor: data.map((_, i) => PALETTE[i % PALETTE.length]),
          borderWidth: 1.5,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: ctx => {
                const d = ctx.raw;
                return [
                  `📦 ${d.label}`,
                  `Revenue: ${fmt(d.y)}`,
                  `Quantity: ${fmtNum(d.x)} units`,
                  `Avg Unit Price: ${fmt(d.avg_unit_price)}`,
                  `Profit: ${fmt(d.profit)}`,
                ];
              }
            }
          }
        },
        scales: {
          x: {
            title: { display: true, text: 'Total Quantity (units)', color: '#666' },
            grid: { color: 'rgba(255,255,255,0.04)' },
            ticks: { callback: v => fmtNum(v) },
          },
          y: {
            title: { display: true, text: 'Total Revenue ($)', color: '#666' },
            grid: { color: 'rgba(255,255,255,0.04)' },
            ticks: { callback: v => '$' + (v/1000).toFixed(0) + 'K' },
          }
        }
      }
    });

    // Add sub-category labels as plugins
    setTimeout(() => {
      const chart = state.charts['chartQuantityVsRevenue'];
      if (!chart) return;
      Chart.register({
        id: 'bubbleLabels',
        afterDatasetsDraw(chart) {
          const { ctx, data } = chart;
          ctx.save();
          data.datasets[0].data.forEach((pt, i) => {
            const meta = chart.getDatasetMeta(0);
            const el = meta.data[i];
            if (!el) return;
            ctx.fillStyle = '#aaa';
            ctx.font = '9px Inter';
            ctx.textAlign = 'center';
            ctx.fillText(pt.label, el.x, el.y - el.options.radius - 4);
          });
          ctx.restore();
        }
      });
    }, 200);
  } catch(e) { console.error('Qty vs Revenue chart error', e); }
}

// ─── Avg Unit Price Bar ───────────────────────
async function loadChartAvgPrice() {
  try {
    const data = await fetch(API_BASE_URL + '/api/quantity-stats' + buildFilterQS()).then(r => r.json());
    // Sort by avg_unit_price descending
    const sorted = [...data].sort((a, b) => b.avg_unit_price - a.avg_unit_price).slice(0, 8);
    createChart('chartAvgPrice', {
      type: 'bar',
      data: {
        labels: sorted.map(d => d.sub_category),
        datasets: [{
          label: 'Avg Unit Price ($)',
          data: sorted.map(d => d.avg_unit_price),
          backgroundColor: sorted.map((_, i) => PALETTE_ALPHA(PALETTE[i % PALETTE.length], 0.75)),
          borderRadius: 5,
        }]
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: {
            label: ctx => `Avg/unit: ${fmt(ctx.raw)}`,
            afterLabel: ctx => {
              const d = sorted[ctx.dataIndex];
              return [`Revenue: ${fmt(d.revenue)}`, `Qty: ${fmtNum(d.quantity)} units`];
            }
          }}
        },
        scales: {
          x: {
            grid: { color: 'rgba(255,255,255,0.04)' },
            ticks: { callback: v => '$' + v.toFixed(0) }
          },
          y: { grid: { display: false }, ticks: { font: { size: 10 } } }
        }
      }
    });
  } catch(e) { console.error('Avg price chart error', e); }
}

// ─── Region Drill-Down ────────────────────────
async function openDrilldown(region) {
  const modal    = document.getElementById('drilldownModal');
  const backdrop = document.getElementById('drilldownBackdrop');
  document.getElementById('drilldownTitle').textContent = `🔍 ${region} — Region Explorer`;
  document.getElementById('drilldownSub').textContent = 'Deep-dive: why does this region perform this way?';

  modal.classList.add('open');
  backdrop.classList.add('open');
  document.body.style.overflow = 'hidden';

  try {
    const d = await fetch(API_BASE_URL + `/api/region-drilldown?region=${encodeURIComponent(region)}`).then(r => r.json());
    renderDrillTrend(d.trend);
    renderDrillSubcat(d.top_subcategories);
    renderDrillSegments(d.segments);
    renderDrillCountries(d.top_countries);
  } catch(e) {
    showToast('Failed to load region data', 'error');
  }
}

function closeDrilldown() {
  document.getElementById('drilldownModal').classList.remove('open');
  document.getElementById('drilldownBackdrop').classList.remove('open');
  document.body.style.overflow = '';
  destroyChart('drillTrend');
  destroyChart('drillCountries');
}

function renderDrillTrend(trend) {
  destroyChart('drillTrend');
  createChart('drillTrend', {
    type: 'line',
    data: {
      labels: trend.map(d => d.year),
      datasets: [
        {
          label: 'Revenue',
          data: trend.map(d => d.sales),
          borderColor: COLORS.blue,
          backgroundColor: PALETTE_ALPHA(COLORS.blue, 0.15),
          fill: true, tension: 0.3, borderWidth: 2, pointRadius: 4,
        },
        {
          label: 'Profit',
          data: trend.map(d => d.profit),
          borderColor: COLORS.green,
          backgroundColor: PALETTE_ALPHA(COLORS.green, 0.1),
          fill: true, tension: 0.3, borderWidth: 2, pointRadius: 4,
        },
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: 'top', labels: { boxWidth: 10, padding: 12 } },
        tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${fmt(ctx.raw)}` } }
      },
      scales: {
        x: { grid: { display: false } },
        y: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { callback: v => fmt(v) } }
      }
    }
  });
}

function renderDrillSubcat(rows) {
  const tbody = document.getElementById('drillSubcatBody');
  tbody.innerHTML = rows.map(r => `
    <tr>
      <td><strong>${esc(r.sub_category)}</strong></td>
      <td><span class="badge badge-info">${esc(r.category)}</span></td>
      <td>${fmt(r.sales)}</td>
      <td>${fmtNum(r.quantity)}</td>
      <td><span class="badge badge-warning">${fmt(r.avg_unit_price)}</span></td>
      <td>${profitBadge(r.profit)}</td>
    </tr>
  `).join('');
}

function renderDrillSegments(segments) {
  const container = document.getElementById('drillSegments');
  const total = segments.reduce((s, r) => s + r.sales, 0);
  container.innerHTML = segments.map((seg, i) => {
    const pct = total > 0 ? ((seg.sales / total) * 100).toFixed(1) : 0;
    return `
      <div class="drill-segment-row">
        <div class="drill-seg-label">
          <span class="stat-row-dot" style="background:${PALETTE[i % PALETTE.length]};"></span>
          <span>${segmentBadge(seg.segment)}</span>
        </div>
        <div class="drill-seg-bars">
          <div class="drill-seg-bar-wrap">
            <div class="drill-seg-bar" style="width:${pct}%;background:${PALETTE[i % PALETTE.length]};"></div>
          </div>
          <span class="drill-seg-pct">${pct}%</span>
        </div>
        <div class="drill-seg-stats">
          <span>${fmt(seg.sales)}</span>
          <span style="color:var(--text-muted);">${fmtNum(seg.quantity)} units</span>
        </div>
      </div>
    `;
  }).join('');
}

function renderDrillCountries(countries) {
  destroyChart('drillCountries');
  createChart('drillCountries', {
    type: 'bar',
    data: {
      labels: countries.map(d => d.country),
      datasets: [
        {
          label: 'Revenue',
          data: countries.map(d => d.sales),
          backgroundColor: PALETTE_ALPHA(COLORS.blue, 0.7),
          borderRadius: 4,
        },
        {
          label: 'Profit',
          data: countries.map(d => d.profit),
          backgroundColor: PALETTE_ALPHA(COLORS.green, 0.7),
          borderRadius: 4,
        },
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: 'top', labels: { boxWidth: 10, padding: 12 } },
        tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${fmt(ctx.raw)}` } }
      },
      scales: {
        x: { grid: { display: false }, ticks: { maxRotation: 30, font: { size: 10 } } },
        y: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { callback: v => fmt(v) } }
      }
    }
  });
}

// ─── Table Loader ─────────────────────────────
async function loadTablePage(type, page) {
  const s = state.pages[type];
  s.page = page;

  const url = `${API_BASE_URL}/api/${type}?page=${page}&limit=${s.limit}&q=${encodeURIComponent(s.q)}`;

  try {
    const res = await fetch(url);
    const json = await res.json();
    s.total = json.total;
    s.data  = json.data;

    renderTable(type, json.data);
    renderPagination(type, page, json.total, s.limit);
    updateTableInfo(type, page, s.limit, json.total);
  } catch(e) {
    showToast(`Failed to load ${type} data`, 'error');
    console.error(e);
  }
}

function updateTableInfo(type, page, limit, total) {
  const start = (page - 1) * limit + 1;
  const end   = Math.min(page * limit, total);
  const el    = document.getElementById(`${type}Info`);
  if (el) el.textContent = `Showing ${fmtNum(start)}–${fmtNum(end)} of ${fmtNum(total)} records`;
}

// ─── Render Tables ────────────────────────────
function renderTable(type, data) {
  const tbody = document.getElementById(`${type}Tbody`);
  if (!tbody) return;

  if (!data || data.length === 0) {
    tbody.innerHTML = `<tr><td colspan="20">
      <div class="empty-state">
        <div class="empty-state-icon"></div>
        <div class="empty-state-text">No records found</div>
      </div>
    </td></tr>`;
    return;
  }

  const rows = {
    orders: row => `
      <td><span class="primary-text">${esc(row.order_id_raw)}</span></td>
      <td>
        <div class="primary-text">${esc(row.customer_name)}</div>
        <div class="muted-text">${esc(row.city)}, ${esc(row.country)}</div>
      </td>
      <td>${segmentBadge(row.segment)}</td>
      <td><span class="primary-text">${esc(row.category)}</span></td>
      <td>${esc(row.sub_category)}</td>
      <td><span class="primary-text">${fmt(row.sales)}</span></td>
      <td>${profitBadge(row.profit)}</td>
      <td><span class="${row.discount_pct > 30 ? 'profit-negative' : ''}">${fmtPct(row.discount_pct)}</span></td>
      <td>${row.quantity}</td>
      <td>${shipmodeBadge(row.ship_mode)}</td>
      <td>${priorityBadge(row.order_priority)}</td>
      <td>${marketBadge(row.market)}</td>
      <td>${esc(row.country)}</td>
      <td><span class="muted-text">${fmtDate(row.order_date)}</span></td>
    `,

    products: row => `
      <td><span class="muted-text" style="font-size:11px;">${esc(row.product_id)}</span></td>
      <td><span class="badge badge-info">${esc(row.category)}</span></td>
      <td>${esc(row.sub_category)}</td>
      <td><span class="primary-text" style="max-width:280px;display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(row.product_name)}</span></td>
      <td>${fmt(row.avg_sales)}</td>
      <td>${profitBadge(row.total_profit)}</td>
      <td><span class="badge badge-muted">${fmtNum(row.times_sold)}x</span></td>
    `,

    customers: row => `
      <td><span class="muted-text" style="font-size:11px;">${esc(row.customer_id)}</span></td>
      <td><span class="primary-text">${esc(row.customer_name)}</span></td>
      <td>${segmentBadge(row.segment)}</td>
      <td><span class="badge badge-muted">${fmtNum(row.total_orders)}</span></td>
      <td><span class="primary-text">${fmt(row.total_sales)}</span></td>
      <td>${profitBadge(row.total_profit)}</td>
      <td><span class="${row.avg_discount > 30 ? 'profit-negative' : ''}">${fmtPct(row.avg_discount)}</span></td>
    `,

    locations: row => `
      <td><span class="primary-text">${esc(row.city)}</span></td>
      <td>${esc(row.state) || '—'}</td>
      <td>${esc(row.country)}</td>
      <td>${esc(row.region)}</td>
      <td>${marketBadge(row.market)}</td>
      <td>${fmtNum(row.total_orders)}</td>
      <td><span class="primary-text">${fmt(row.total_sales)}</span></td>
      <td>${profitBadge(row.total_profit)}</td>
    `,
  };

  const renderRow = rows[type];
  tbody.innerHTML = data.map(row => `<tr>${renderRow(row)}</tr>`).join('');
}

// ─── Pagination ───────────────────────────────
function renderPagination(type, currentPage, total, limit) {
  const totalPages = Math.ceil(total / limit);
  const container = document.getElementById(`${type}Pagination`);
  if (!container) return;

  let html = `<div class="pagination-info">Page ${currentPage} of ${totalPages}</div>`;

  html += `<button class="page-btn" onclick="loadTablePage('${type}', 1)" ${currentPage <= 1 ? 'disabled' : ''}>«</button>`;
  html += `<button class="page-btn" onclick="loadTablePage('${type}', ${currentPage - 1})" ${currentPage <= 1 ? 'disabled' : ''}>‹</button>`;

  const start = Math.max(1, currentPage - 2);
  const end   = Math.min(totalPages, start + 4);

  for (let i = start; i <= end; i++) {
    html += `<button class="page-btn ${i === currentPage ? 'active' : ''}" onclick="loadTablePage('${type}', ${i})">${i}</button>`;
  }

  html += `<button class="page-btn" onclick="loadTablePage('${type}', ${currentPage + 1})" ${currentPage >= totalPages ? 'disabled' : ''}>›</button>`;
  html += `<button class="page-btn" onclick="loadTablePage('${type}', ${totalPages})" ${currentPage >= totalPages ? 'disabled' : ''}>»</button>`;

  container.innerHTML = html;
}

// ─── Search Debounce ──────────────────────────
function debounceSearch(type) {
  const s = state.pages[type];
  const inputId = `${type}Search`;
  const input = document.getElementById(inputId);
  if (!input) return;

  clearTimeout(s.timer);
  s.timer = setTimeout(() => {
    s.q = input.value;
    s.page = 1;
    loadTablePage(type, 1);
  }, 350);
}

// Top search bar sync to active table
document.getElementById('topSearchInput').addEventListener('input', function () {
  const p = state.currentPage;
  const tablePages = ['orders','products','customers','locations'];
  if (!tablePages.includes(p)) return;
  const s = state.pages[p];
  const localInput = document.getElementById(`${p}Search`);
  if (localInput) localInput.value = this.value;
  clearTimeout(s.timer);
  s.timer = setTimeout(() => {
    s.q = this.value;
    loadTablePage(p, 1);
  }, 350);
});

// ─── Export CSV ───────────────────────────────
function exportTable(type) {
  const data = state.pages[type].data;
  if (!data || !data.length) { showToast('No data to export', 'error'); return; }

  const headers = Object.keys(data[0]);
  const csv = [
    headers.join(','),
    ...data.map(row => headers.map(h => {
      const v = row[h] != null ? String(row[h]) : '';
      return v.includes(',') ? `"${v}"` : v;
    }).join(','))
  ].join('\n');

  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${type}_export_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  showToast(`Exported ${data.length} rows`, 'success');
}

// ─── Init on Load ─────────────────────────────
window.addEventListener('pagesLoaded', () => {
  navigateTo('dashboard');
  state.initialized['dashboard'] = true;
  initDashboard();
});


// ─── Mobile Sidebar Toggle ─────────────────────
window.addEventListener('resize', () => {
  if (window.innerWidth > 900) {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('mobileOverlay');
    sidebar.classList.remove('mobile-open');
    overlay.classList.remove('show');
    document.body.style.overflow = '';
  }
});

// ─── Expose ke window (untuk inline onclick HTML) ────
window.navigateTo         = navigateTo;
window.toggleSidebar      = toggleSidebar;
window.toggleMobileMenu   = toggleMobileMenu;
window.refreshCurrentPage = refreshCurrentPage;
window.exportTable        = exportTable;
window.showToast          = showToast;
window.applyDashboardFilter  = applyDashboardFilter;
window.resetDashboardFilter  = resetDashboardFilter;
window.toggleSubcatMetric    = toggleSubcatMetric;
window.toggleRegionMetric    = toggleRegionMetric;
window.toggleSegmentMetric   = toggleSegmentMetric;
window.openDrilldown         = openDrilldown;
window.closeDrilldown        = closeDrilldown;
