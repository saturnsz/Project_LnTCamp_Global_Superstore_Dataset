import os
import sqlite3
import joblib
import asyncio
import numpy as np
import pandas as pd
from contextlib import asynccontextmanager
from functools import partial

from fastapi import FastAPI, Query, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel, Field

# ─── Paths ───────────────────────────────────────────────────────────────────

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH  = os.path.join(BASE_DIR, 'superstore (1).sqlite')

# ─── ML Model State ──────────────────────────────────────────────────────────

scaler_clf = cols_clf = model_clf = None
scaler_reg = cols_reg = model_reg = None
MODEL_ERROR: str | None = None


def _load_model(folder: str, scaler_file: str, cols_file: str, model_file: str):
    """Load scaler, column list, and XGBoost model from disk."""
    scaler = joblib.load(os.path.join(BASE_DIR, folder, scaler_file))
    cols   = joblib.load(os.path.join(BASE_DIR, folder, cols_file))
    model  = joblib.load(os.path.join(BASE_DIR, folder, model_file))
    return scaler, cols, model


# ─── Lifespan (startup / shutdown) ───────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Load ML models once at startup."""
    global scaler_clf, cols_clf, model_clf
    global scaler_reg, cols_reg, model_reg
    global MODEL_ERROR

    try:
        scaler_clf, cols_clf, model_clf = _load_model(
            'model_klasifikasi',
            'scaler_clf.pkl', 'training_columns_clf.pkl', 'xgboost_clf_model.pkl',
        )
        scaler_reg, cols_reg, model_reg = _load_model(
            'model_regresi',
            'scaler_reg.pkl', 'training_columns_reg.pkl', 'xgboost_reg_model.pkl',
        )
        print("[OK] ML models loaded successfully")
    except Exception as exc:
        MODEL_ERROR = str(exc)
        print(f"[WARN] Could not load ML models: {exc}")
        print("   Dashboard data features will still work.")
        print("   To fix: install a compatible xgboost version.")

    yield  # ← app is running

    # Shutdown: nothing special needed
    print("[INFO] Shutting down StoreIQ Admin")


# ─── App Instance ─────────────────────────────────────────────────────────────

app = FastAPI(
    title="StoreIQ Admin API",
    description="Global Superstore analytics & XGBoost AI predictor",
    version="2.0.0",
    lifespan=lifespan,
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Static files & templates
app.mount("/static", StaticFiles(directory=os.path.join(BASE_DIR, "static")), name="static")
templates = Jinja2Templates(directory=os.path.join(BASE_DIR, "templates"))

# ─── DB Helpers ──────────────────────────────────────────────────────────────

def _get_db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def _sync_query(sql: str, params: tuple = ()) -> list[dict]:
    """Run a SELECT that returns multiple rows (sync, called via executor)."""
    conn = _get_db()
    cur  = conn.cursor()
    cur.execute(sql, params)
    rows = [dict(r) for r in cur.fetchall()]
    conn.close()
    return rows


def _sync_query_one(sql: str, params: tuple = ()) -> dict:
    """Run a SELECT that returns a single row (sync, called via executor)."""
    conn = _get_db()
    cur  = conn.cursor()
    cur.execute(sql, params)
    row = cur.fetchone()
    conn.close()
    return dict(row) if row else {}


async def query(sql: str, params: tuple = ()) -> list[dict]:
    """Async wrapper — runs the blocking DB call in a thread-pool executor."""
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, partial(_sync_query, sql, params))


async def query_one(sql: str, params: tuple = ()) -> dict:
    """Async wrapper for single-row queries."""
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, partial(_sync_query_one, sql, params))


# ─── Pydantic Request Schemas ─────────────────────────────────────────────────

class PredictInput(BaseModel):
    sales:          float = Field(..., gt=0,  description="Nilai penjualan dalam USD")
    discount:       float = Field(..., ge=0, le=100, description="Diskon dalam persen (0–100)")
    quantity:       int   = Field(..., ge=1,  description="Jumlah unit")
    shipping_cost:  float = Field(..., ge=0,  description="Biaya pengiriman dalam USD")
    category:       str   = Field(...,        description="Furniture | Office Supplies | Technology")
    sub_category:   str   = Field(...,        description="Sub-kategori produk")
    segment:        str   = Field(...,        description="Consumer | Corporate | Home Office")
    market:         str   = Field(...,        description="US | EU | APAC | LATAM | EMEA | Africa | Canada")
    ship_mode:      str   = Field(...,        description="Standard Class | Second Class | First Class | Same Day")
    order_priority: str   = Field(...,        description="Low | Medium | High | Critical")
    region:         str   = Field(...,        description="West | East | Central | South | …")


# ─── Feature Engineering ──────────────────────────────────────────────────────

def build_input_df(data: PredictInput, training_cols: list[str]) -> pd.DataFrame:
    """Build feature DataFrame matching training columns from validated input."""
    sales         = data.sales
    discount      = data.discount / 100.0      # persen → desimal
    quantity      = data.quantity
    shipping_cost = data.shipping_cost

    shipping_cost_ratio = shipping_cost / sales if sales > 0 else 0.0
    discount_impact     = sales * discount
    total_cost_spent    = shipping_cost + discount_impact

    row: dict = {
        'sales':               sales,
        'discount':            discount,
        'quantity':            quantity,
        'shipping_cost':       shipping_cost,
        'shipping_cost_ratio': shipping_cost_ratio,
        'discount_impact':     discount_impact,
        'total_cost_spent':    total_cost_spent,
    }

    # Pre-fill all one-hot columns with 0
    for col in training_cols:
        if col not in row:
            row[col] = 0

    # One-hot encoding — flip the matching column to 1
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
    """Return the numeric feature names the scaler was fitted on."""
    if hasattr(scaler, 'feature_names_in_'):
        return list(scaler.feature_names_in_)
    return ['sales', 'discount', 'quantity', 'shipping_cost',
            'shipping_cost_ratio', 'discount_impact', 'total_cost_spent']


# ─── Frontend Route ───────────────────────────────────────────────────────────

@app.get("/", response_class=HTMLResponse, include_in_schema=False)
async def index(request: Request):
    return templates.TemplateResponse(request=request, name="index.html")


# ─── KPI Endpoint ─────────────────────────────────────────────────────────────

@app.get("/api/kpi", summary="Dashboard KPI summary")
async def kpi():
    data = await query_one("""
        SELECT
            ROUND(SUM(oi.sales), 2)         AS total_revenue,
            ROUND(SUM(oi.profit), 2)        AS total_profit,
            COUNT(DISTINCT o.order_id_raw)  AS total_orders,
            COUNT(DISTINCT o.customer_id)   AS total_customers,
            ROUND(AVG(oi.discount)*100, 1)  AS avg_discount_pct,
            ROUND(SUM(oi.shipping_cost), 2) AS total_shipping_cost,
            COUNT(oi.row_id)                AS total_items,
            ROUND(AVG(oi.quantity), 1)      AS avg_quantity
        FROM order_items oi
        JOIN orders o ON oi.order_key = o.order_key
    """)
    return data


# ─── Chart Endpoints ──────────────────────────────────────────────────────────

@app.get("/api/revenue-by-year", summary="Annual revenue & profit trend")
async def revenue_by_year():
    return await query("""
        SELECT oi.year,
               ROUND(SUM(oi.sales),2)  AS revenue,
               ROUND(SUM(oi.profit),2) AS profit
        FROM order_items oi
        GROUP BY oi.year
        ORDER BY oi.year
    """)


@app.get("/api/sales-by-category", summary="Sales breakdown by product category")
async def sales_by_category():
    return await query("""
        SELECT p.category,
               ROUND(SUM(oi.sales),2)  AS sales,
               ROUND(SUM(oi.profit),2) AS profit
        FROM order_items oi
        JOIN dim_products p ON oi.product_id = p.product_id
        GROUP BY p.category
        ORDER BY sales DESC
    """)


@app.get("/api/profit-by-market", summary="Profit per global market")
async def profit_by_market():
    return await query("""
        SELECT l.market,
               ROUND(SUM(oi.sales),2)  AS sales,
               ROUND(SUM(oi.profit),2) AS profit
        FROM order_items oi
        JOIN orders o ON oi.order_key = o.order_key
        JOIN dim_locations l ON o.location_id = l.location_id
        GROUP BY l.market
        ORDER BY profit DESC
    """)


@app.get("/api/top-subcategory", summary="Top 10 sub-categories by revenue")
async def top_subcategory():
    return await query("""
        SELECT p.sub_category,
               ROUND(SUM(oi.sales),2)  AS sales,
               ROUND(SUM(oi.profit),2) AS profit
        FROM order_items oi
        JOIN dim_products p ON oi.product_id = p.product_id
        GROUP BY p.sub_category
        ORDER BY sales DESC
        LIMIT 10
    """)


@app.get("/api/orders-by-shipmode", summary="Orders count by shipping method")
async def orders_by_shipmode():
    return await query("""
        SELECT o.ship_mode,
               COUNT(DISTINCT o.order_key) AS order_count,
               ROUND(SUM(oi.sales),2)      AS total_sales
        FROM orders o
        JOIN order_items oi ON o.order_key = oi.order_key
        GROUP BY o.ship_mode
        ORDER BY order_count DESC
    """)


@app.get("/api/monthly-trend", summary="Weekly sales & profit trend")
async def monthly_trend():
    return await query("""
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


@app.get("/api/profit-margin-trend", summary="Yearly profit margin trend")
async def profit_margin_trend():
    return await query("""
        SELECT oi.year,
               ROUND(SUM(oi.sales),2)   AS sales,
               ROUND(SUM(oi.profit),2)  AS profit,
               ROUND(SUM(oi.profit)/SUM(oi.sales)*100, 2) AS margin_pct
        FROM order_items oi
        GROUP BY oi.year
        ORDER BY oi.year
    """)


@app.get("/api/segment-stats", summary="Revenue & customers by segment")
async def segment_stats():
    return await query("""
        SELECT c.segment,
               COUNT(DISTINCT c.customer_id) AS customers,
               COUNT(DISTINCT o.order_key)   AS orders,
               ROUND(SUM(oi.sales),2)         AS sales,
               ROUND(SUM(oi.profit),2)        AS profit
        FROM dim_customers c
        JOIN orders o ON c.customer_id = o.customer_id
        JOIN order_items oi ON o.order_key = oi.order_key
        GROUP BY c.segment
        ORDER BY sales DESC
    """)


@app.get("/api/region-stats", summary="Sales & profit by region")
async def region_stats():
    return await query("""
        SELECT l.region,
               ROUND(SUM(oi.sales),2)  AS sales,
               ROUND(SUM(oi.profit),2) AS profit,
               COUNT(DISTINCT o.order_key) AS orders
        FROM order_items oi
        JOIN orders o ON oi.order_key = o.order_key
        JOIN dim_locations l ON o.location_id = l.location_id
        GROUP BY l.region
        ORDER BY sales DESC
    """)


# ─── Table Endpoints ──────────────────────────────────────────────────────────

@app.get("/api/orders", summary="Paginated order list with search")
async def orders(
    page:  int = Query(1,  ge=1),
    limit: int = Query(20, ge=1, le=200),
    q:     str = Query(""),
):
    q = q.strip()
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

    total = (await query_one(f"SELECT COUNT(*) AS cnt {base_sql}", params_f))["cnt"]
    rows  = await query(f"""
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

    return {"total": total, "page": page, "limit": limit, "data": rows}


@app.get("/api/products", summary="Paginated product list with search")
async def products(
    page:  int = Query(1,  ge=1),
    limit: int = Query(20, ge=1, le=200),
    q:     str = Query(""),
):
    q = q.strip()
    offset = (page - 1) * limit

    if q:
        like   = f"%{q}%"
        where  = "WHERE p.product_name LIKE ? OR p.category LIKE ? OR p.sub_category LIKE ?"
        params = (like,) * 3
    else:
        where, params = "", ()

    total = (await query_one(f"SELECT COUNT(*) AS cnt FROM dim_products p {where}", params))["cnt"]
    rows  = await query(f"""
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

    return {"total": total, "page": page, "limit": limit, "data": rows}


@app.get("/api/customers", summary="Paginated customer list with search")
async def customers(
    page:  int = Query(1,  ge=1),
    limit: int = Query(20, ge=1, le=200),
    q:     str = Query(""),
):
    q = q.strip()
    offset = (page - 1) * limit

    if q:
        like   = f"%{q}%"
        where  = "WHERE c.customer_name LIKE ? OR c.segment LIKE ?"
        params = (like,) * 2
    else:
        where, params = "", ()

    total = (await query_one(
        f"SELECT COUNT(DISTINCT c.customer_id) AS cnt FROM dim_customers c {where}", params
    ))["cnt"]
    rows = await query(f"""
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

    return {"total": total, "page": page, "limit": limit, "data": rows}


@app.get("/api/locations", summary="Paginated location list with search")
async def locations(
    page:  int = Query(1,  ge=1),
    limit: int = Query(20, ge=1, le=200),
    q:     str = Query(""),
):
    q = q.strip()
    offset = (page - 1) * limit

    if q:
        like   = f"%{q}%"
        where  = "WHERE l.city LIKE ? OR l.country LIKE ? OR l.region LIKE ? OR l.market LIKE ?"
        params = (like,) * 4
    else:
        where, params = "", ()

    total = (await query_one(f"SELECT COUNT(*) AS cnt FROM dim_locations l {where}", params))["cnt"]
    rows  = await query(f"""
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

    return {"total": total, "page": page, "limit": limit, "data": rows}


# ─── AI Prediction Endpoints ──────────────────────────────────────────────────

@app.post("/api/predict/classify", summary="Klasifikasi PROFIT / LOSS (XGBoost)")
async def predict_classify(payload: PredictInput):
    if MODEL_ERROR:
        raise HTTPException(
            status_code=503,
            detail=f"ML models tidak dapat dimuat: {MODEL_ERROR}",
        )
    try:
        loop = asyncio.get_running_loop()

        # Build feature matrix in executor so we don't block the event loop
        df = await loop.run_in_executor(
            None, partial(build_input_df, payload, cols_clf)
        )

        # Scale numeric features
        df_scaled    = df.copy()
        numeric_cols = _get_numeric_cols(scaler_clf)
        df_scaled[numeric_cols] = scaler_clf.transform(df[numeric_cols])

        # Predict (run in executor — CPU-bound)
        pred  = await loop.run_in_executor(None, lambda: model_clf.predict(df_scaled)[0])
        proba = await loop.run_in_executor(None, lambda: model_clf.predict_proba(df_scaled)[0])

        label        = "PROFIT" if pred == 1 else "LOSS"
        profit_prob  = round(float(proba[1]) * 100, 1) if len(proba) > 1 else round(float(max(proba)) * 100, 1)
        confidence   = round(float(max(proba)) * 100, 1)

        return {
            "status":             "success",
            "prediction":         label,
            "is_profit":          bool(pred == 1),
            "confidence":         confidence,
            "profit_probability": profit_prob,
            "loss_probability":   round(100.0 - profit_prob, 1),
        }

    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/api/predict/regress", summary="Estimasi nominal profit (XGBoost Regressor)")
async def predict_regress(payload: PredictInput):
    if MODEL_ERROR:
        raise HTTPException(
            status_code=503,
            detail=f"ML models tidak dapat dimuat: {MODEL_ERROR}",
        )
    try:
        loop = asyncio.get_running_loop()

        df = await loop.run_in_executor(
            None, partial(build_input_df, payload, cols_reg)
        )

        df_scaled    = df.copy()
        numeric_cols = _get_numeric_cols(scaler_reg)
        df_scaled[numeric_cols] = scaler_reg.transform(df[numeric_cols])

        profit_est = await loop.run_in_executor(
            None, lambda: float(model_reg.predict(df_scaled)[0])
        )

        return {
            "status":           "success",
            "estimated_profit": round(profit_est, 2),
            "is_profitable":    profit_est > 0,
        }

    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


# ─── Entry Point ──────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    print("[START] StoreIQ Admin — FastAPI")
    print("[INFO] Open http://localhost:5000")
    print("[INFO] API Docs: http://localhost:5000/docs")
    uvicorn.run("app:app", host="0.0.0.0", port=5000, reload=True)

