import os, shutil, sqlite3
import pandas as pd
import numpy as np
import joblib
from sklearn.preprocessing import StandardScaler
from xgboost import XGBClassifier
from sklearn.metrics import classification_report, accuracy_score

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KLASIFIKASI_DIR = os.path.join(BASE, 'backend', 'klasifiksai 2')
DB_PATH = os.path.join(BASE, 'backend', 'superstore (1).sqlite')

print("1. Loading dataset...")
conn = sqlite3.connect(DB_PATH)
df = pd.read_sql('''
SELECT oi.sales, oi.discount, oi.quantity, oi.shipping_cost,
       o.ship_mode, c.segment, l.market, l.region, p.category, p.sub_category,
       o.order_priority
FROM order_items oi
JOIN orders o ON oi.order_key = o.order_key
JOIN dim_customers c ON o.customer_id = c.customer_id
JOIN dim_locations l ON o.location_id = l.location_id
JOIN dim_products p ON oi.product_id = p.product_id
''', conn)
conn.close()

# Binary classification: 1 = Urgent (Critical & High), 0 = Normal (Medium & Low)
y = df['order_priority'].isin(['Critical', 'High']).astype(int).values
print("Class counts (0=Normal, 1=Urgent):")
print(pd.Series(y).value_counts())

df['shipping_cost_ratio'] = df['shipping_cost'] / df['sales'].replace(0, np.nan)
df['shipping_cost_ratio'] = df['shipping_cost_ratio'].fillna(0)
df['discount_impact'] = df['discount'] * df['sales']
df['total_cost_spent'] = df['sales'] + df['shipping_cost']

num_cols = ['sales', 'discount', 'quantity', 'shipping_cost', 'shipping_cost_ratio', 'discount_impact', 'total_cost_spent']

cols_path = os.path.join(KLASIFIKASI_DIR, 'training_columns_clf (1).pkl')
cols_existing = joblib.load(cols_path)

X = pd.DataFrame(0.0, index=df.index, columns=cols_existing)
for col in num_cols:
    X[col] = df[col].astype(float)

for sm in df['ship_mode'].unique():
    c = f'ship_mode_{sm}'
    if c in cols_existing:
        X.loc[df['ship_mode'] == sm, c] = 1.0

for seg in df['segment'].unique():
    c = f'segment_{seg}'
    if c in cols_existing:
        X.loc[df['segment'] == seg, c] = 1.0

for m in df['market'].unique():
    c = f'market_{m}'
    if c in cols_existing:
        X.loc[df['market'] == m, c] = 1.0

for r in df['region'].unique():
    c = f'region_{r}'
    if c in cols_existing:
        X.loc[df['region'] == r, c] = 1.0

for cat in df['category'].unique():
    c = f'category_{cat}'
    if c in cols_existing:
        X.loc[df['category'] == cat, c] = 1.0

for sc in df['sub_category'].unique():
    c = f'sub_category_{sc}'
    if c in cols_existing:
        X.loc[df['sub_category'] == sc, c] = 1.0

scaler = StandardScaler()
X_scaled = X.copy()
X_scaled[num_cols] = scaler.fit_transform(X[num_cols])

print("2. Training XGBoost Binary Classifier (Normal vs Urgent)...")
xgb = XGBClassifier(
    n_estimators=120,
    max_depth=5,
    learning_rate=0.08,
    subsample=0.85,
    colsample_bytree=0.85,
    random_state=42,
    n_jobs=2,
    eval_metric='logloss'
)
xgb.fit(X_scaled, y)

y_pred = xgb.predict(X_scaled)
print("Classification report:")
print(classification_report(y, y_pred, target_names=['Normal (0)', 'Urgent (1)']))

joblib.dump(scaler, os.path.join(KLASIFIKASI_DIR, 'scaler_clf (1).pkl'))
joblib.dump(cols_existing, os.path.join(KLASIFIKASI_DIR, 'training_columns_clf (1).pkl'))
joblib.dump(xgb, os.path.join(KLASIFIKASI_DIR, 'xgboost_clf_model (1).pkl'))
print("3. Successfully saved 2-class model artifacts!")
