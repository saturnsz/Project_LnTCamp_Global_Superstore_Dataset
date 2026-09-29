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

scaler_clf = cols_clf = model_clf = None
scaler_reg = cols_reg = model_reg = None
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
    global MODEL_ERROR, _models_loaded

    if _models_loaded or MODEL_ERROR:
        return

    try:
        # Set OMP_NUM_THREADS to 1 to prevent xgboost from hanging in WSGI workers
        os.environ['OMP_NUM_THREADS'] = '1'
        
        scaler_clf, cols_clf, model_clf = _load_model(
            'model_klasifikasi',
            'scaler_clf.pkl', 'training_columns_clf.pkl', 'xgboost_clf_model.pkl',
        )
        scaler_reg, cols_reg, model_reg = _load_model(
            'model_regresi',
            'scaler_reg.pkl', 'training_columns_reg.pkl', 'xgboost_reg_model.pkl',
        )
        
        # Configure model to use single thread to avoid OpenMP deadlock
        if hasattr(model_clf, 'set_params'):
            model_clf.set_params(n_jobs=1)
        if hasattr(model_reg, 'set_params'):
            model_reg.set_params(n_jobs=1)
            
        print("[OK] ML models loaded successfully")
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
            ROUND(SUM(oi.quantity), 0)      AS total_quantity
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
    data = query("""
        SELECT o.ship_mode,
               COUNT(DISTINCT o.order_key) AS order_count,
               ROUND(SUM(oi.sales),2)      AS total_sales
        FROM orders o
        JOIN order_items oi ON o.order_key = oi.order_key
        GROUP BY o.ship_mode
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

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
