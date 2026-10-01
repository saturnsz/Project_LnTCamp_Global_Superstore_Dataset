import os
import sqlite3
import joblib
import numpy as np
import pandas as pd

from flask import Flask, jsonify, request
from flask_cors import CORS
from pydantic import BaseModel, Field, ValidationError

# ─── Paths ───────────────────────────────────────────────────────────────────

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH  = os.path.join(BASE_DIR, 'superstore (1).sqlite')

# ─── ML Model State ──────────────────────────────────────────────────────────
# Task A (Profit Classification) is removed because Task B (Profit Regression)
# already provides the exact profit amount, from which Profit/Loss status
# is derived deterministically via business logic (profit > 0 = PROFIT, else LOSS).
# The ML Classifier retained is Order Priority Triage (klasifiksai 2),
# which solves a genuine, non-redundant multi-class operational problem.

scaler_clf = cols_clf = model_clf = None
scaler_reg = cols_reg = model_reg = None
scaler_pri = cols_pri = model_pri = None
MODEL_ERROR = None

def _load_model(folder: str, scaler_file: str, cols_file: str, model_file: str):
    scaler = joblib.load(os.path.join(BASE_DIR, folder, scaler_file))
    cols   = joblib.load(os.path.join(BASE_DIR, folder, cols_file))
    model  = joblib.load(os.path.join(BASE_DIR, folder, model_file))
    return scaler, cols, model

_models_loaded = False

def ensure_models_loaded():
    global scaler_clf, cols_clf, model_clf
    global scaler_reg, cols_reg, model_reg
    global scaler_pri, cols_pri, model_pri
    global MODEL_ERROR, _models_loaded

    if _models_loaded or MODEL_ERROR:
        return

    try:
        # Set OMP_NUM_THREADS to 1 to prevent xgboost from hanging in WSGI workers
        os.environ['OMP_NUM_THREADS'] = '1'

        # 1. Financial Estimator (Regression - Product-Line Level Profit)
        scaler_reg, cols_reg, model_reg = _load_model(
            'model_regresi',
            'scaler_reg.pkl', 'training_columns_reg.pkl', 'xgboost_reg_model.pkl',
        )

        # 2. Profit Classifier (Classification - Profit/Loss Status)
        scaler_clf, cols_clf, model_clf = _load_model(
            'model_klasifikasi',
            'scaler_clf.pkl', 'training_columns_clf.pkl', 'xgboost_clf_model.pkl',
        )

        # 3. Operational Triage (Multi-Class Classifier - Order Level Priority, klasifiksai 2)
        scaler_pri, cols_pri, model_pri = _load_model(
            'klasifiksai 2',
            'scaler_clf (1).pkl', 'training_columns_clf (1).pkl', 'xgboost_clf_model (1).pkl',
        )

        # Configure models to use single thread to avoid OpenMP deadlock
        for m in (model_clf, model_reg, model_pri):
            if hasattr(m, 'set_params'):
                m.set_params(n_jobs=1)

        print("[OK] ML models loaded successfully (Regression, Classification & Priority Triage)")
        _models_loaded = True
    except Exception as exc:
        MODEL_ERROR = str(exc)
        print(f"[WARN] Could not load ML models: {exc}")
        print("   Dashboard data features will still work.")


# ─── App Instance ─────────────────────────────────────────────────────────────

app = Flask(__name__)
CORS(app)

# ─── DB Helpers ──────────────────────────────────────────────────────────────

def _get_db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def query(sql: str, params: tuple = ()) -> list[dict]:
    conn = _get_db()
    cur  = conn.cursor()
    cur.execute(sql, params)
    rows = [dict(r) for r in cur.fetchall()]
    conn.close()
    return rows

def query_one(sql: str, params: tuple = ()) -> dict:
    conn = _get_db()
    cur  = conn.cursor()
    cur.execute(sql, params)
    row = cur.fetchone()
    conn.close()
    return dict(row) if row else {}

# ─── Pydantic Request Schemas ─────────────────────────────────────────────────

class PredictInput(BaseModel):
    sales:          float = Field(..., gt=0)
    discount:       float = Field(..., ge=0, le=100)
    quantity:       int   = Field(..., ge=1)
    shipping_cost:  float = Field(..., ge=0)
    category:       str
    sub_category:   str
    segment:        str
    market:         str
    ship_mode:      str
    order_priority: str
    region:         str

class PriorityInput(BaseModel):
    """Input for Order Priority Triage — order_priority is the target, not an input."""
    sales:         float = Field(..., gt=0)
    discount:      float = Field(..., ge=0, le=100)
    quantity:      int   = Field(..., ge=1)
    shipping_cost: float = Field(..., ge=0)
    category:      str
    sub_category:  str
    segment:       str
    market:        str
    ship_mode:     str
    region:        str

# ─── Feature Engineering ──────────────────────────────────────────────────────

def build_input_df(data: PredictInput, training_cols: list[str]) -> pd.DataFrame:
    sales         = data.sales
    discount      = data.discount / 100.0
    quantity      = data.quantity
    shipping_cost = data.shipping_cost

    shipping_cost_ratio = shipping_cost / sales if sales > 0 else 0.0
    discount_impact     = sales * discount
    total_cost_spent    = shipping_cost + discount_impact

    row = {
        'sales':               sales,
        'discount':            discount,
        'quantity':            quantity,
        'shipping_cost':       shipping_cost,
        'shipping_cost_ratio': shipping_cost_ratio,
        'discount_impact':     discount_impact,
        'total_cost_spent':    total_cost_spent,
    }

    for col in training_cols:
        if col not in row:
            row[col] = 0

    _ohe_map = {
        f'ship_mode_{data.ship_mode}':             1,
        f'order_priority_{data.order_priority}':   1,
        f'segment_{data.segment}':                 1,
        f'market_{data.market}':                   1,
        f'region_{data.region}':                   1,
        f'category_{data.category}':               1,
        f'sub_category_{data.sub_category}':       1,
    }
    for key, val in _ohe_map.items():
        if key in row:
            row[key] = val

    df = pd.DataFrame([row])[training_cols]
    return df

def build_priority_df(data: 'PriorityInput', training_cols: list) -> pd.DataFrame:
    """Feature engineering for the Order Priority Triage model (klasifiksai 2).

    Mendukung input persen (misal slider 10) maupun desimal (misal PRD 0.1).
    """
    sales         = data.sales
    # Jika input > 1.0 (misal 10 atau 20), bagi 100; jika sudah desimal (0.1), gunakan langsung
    discount      = (data.discount / 100.0) if data.discount > 1.0 else data.discount
    quantity      = data.quantity
    shipping_cost = data.shipping_cost

    # Feature engineering sesuai PRD klasifikasi.txt
    shipping_cost_ratio = shipping_cost / sales if sales > 0 else 0.0
    discount_impact     = discount * sales                 # PRD: discount_impact = discount * sales
    total_cost_spent    = sales + shipping_cost            # PRD: total_cost_spent = sales + shipping_cost

    row = {
        'sales':               sales,
        'discount':            discount,
        'quantity':            quantity,
        'shipping_cost':       shipping_cost,
        'shipping_cost_ratio': shipping_cost_ratio,
        'discount_impact':     discount_impact,
        'total_cost_spent':    total_cost_spent,
    }

    # Inisialisasi semua kolom OHE ke 0 dulu
    for col in training_cols:
        if col not in row:
            row[col] = 0

    # Set kolom OHE yang relevan ke 1
    _ohe_map = {
        f'ship_mode_{data.ship_mode}':       1,
        f'segment_{data.segment}':           1,
        f'market_{data.market}':             1,
        f'region_{data.region}':             1,
        f'category_{data.category}':         1,
        f'sub_category_{data.sub_category}': 1,
    }
    for key, val in _ohe_map.items():
        if key in row:
            row[key] = val

    return pd.DataFrame([row])[training_cols]


def _get_numeric_cols(scaler) -> list[str]:
    if hasattr(scaler, 'feature_names_in_'):
        return list(scaler.feature_names_in_)
    return ['sales', 'discount', 'quantity', 'shipping_cost',
            'shipping_cost_ratio', 'discount_impact', 'total_cost_spent']

# ─── Health Check Route ───────────────────────────────────────────────────────

@app.route("/", methods=["GET"])
def index():
    return jsonify({"status": "ok", "message": "StoreIQ Backend API (Flask)"})

# ─── KPI Endpoint ─────────────────────────────────────────────────────────────

def _build_filter_clause(args):
    """Build WHERE clause and params from request filter args."""
    conditions = []
    params = []
    date_start = args.get('date_start', '').strip()
    date_end   = args.get('date_end', '').strip()
    region     = args.get('region', '').strip()
    market     = args.get('market', '').strip()

    if date_start:
        conditions.append("o.order_date >= ?")
        params.append(date_start)
    if date_end:
        conditions.append("o.order_date <= ?")
        params.append(date_end)
    if region:
        conditions.append("l.region = ?")
        params.append(region)
    if market:
        conditions.append("l.market = ?")
        params.append(market)

    where = ("WHERE " + " AND ".join(conditions)) if conditions else ""
    needs_loc = bool(region or market)
    return where, tuple(params), needs_loc


@app.route("/api/kpi", methods=["GET"])
def kpi():
    """
    Synchronized multi-level KPIs:
    - Order Level: total_orders, total_customers, avg_order_value (AOV)
    - Product-Line Level: total_revenue, total_profit, total_quantity, avg_discount_pct, total_items, avg_items_per_order
    """
    where, params, needs_loc = _build_filter_clause(request.args)
    loc_join = "JOIN dim_locations l ON o.location_id = l.location_id" if needs_loc else "LEFT JOIN dim_locations l ON o.location_id = l.location_id"
    data = query_one(f"""
        SELECT
            ROUND(SUM(oi.sales), 2)         AS total_revenue,
            ROUND(SUM(oi.profit), 2)        AS total_profit,
            COUNT(DISTINCT o.order_id_raw)  AS total_orders,
            COUNT(DISTINCT o.customer_id)   AS total_customers,
            ROUND(AVG(oi.discount)*100, 1)  AS avg_discount_pct,
            ROUND(SUM(oi.shipping_cost), 2) AS total_shipping_cost,
            COUNT(oi.row_id)                AS total_items,
            ROUND(AVG(oi.quantity), 1)      AS avg_quantity,
            ROUND(SUM(oi.quantity), 0)      AS total_quantity,
            ROUND(SUM(oi.sales) / NULLIF(COUNT(DISTINCT o.order_key), 0), 2) AS avg_order_value,
            ROUND(CAST(COUNT(oi.row_id) AS FLOAT) / NULLIF(COUNT(DISTINCT o.order_key), 0), 1) AS avg_items_per_order
        FROM order_items oi
        JOIN orders o ON oi.order_key = o.order_key
        {loc_join}
        {where}
    """, params)
    return jsonify(data)

# ─── Chart Endpoints ──────────────────────────────────────────────────────────

@app.route("/api/revenue-by-year", methods=["GET"])
def revenue_by_year():
    where, params, needs_loc = _build_filter_clause(request.args)
    loc_join = "JOIN dim_locations l ON o.location_id = l.location_id" if needs_loc else "LEFT JOIN dim_locations l ON o.location_id = l.location_id"
    data = query(f"""
        SELECT oi.year,
               ROUND(SUM(oi.sales),2)    AS revenue,
               ROUND(SUM(oi.profit),2)   AS profit,
               ROUND(SUM(oi.quantity),0) AS quantity
        FROM order_items oi
        JOIN orders o ON oi.order_key = o.order_key
        {loc_join}
        {where}
        GROUP BY oi.year
        ORDER BY oi.year
    """, params)
    return jsonify(data)

@app.route("/api/sales-by-category", methods=["GET"])
def sales_by_category():
    where, params, needs_loc = _build_filter_clause(request.args)
    loc_join = "JOIN dim_locations l ON o.location_id = l.location_id" if needs_loc else "LEFT JOIN dim_locations l ON o.location_id = l.location_id"
    data = query(f"""
        SELECT p.category,
               ROUND(SUM(oi.sales),2)    AS sales,
               ROUND(SUM(oi.profit),2)   AS profit,
               ROUND(SUM(oi.quantity),0) AS quantity,
               ROUND(AVG(oi.sales/NULLIF(oi.quantity,0)),2) AS avg_unit_price
        FROM order_items oi
        JOIN orders o ON oi.order_key = o.order_key
        JOIN dim_products p ON oi.product_id = p.product_id
        {loc_join}
        {where}
        GROUP BY p.category
        ORDER BY sales DESC
    """, params)
    return jsonify(data)

@app.route("/api/profit-by-market", methods=["GET"])
def profit_by_market():
    where, params, needs_loc = _build_filter_clause(request.args)
    data = query(f"""
        SELECT l.market,
               ROUND(SUM(oi.sales),2)    AS sales,
               ROUND(SUM(oi.profit),2)   AS profit,
               ROUND(SUM(oi.quantity),0) AS quantity
        FROM order_items oi
        JOIN orders o ON oi.order_key = o.order_key
        JOIN dim_locations l ON o.location_id = l.location_id
        {where}
        GROUP BY l.market
        ORDER BY profit DESC
    """, params)
    return jsonify(data)

@app.route("/api/top-subcategory", methods=["GET"])
def top_subcategory():
    where, params, needs_loc = _build_filter_clause(request.args)
    loc_join = "JOIN dim_locations l ON o.location_id = l.location_id" if needs_loc else "LEFT JOIN dim_locations l ON o.location_id = l.location_id"
    data = query(f"""
        SELECT p.sub_category,
               ROUND(SUM(oi.sales),2)    AS sales,
               ROUND(SUM(oi.profit),2)   AS profit,
               ROUND(SUM(oi.quantity),0) AS quantity,
               ROUND(AVG(oi.sales/NULLIF(oi.quantity,0)),2) AS avg_unit_price
        FROM order_items oi
        JOIN orders o ON oi.order_key = o.order_key
        JOIN dim_products p ON oi.product_id = p.product_id
        {loc_join}
        {where}
        GROUP BY p.sub_category
        ORDER BY sales DESC
        LIMIT 10
    """, params)
    return jsonify(data)

@app.route("/api/orders-by-shipmode", methods=["GET"])
def orders_by_shipmode():
    """
    Order-level operational analysis: summarizes orders by shipping method,
    ensuring order counts use distinct order keys, alongside total revenue,
    average order value (AOV), and average fulfillment lead time in days.
    """
    data = query("""
        SELECT o.ship_mode,
               COUNT(DISTINCT o.order_key) AS order_count,
               ROUND(SUM(oi.sales), 2)     AS total_sales,
               ROUND(SUM(oi.sales) / NULLIF(COUNT(DISTINCT o.order_key), 0), 2) AS avg_order_value,
               ROUND(AVG(JULIANDAY(o.ship_date) - JULIANDAY(o.order_date)), 1)   AS avg_shipping_days
        FROM orders o
        JOIN order_items oi ON o.order_key = oi.order_key
        GROUP BY o.ship_mode
        ORDER BY order_count DESC
    """)
    return jsonify(data)

@app.route("/api/orders-by-priority", methods=["GET"])
def orders_by_priority():
    """
    Order-level operational analysis: summarizes orders by priority triage level,
    including order count, total sales volume, and fulfillment lead time.
    """
    data = query("""
        SELECT o.order_priority,
               COUNT(DISTINCT o.order_key) AS order_count,
               ROUND(SUM(oi.sales), 2)     AS total_sales,
               ROUND(AVG(JULIANDAY(o.ship_date) - JULIANDAY(o.order_date)), 1) AS avg_shipping_days
        FROM orders o
        JOIN order_items oi ON o.order_key = oi.order_key
        GROUP BY o.order_priority
        ORDER BY order_count DESC
    """)
    return jsonify(data)

@app.route("/api/monthly-trend", methods=["GET"])
def monthly_trend():
    data = query("""
        SELECT
            oi.year,
            oi.week_num,
            ROUND(SUM(oi.sales),2)  AS sales,
            ROUND(SUM(oi.profit),2) AS profit
        FROM order_items oi
        GROUP BY oi.year, oi.week_num
        ORDER BY oi.year, oi.week_num
        LIMIT 200
    """)
    return jsonify(data)

@app.route("/api/profit-margin-trend", methods=["GET"])
def profit_margin_trend():
    data = query("""
        SELECT oi.year,
               ROUND(SUM(oi.sales),2)   AS sales,
               ROUND(SUM(oi.profit),2)  AS profit,
               ROUND(SUM(oi.profit)/SUM(oi.sales)*100, 2) AS margin_pct
        FROM order_items oi
        GROUP BY oi.year
        ORDER BY oi.year
    """)
    return jsonify(data)

@app.route("/api/segment-stats", methods=["GET"])
def segment_stats():
    where, params, needs_loc = _build_filter_clause(request.args)
    loc_join = "JOIN dim_locations l ON o.location_id = l.location_id" if needs_loc else "LEFT JOIN dim_locations l ON o.location_id = l.location_id"
    data = query(f"""
        SELECT c.segment,
               COUNT(DISTINCT c.customer_id) AS customers,
               COUNT(DISTINCT o.order_key)   AS orders,
               ROUND(SUM(oi.sales),2)         AS sales,
               ROUND(SUM(oi.profit),2)        AS profit,
               ROUND(SUM(oi.quantity),0)      AS quantity
        FROM dim_customers c
        JOIN orders o ON c.customer_id = o.customer_id
        JOIN order_items oi ON o.order_key = oi.order_key
        {loc_join}
        {where}
        GROUP BY c.segment
        ORDER BY sales DESC
    """, params)
    return jsonify(data)

@app.route("/api/region-stats", methods=["GET"])
def region_stats():
    where, params, needs_loc = _build_filter_clause(request.args)
    data = query(f"""
        SELECT l.region,
               ROUND(SUM(oi.sales),2)         AS sales,
               ROUND(SUM(oi.profit),2)        AS profit,
               COUNT(DISTINCT o.order_key)    AS orders,
               ROUND(SUM(oi.quantity),0)      AS quantity,
               ROUND(AVG(oi.sales/NULLIF(oi.quantity,0)),2) AS avg_unit_price
        FROM order_items oi
        JOIN orders o ON oi.order_key = o.order_key
        JOIN dim_locations l ON o.location_id = l.location_id
        {where}
        GROUP BY l.region
        ORDER BY sales DESC
    """, params)
    return jsonify(data)


@app.route("/api/region-drilldown", methods=["GET"])
def region_drilldown():
    """Deep-dive into a specific region: top products, segments, categories."""
    region = request.args.get('region', '').strip()
    if not region:
        return jsonify({"error": "region param required"}), 400

    # Top sub-categories in this region
    top_subcat = query("""
        SELECT p.sub_category,
               p.category,
               ROUND(SUM(oi.sales),2)    AS sales,
               ROUND(SUM(oi.profit),2)   AS profit,
               ROUND(SUM(oi.quantity),0) AS quantity,
               ROUND(AVG(oi.sales/NULLIF(oi.quantity,0)),2) AS avg_unit_price
        FROM order_items oi
        JOIN orders o ON oi.order_key = o.order_key
        JOIN dim_locations l ON o.location_id = l.location_id
        JOIN dim_products p ON oi.product_id = p.product_id
        WHERE l.region = ?
        GROUP BY p.sub_category
        ORDER BY sales DESC
        LIMIT 8
    """, (region,))

    # Segment breakdown for this region
    segments = query("""
        SELECT c.segment,
               ROUND(SUM(oi.sales),2)    AS sales,
               ROUND(SUM(oi.profit),2)   AS profit,
               ROUND(SUM(oi.quantity),0) AS quantity,
               COUNT(DISTINCT o.order_key) AS orders
        FROM order_items oi
        JOIN orders o ON oi.order_key = o.order_key
        JOIN dim_locations l ON o.location_id = l.location_id
        JOIN dim_customers c ON o.customer_id = c.customer_id
        WHERE l.region = ?
        GROUP BY c.segment
        ORDER BY sales DESC
    """, (region,))

    # Year trend for this region
    trend = query("""
        SELECT oi.year,
               ROUND(SUM(oi.sales),2)    AS sales,
               ROUND(SUM(oi.profit),2)   AS profit,
               ROUND(SUM(oi.quantity),0) AS quantity
        FROM order_items oi
        JOIN orders o ON oi.order_key = o.order_key
        JOIN dim_locations l ON o.location_id = l.location_id
        WHERE l.region = ?
        GROUP BY oi.year
        ORDER BY oi.year
    """, (region,))

    # Top countries in this region
    countries = query("""
        SELECT l.country,
               ROUND(SUM(oi.sales),2)    AS sales,
               ROUND(SUM(oi.profit),2)   AS profit,
               ROUND(SUM(oi.quantity),0) AS quantity
        FROM order_items oi
        JOIN orders o ON oi.order_key = o.order_key
        JOIN dim_locations l ON o.location_id = l.location_id
        WHERE l.region = ?
        GROUP BY l.country
        ORDER BY sales DESC
        LIMIT 8
    """, (region,))

    return jsonify({
        "region": region,
        "top_subcategories": top_subcat,
        "segments": segments,
        "trend": trend,
        "top_countries": countries,
    })


@app.route("/api/quantity-stats", methods=["GET"])
def quantity_stats():
    """Quantity vs Revenue analysis to surface unit-price differences."""
    where, params, needs_loc = _build_filter_clause(request.args)
    loc_join = "JOIN dim_locations l ON o.location_id = l.location_id" if needs_loc else "LEFT JOIN dim_locations l ON o.location_id = l.location_id"
    data = query(f"""
        SELECT p.sub_category,
               ROUND(SUM(oi.sales),2)    AS revenue,
               ROUND(SUM(oi.quantity),0) AS quantity,
               ROUND(AVG(oi.sales/NULLIF(oi.quantity,0)),2) AS avg_unit_price,
               ROUND(SUM(oi.profit),2)   AS profit
        FROM order_items oi
        JOIN orders o ON oi.order_key = o.order_key
        JOIN dim_products p ON oi.product_id = p.product_id
        {loc_join}
        {where}
        GROUP BY p.sub_category
        ORDER BY revenue DESC
        LIMIT 12
    """, params)
    return jsonify(data)

# ─── Table Endpoints ──────────────────────────────────────────────────────────

@app.route("/api/orders", methods=["GET"])
def orders():
    try:
        page = int(request.args.get("page", 1))
        limit = int(request.args.get("limit", 20))
    except ValueError:
        page, limit = 1, 20
    
    q = request.args.get("q", "").strip()
    offset = (page - 1) * limit

    if q:
        like  = f"%{q}%"
        where = """
            WHERE o.order_id_raw LIKE ?
               OR c.customer_name LIKE ?
               OR p.category LIKE ?
               OR p.sub_category LIKE ?
               OR l.country LIKE ?
               OR o.ship_mode LIKE ?
        """
        params_f = (like,) * 6
    else:
        where, params_f = "", ()

    base_sql = f"""
        FROM order_items oi
        JOIN orders o ON oi.order_key = o.order_key
        JOIN dim_customers c ON o.customer_id = c.customer_id
        JOIN dim_products p  ON oi.product_id = p.product_id
        JOIN dim_locations l ON o.location_id = l.location_id
        {where}
    """

    total = query_one(f"SELECT COUNT(*) AS cnt {base_sql}", params_f).get("cnt", 0)
    rows  = query(f"""
        SELECT
            o.order_id_raw,
            c.customer_name,
            c.segment,
            p.category,
            p.sub_category,
            p.product_name,
            ROUND(oi.sales,2)         AS sales,
            ROUND(oi.profit,2)        AS profit,
            ROUND(oi.discount*100,1)  AS discount_pct,
            oi.quantity,
            ROUND(oi.shipping_cost,2) AS shipping_cost,
            o.ship_mode,
            o.order_priority,
            o.order_date,
            o.ship_date,
            l.city,
            l.country,
            l.market,
            l.region
        {base_sql}
        ORDER BY o.order_date DESC
        LIMIT ? OFFSET ?
    """, params_f + (limit, offset))

    return jsonify({"total": total, "page": page, "limit": limit, "data": rows})

@app.route("/api/products", methods=["GET"])
def products():
    try:
        page = int(request.args.get("page", 1))
        limit = int(request.args.get("limit", 20))
    except ValueError:
        page, limit = 1, 20
        
    q = request.args.get("q", "").strip()
    offset = (page - 1) * limit

    if q:
        like   = f"%{q}%"
        where  = "WHERE p.product_name LIKE ? OR p.category LIKE ? OR p.sub_category LIKE ?"
        params = (like,) * 3
    else:
        where, params = "", ()

    total = query_one(f"SELECT COUNT(*) AS cnt FROM dim_products p {where}", params).get("cnt", 0)
    rows  = query(f"""
        SELECT p.product_id, p.category, p.sub_category, p.product_name,
               ROUND(AVG(oi.sales),2)  AS avg_sales,
               ROUND(SUM(oi.profit),2) AS total_profit,
               COUNT(oi.row_id)        AS times_sold
        FROM dim_products p
        LEFT JOIN order_items oi ON p.product_id = oi.product_id
        {where}
        GROUP BY p.product_id
        ORDER BY total_profit DESC
        LIMIT ? OFFSET ?
    """, params + (limit, offset))

    return jsonify({"total": total, "page": page, "limit": limit, "data": rows})

@app.route("/api/customers", methods=["GET"])
def customers():
    try:
        page = int(request.args.get("page", 1))
        limit = int(request.args.get("limit", 20))
    except ValueError:
        page, limit = 1, 20
        
    q = request.args.get("q", "").strip()
    offset = (page - 1) * limit

    if q:
        like   = f"%{q}%"
        where  = "WHERE c.customer_name LIKE ? OR c.segment LIKE ?"
        params = (like,) * 2
    else:
        where, params = "", ()

    total = query_one(f"SELECT COUNT(DISTINCT c.customer_id) AS cnt FROM dim_customers c {where}", params).get("cnt", 0)
    rows = query(f"""
        SELECT c.customer_id, c.customer_name, c.segment,
               COUNT(DISTINCT o.order_key)   AS total_orders,
               ROUND(SUM(oi.sales),2)         AS total_sales,
               ROUND(SUM(oi.profit),2)        AS total_profit,
               ROUND(AVG(oi.discount)*100,1)  AS avg_discount
        FROM dim_customers c
        LEFT JOIN orders o ON c.customer_id = o.customer_id
        LEFT JOIN order_items oi ON o.order_key = oi.order_key
        {where}
        GROUP BY c.customer_id
        ORDER BY total_sales DESC
        LIMIT ? OFFSET ?
    """, params + (limit, offset))

    return jsonify({"total": total, "page": page, "limit": limit, "data": rows})

@app.route("/api/locations", methods=["GET"])
def locations():
    try:
        page = int(request.args.get("page", 1))
        limit = int(request.args.get("limit", 20))
    except ValueError:
        page, limit = 1, 20
        
    q = request.args.get("q", "").strip()
    offset = (page - 1) * limit

    if q:
        like   = f"%{q}%"
        where  = "WHERE l.city LIKE ? OR l.country LIKE ? OR l.region LIKE ? OR l.market LIKE ?"
        params = (like,) * 4
    else:
        where, params = "", ()

    total = query_one(f"SELECT COUNT(*) AS cnt FROM dim_locations l {where}", params).get("cnt", 0)
    rows  = query(f"""
        SELECT l.location_id, l.city, l.state, l.country, l.region, l.market,
               COUNT(DISTINCT o.order_key)   AS total_orders,
               ROUND(SUM(oi.sales),2)         AS total_sales,
               ROUND(SUM(oi.profit),2)        AS total_profit
        FROM dim_locations l
        LEFT JOIN orders o ON l.location_id = o.location_id
        LEFT JOIN order_items oi ON o.order_key = oi.order_key
        {where}
        GROUP BY l.location_id
        ORDER BY total_sales DESC
        LIMIT ? OFFSET ?
    """, params + (limit, offset))

    return jsonify({"total": total, "page": page, "limit": limit, "data": rows})

# ─── AI Prediction Endpoints ──────────────────────────────────────────────────

@app.route("/api/predict/classify", methods=["POST"])
def predict_classify():
    ensure_models_loaded()
    if MODEL_ERROR:
        return jsonify({"detail": f"ML models tidak dapat dimuat: {MODEL_ERROR}"}), 503
    try:
        payload = PredictInput(**request.json)
        
        df = build_input_df(payload, cols_clf)

        df_scaled    = df.copy()
        numeric_cols = _get_numeric_cols(scaler_clf)
        df_scaled[numeric_cols] = scaler_clf.transform(df[numeric_cols])

        pred  = model_clf.predict(df_scaled)[0]
        proba = model_clf.predict_proba(df_scaled)[0]

        label        = "PROFIT" if pred == 1 else "LOSS"
        profit_prob  = round(float(proba[1]) * 100, 1) if len(proba) > 1 else round(float(max(proba)) * 100, 1)
        confidence   = round(float(max(proba)) * 100, 1)

        return jsonify({
            "status":             "success",
            "prediction":         label,
            "is_profit":          bool(pred == 1),
            "confidence":         confidence,
            "profit_probability": profit_prob,
            "loss_probability":   round(100.0 - profit_prob, 1),
        })
    except ValidationError as e:
        return jsonify(e.errors()), 400
    except Exception as exc:
        return jsonify({"detail": str(exc)}), 500

@app.route("/api/predict/regress", methods=["POST"])
def predict_regress():
    ensure_models_loaded()
    if MODEL_ERROR:
        return jsonify({"detail": f"ML models tidak dapat dimuat: {MODEL_ERROR}"}), 503
    try:
        payload = PredictInput(**request.json)

        df = build_input_df(payload, cols_reg)

        df_scaled    = df.copy()
        numeric_cols = _get_numeric_cols(scaler_reg)
        df_scaled[numeric_cols] = scaler_reg.transform(df[numeric_cols])

        profit_est = float(model_reg.predict(df_scaled)[0])

        if profit_est > 0:
            net_status = "PROFIT"
        elif profit_est == 0:
            net_status = "BREAK EVEN"
        else:
            net_status = "LOSS"

        return jsonify({
            "status":           "success",
            "estimated_profit": round(profit_est, 2),
            "is_profitable":    profit_est > 0,
            "is_break_even":    profit_est == 0,
            "net_status":       net_status,
        })
    except ValidationError as e:
        return jsonify(e.errors()), 400
    except Exception as exc:
        return jsonify({"detail": str(exc)}), 500


@app.route("/api/predict/combined", methods=["POST"])
def predict_combined():
    """Run both classification and regression in one request."""
    ensure_models_loaded()
    if MODEL_ERROR:
        return jsonify({"detail": f"ML models tidak dapat dimuat: {MODEL_ERROR}"}), 503
    try:
        payload = PredictInput(**request.json)

        # ── Classification ──
        df_clf = build_input_df(payload, cols_clf)
        df_clf_scaled = df_clf.copy()
        numeric_cols_clf = _get_numeric_cols(scaler_clf)
        df_clf_scaled[numeric_cols_clf] = scaler_clf.transform(df_clf[numeric_cols_clf])
        pred  = model_clf.predict(df_clf_scaled)[0]
        proba = model_clf.predict_proba(df_clf_scaled)[0]
        label        = "PROFIT" if pred == 1 else "LOSS"
        profit_prob  = round(float(proba[1]) * 100, 1) if len(proba) > 1 else round(float(max(proba)) * 100, 1)
        confidence   = round(float(max(proba)) * 100, 1)
        clf_result = {
            "prediction":         label,
            "is_profit":          bool(pred == 1),
            "confidence":         confidence,
            "profit_probability": profit_prob,
            "loss_probability":   round(100.0 - profit_prob, 1),
        }

        # ── Regression ──
        df_reg = build_input_df(payload, cols_reg)
        df_reg_scaled = df_reg.copy()
        numeric_cols_reg = _get_numeric_cols(scaler_reg)
        df_reg_scaled[numeric_cols_reg] = scaler_reg.transform(df_reg[numeric_cols_reg])
        profit_est = float(model_reg.predict(df_reg_scaled)[0])
        if profit_est > 0:
            net_status = "PROFIT"
        elif profit_est == 0:
            net_status = "BREAK EVEN"
        else:
            net_status = "LOSS"
        reg_result = {
            "estimated_profit": round(profit_est, 2),
            "is_profitable":    profit_est > 0,
            "is_break_even":    profit_est == 0,
            "net_status":       net_status,
        }

        return jsonify({
            "status":         "success",
            "classification": clf_result,
            "regression":     reg_result,
        })
    except ValidationError as e:
        return jsonify(e.errors()), 400
    except Exception as exc:
        return jsonify({"detail": str(exc)}), 500


@app.route("/api/dashboard-summary", methods=["GET"])
def dashboard_summary():
    # Combine all dashboard queries into a single response to avoid WSGI concurrent limits
    return jsonify({
        "kpi": kpi().get_json(),
        "revenue_by_year": revenue_by_year().get_json(),
        "sales_by_category": sales_by_category().get_json(),
        "profit_by_market": profit_by_market().get_json(),
        "top_subcategory": top_subcategory().get_json(),
        "orders_by_shipmode": orders_by_shipmode().get_json(),
        "segment_stats": segment_stats().get_json(),
        "region_stats": region_stats().get_json(),
        "quantity_stats": quantity_stats().get_json()
    })


# ─── Order Priority Triage Endpoint ──────────────────────────────────────────

# Mapping numeric class → human-readable priority label.
# Urutan sesuai LabelEncoder sklearn (alfabetis): Critical=0, High=1, Low=2, Medium=3
_PRIORITY_LABELS = {
    0: "Critical",
    1: "High",
    2: "Low",
    3: "Medium",
}

_PRIORITY_META = {
    "Critical": {
        "message": "Pesanan ini KRITIS — butuh penanganan segera / VIP!",
        "urgency": "critical",
    },
    "High": {
        "message": "Prioritas TINGGI — proses lebih cepat dari standar.",
        "urgency": "high",
    },
    "Medium": {
        "message": "Prioritas SEDANG — tangani sesuai alur operasional biasa.",
        "urgency": "medium",
    },
    "Low": {
        "message": "Prioritas RENDAH — tidak mendesak, bisa dijadwalkan.",
        "urgency": "low",
    },
}


@app.route("/api/predict/priority", methods=["POST"])
@app.route("/predict-priority", methods=["POST"])
def predict_priority():
    """Order Priority Triage (klasifiksai 2) — predicts Urgent / Normal.

    Model adalah binary classifier (kelas 0=Normal, kelas 1=Urgent).
    PRD output: { status_code, prediction, priority_label, message }
    """
    ensure_models_loaded()
    if MODEL_ERROR:
        return jsonify({"detail": f"ML models tidak dapat dimuat: {MODEL_ERROR}"}), 503
    try:
        payload = PriorityInput(**request.json)

        df = build_priority_df(payload, cols_pri)

        df_scaled      = df.copy()
        numeric_cols   = _get_numeric_cols(scaler_pri)
        valid_num_cols = [c for c in numeric_cols if c in df_scaled.columns]
        if valid_num_cols:
            df_scaled[valid_num_cols] = scaler_pri.transform(df[valid_num_cols])

        pred  = model_pri.predict(df_scaled)[0]
        proba = model_pri.predict_proba(df_scaled)[0]

        pred_int   = int(pred)
        confidence = round(float(max(proba)) * 100, 1)

        if len(proba) == 2:
            # ── Binary classifier: kelas 0 = Normal, kelas 1 = Urgent ──
            is_urgent   = bool(pred_int == 1)
            urgent_prob = round(float(proba[1]) * 100, 1)
            normal_prob = round(float(proba[0]) * 100, 1)
            priority_label = "Urgent" if is_urgent else "Normal"
            urgency = "urgent" if is_urgent else "normal"
            message = (
                "Pesanan ini berisiko tinggi / butuh penanganan segera!"
                if is_urgent else
                "Pesanan reguler — penanganan standar operasional."
            )
            # class_probs: hanya dua kelas biner yang valid
            class_probs = {
                "Urgent": urgent_prob,
                "Normal": normal_prob,
            }
            # Untuk kompatibilitas bar 4-kelas di frontend:
            # Urgent → dibagi ke Critical (40%) + High (60%) secara proporsional
            # Normal → dibagi ke Medium (40%) + Low (60%) secara proporsional
            if is_urgent:
                class_probs["Critical"] = round(urgent_prob * 0.4, 1)
                class_probs["High"]     = round(urgent_prob * 0.6, 1)
                class_probs["Medium"]   = round(normal_prob * 0.6, 1)
                class_probs["Low"]      = round(normal_prob * 0.4, 1)
            else:
                class_probs["Critical"] = round(urgent_prob * 0.4, 1)
                class_probs["High"]     = round(urgent_prob * 0.6, 1)
                class_probs["Medium"]   = round(normal_prob * 0.6, 1)
                class_probs["Low"]      = round(normal_prob * 0.4, 1)

            # Hitung priority_score 0-100 (semakin tinggi = semakin urgent)
            priority_score = urgent_prob

        else:
            # ── Multi-class classifier: Critical=0, High=1, Low=2, Medium=3 ──
            priority_label = _PRIORITY_LABELS.get(pred_int, f"Class {pred_int}")
            meta           = _PRIORITY_META.get(priority_label, {"message": "", "urgency": "medium"})
            urgency        = meta["urgency"]
            message        = meta["message"]
            class_probs    = {
                _PRIORITY_LABELS.get(i, f"Class {i}"): round(float(p) * 100, 1)
                for i, p in enumerate(proba)
            }
            is_urgent = urgency in ("critical", "high")
            urgent_prob = round(sum(
                float(proba[i]) for i, lbl in _PRIORITY_LABELS.items()
                if lbl in ("Critical", "High") and i < len(proba)
            ) * 100, 1)
            normal_prob = round(100.0 - urgent_prob, 1)
            priority_score = urgent_prob
            class_probs["Urgent"] = urgent_prob
            class_probs["Normal"] = normal_prob

        return jsonify({
            "status":             "success",
            "status_code":        200,
            "prediction":         pred_int,
            "is_urgent":          is_urgent,
            "priority_label":     priority_label,
            "urgency":            urgency,
            "message":            message,
            "confidence":         confidence,
            "urgent_probability": urgent_prob,
            "normal_probability": normal_prob,
            "priority_score":     priority_score,
            "class_probs":        class_probs,
            "debug": {
                "raw_pred":     pred_int,
                "raw_proba":    [round(float(p) * 100, 1) for p in proba],
                "n_classes":    len(proba),
                "features_used": {
                    "sales":               float(df['sales'].iloc[0]),
                    "discount":            round(float(df['discount'].iloc[0]) * 100, 2),
                    "quantity":            int(df['quantity'].iloc[0]),
                    "shipping_cost":       float(df['shipping_cost'].iloc[0]),
                    "shipping_cost_ratio": round(float(df['shipping_cost_ratio'].iloc[0]), 4),
                    "discount_impact":     round(float(df['discount_impact'].iloc[0]), 2),
                    "total_cost_spent":    round(float(df['total_cost_spent'].iloc[0]), 2),
                }
            },
        })
    except ValidationError as e:
        return jsonify(e.errors()), 400
    except Exception as exc:
        return jsonify({"detail": str(exc)}), 500


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
