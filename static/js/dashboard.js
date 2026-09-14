/* ===========================================
   StoreIQ Admin — Dashboard JS
   Navigation, Charts, Tables, Pagination
   =========================================== */

'use strict';

// ─── State ────────────────────────────────────
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

// ─── Toast ────────────────────────────────────
function showToast(message, type = 'info', duration = 3000) {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  const icons = { success: '', error: '', info: 'ℹ' };
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
    document.body.style.overflow = 'hidden'; // prevent background scroll
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

// ─── Dashboard Init ───────────────────────────
async function initDashboard() {
  await Promise.all([
    loadKPI(),
    loadChartRevenueYear(),
    loadChartCategory(),
    loadChartMarket(),
    loadChartSubcat(),
    loadChartShipMode(),
    loadChartSegment(),
    loadChartRegion(),
  ]);
}

// ─── KPI ──────────────────────────────────────
async function loadKPI() {
  try {
    const d = await fetch('/api/kpi').then(r => r.json());

    document.getElementById('kpiRevenue').textContent   = fmt(d.total_revenue);
    document.getElementById('kpiProfit').textContent    = fmt(d.total_profit);
    document.getElementById('kpiOrders').textContent    = fmtNum(d.total_orders);
    document.getElementById('kpiCustomers').textContent = fmtNum(d.total_customers);
    document.getElementById('kpiDiscount').textContent  = fmtPct(d.avg_discount_pct);
    document.getElementById('kpiShipping').textContent  = fmt(d.total_shipping_cost);

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
    const data = await fetch('/api/revenue-by-year').then(r => r.json());
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
          },
          {
            label: 'Profit',
            data: data.map(d => d.profit),
            backgroundColor: PALETTE_ALPHA(COLORS.green, 0.7),
            borderColor: COLORS.green,
            borderWidth: 1,
            borderRadius: 6,
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
              label: ctx => `${ctx.dataset.label}: $${(ctx.raw/1000).toFixed(1)}K`
            }
          }
        },
        scales: {
          x: { grid: { display: false } },
          y: {
            grid: { color: 'rgba(255,255,255,0.04)' },
            ticks: { callback: v => '$' + (v/1000).toFixed(0) + 'K' }
          }
        }
      }
    });
  } catch(e) { console.error('Revenue chart error', e); }
}

// ─── Category Donut ───────────────────────────
async function loadChartCategory() {
  try {
    const data = await fetch('/api/sales-by-category').then(r => r.json());
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
              label: ctx => `${ctx.label}: $${(ctx.raw/1e6).toFixed(2)}M`
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
    const data = await fetch('/api/profit-by-market').then(r => r.json());
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
          tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${fmt(ctx.raw)}` } }
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

// ─── Sub-Category Bar ─────────────────────────
async function loadChartSubcat() {
  try {
    const data = await fetch('/api/top-subcategory').then(r => r.json());
    createChart('chartSubcat', {
      type: 'bar',
      data: {
        labels: data.map(d => d.sub_category),
        datasets: [{
          label: 'Sales',
          data: data.map(d => d.sales),
          backgroundColor: data.map((_, i) => PALETTE_ALPHA(PALETTE[i % PALETTE.length], 0.75)),
          borderRadius: 5,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: ctx => `Sales: ${fmt(ctx.raw)}` } }
        },
        scales: {
          x: { grid: { display: false }, ticks: { maxRotation: 35 } },
          y: {
            grid: { color: 'rgba(255,255,255,0.04)' },
            ticks: { callback: v => '$' + (v/1000).toFixed(0) + 'K' }
          }
        }
      }
    });
  } catch(e) { console.error('Subcategory chart error', e); }
}

// ─── Ship Mode Pie ────────────────────────────
async function loadChartShipMode() {
  try {
    const data = await fetch('/api/orders-by-shipmode').then(r => r.json());
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

// ─── Segment Doughnut ─────────────────────────
async function loadChartSegment() {
  try {
    const data = await fetch('/api/segment-stats').then(r => r.json());
    const colors = [COLORS.blue, COLORS.purple, COLORS.cyan];
    createChart('chartSegment', {
      type: 'doughnut',
      data: {
        labels: data.map(d => d.segment),
        datasets: [{
          data: data.map(d => d.sales),
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
          tooltip: { callbacks: { label: ctx => `${ctx.label}: ${fmt(ctx.raw)}` } }
        }
      }
    });
  } catch(e) { console.error('Segment chart error', e); }
}

// ─── Region Bar ───────────────────────────────
async function loadChartRegion() {
  try {
    const data = await fetch('/api/region-stats').then(r => r.json());
    createChart('chartRegion', {
      type: 'bar',
      data: {
        labels: data.map(d => d.region),
        datasets: [{
          label: 'Sales',
          data: data.map(d => d.sales),
          backgroundColor: data.map((_, i) => PALETTE_ALPHA(PALETTE[i % PALETTE.length], 0.75)),
          borderRadius: 4,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: ctx => `Sales: ${fmt(ctx.raw)}` } }
        },
        scales: {
          x: { grid: { display: false }, ticks: { maxRotation: 40, font: { size: 10 } } },
          y: {
            grid: { color: 'rgba(255,255,255,0.04)' },
            ticks: { callback: v => '$' + (v/1000).toFixed(0) + 'K' }
          }
        }
      }
    });
  } catch(e) { console.error('Region chart error', e); }
}

// ─── Table Loader ─────────────────────────────
async function loadTablePage(type, page) {
  const s = state.pages[type];
  s.page = page;

  const url = `/api/${type}?page=${page}&limit=${s.limit}&q=${encodeURIComponent(s.q)}`;

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
window.addEventListener('DOMContentLoaded', () => {
  navigateTo('dashboard');
  state.initialized['dashboard'] = true;
  initDashboard();
});


// ─── Mobile Sidebar Toggle ─────────────────────
// Auto-reset sidebar state on window resize
window.addEventListener('resize', () => {
  if (window.innerWidth > 900) {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('mobileOverlay');
    sidebar.classList.remove('mobile-open');
    overlay.classList.remove('show');
    document.body.style.overflow = '';
  }
});
