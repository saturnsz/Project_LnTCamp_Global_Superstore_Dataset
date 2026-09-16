# Streamlit Admin Dashboard — Transaction Detector

## Overview

Membangun **Admin Dashboard Streamlit** yang di-deploy ke **Streamlit Cloud** (share.streamlit.io) dengan dua fitur utama:
1. **📊 Data Visualisasi** — Analytics interaktif dari database SQLite superstore
2. **🤖 AI Predictor** — Dua model ML: XGBoost Classifier (Detektor Status) + XGBoost Regressor (Kalkulator Profit)

Stack: **Streamlit** (Python), Plotly untuk chart, Pandas untuk data, Pickle untuk load model.

---

## Struktur Project (Streamlit-Deployable)

```
d:/kuliah/LnTCamp 2026/
├── streamlit_app/
│   ├── app.py                    # [MAIN] Entry point Streamlit
│   ├── requirements.txt          # Dependencies untuk Streamlit Cloud
│   ├── .streamlit/
│   │   └── config.toml           # Streamlit theme config
│   ├── pages/
│   │   ├── 1_📊_Dashboard.py     # Halaman visualisasi data
│   │   ├── 2_🤖_AI_Predictor.py  # Halaman AI prediction
│   │   └── 3_📋_Data_Explorer.py # Halaman tabel data
│   ├── utils/
│   │   ├── db.py                 # SQLite query helper
│   │   └── model.py              # Load & predict helper
│   ├── model_klasifikasi/        # Copy model clf files
│   │   ├── xgboost_clf_model.pkl
│   │   ├── scaler_clf.pkl
│   │   └── training_columns_clf.pkl
│   ├── model_regresi/            # Copy model reg files
│   │   ├── xgboost_reg_model.pkl
│   │   ├── scaler_reg.pkl
│   │   └── training_columns_reg.pkl
│   └── superstore.sqlite         # SQLite database (copy)
```

---

## Halaman & Fitur

### 🏠 app.py (Home / Landing)
- Sidebar dengan navigation branding "StoreIQ Admin"
- KPI cards: Total Revenue, Total Orders, Total Profit, Avg Discount
- Welcome section dengan quick stats

### 📊 Dashboard (Visualisasi Data)
Charts dengan Plotly (interaktif):
1. **Revenue by Year** — Bar chart
2. **Sales by Category** — Donut/Pie chart  
3. **Profit by Market** — Horizontal bar
4. **Top 10 Sub-Categories** — Bar chart
5. **Orders by Ship Mode** — Pie chart
6. **Monthly Sales Trend** — Line chart
7. **Profit vs Discount Scatter** — Scatter plot
8. **Profit Distribution** — Histogram

### 🤖 AI Predictor (Dua Mode)
**Tab 1: 🔍 Detektor Status (Klasifikasi)**
- Form 11 parameter input (PRD spec)
- Feature engineering otomatis
- Output: Badge UNTUNG ✅ / RUGI 🚨 + probabilitas
- Penjelasan keputusan

**Tab 2: 📈 Kalkulator Profit (Regresi)**
- Form 11 parameter sama
- Output: Estimasi USD nominal
- What-If Analysis: Slider diskon range untuk temukan titik optimal
- Chart: Profit projection vs discount curve

**Hybrid Mode** (bonus):
- Saat user submit, keduanya jalan bersamaan
- Tampilkan hasil klasifikasi + estimasi nominal sekaligus

### 📋 Data Explorer
- Tabel Order Items + filter interaktif
- Tabel Customers, Products, Locations
- Pagination built-in Streamlit dataframe

---

## Design System (Dark Theme Premium)

```toml
# .streamlit/config.toml
[theme]
primaryColor = "#4f8ef7"
backgroundColor = "#0f0f14"
secondaryBackgroundColor = "#1a1a24"
textColor = "#e2e8f0"
font = "sans serif"
```

Custom CSS injected via `st.markdown()`:
- Glassmorphism cards
- Gradient accents (blue → purple)
- Metric cards dengan border glow
- Animated hover effects
- Custom sidebar styling

---

## Technical Details

### Database Queries (utils/db.py)
- KPI: SUM sales, profit, COUNT orders, AVG discount dari order_items JOIN orders
- Charts: GROUP BY year, category, market, ship_mode, sub_category
- Tables: JOIN semua dimension tables

### Model Loading (utils/model.py)
Klasifikasi:
```python
clf_model = pickle.load("model_klasifikasi/xgboost_clf_model.pkl")
scaler_clf = pickle.load("model_klasifikasi/scaler_clf.pkl")
cols_clf = pickle.load("model_klasifikasi/training_columns_clf.pkl")
```

Feature Engineering (sesuai PRD):
```python
discount = Diskon_Persen / 100.0
shipping_cost_ratio = Biaya_Kirim_USD / Sales_USD
discount_impact = discount * Sales_USD
total_cost_spent = Sales_USD + Biaya_Kirim_USD
```

One-Hot Encoding + reindex ke training columns + scale → predict.

---

## Dependencies (requirements.txt)

```
streamlit>=1.32.0
pandas>=2.0.0
plotly>=5.18.0
scikit-learn>=1.4.0
xgboost>=2.0.0
numpy>=1.26.0
```

---

## Verification Plan

1. Run locally: `streamlit run streamlit_app/app.py`
2. Test semua chart muncul dengan data
3. Test kedua form AI (klasifikasi & regresi)
4. Test What-If Analysis slider
5. Verifikasi dark theme tampil dengan benar
6. Push ke GitHub → deploy ke share.streamlit.io
