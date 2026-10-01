import sqlite3, joblib, os
import pandas as pd
import numpy as np

conn = sqlite3.connect('backend/superstore (1).sqlite')
df_raw = pd.read_sql('''
SELECT oi.sales, oi.discount, oi.quantity, oi.shipping_cost,
       o.ship_mode, c.segment, l.market, l.region, p.category, p.sub_category,
       o.order_priority
FROM order_items oi
JOIN orders o ON oi.order_key = o.order_key
JOIN dim_customers c ON o.customer_id = c.customer_id
JOIN dim_locations l ON o.location_id = l.location_id
JOIN dim_products p ON oi.product_id = p.product_id
LIMIT 500
''', conn)

scaler = joblib.load('backend/klasifiksai 2/scaler_clf (1).pkl')
cols = joblib.load('backend/klasifiksai 2/training_columns_clf (1).pkl')
model = joblib.load('backend/klasifiksai 2/xgboost_clf_model (1).pkl')
model.set_params(n_jobs=1)

numeric_cols = list(scaler.feature_names_in_)
print('numeric_cols:', numeric_cols)
print('scaler mean:', scaler.mean_)
print('scaler var / scale:', scaler.scale_)

predictions = []
probas = []
for idx, row in df_raw.iterrows():
    sales = row['sales']
    discount = row['discount']
    quantity = row['quantity']
    shipping_cost = row['shipping_cost']
    
    shipping_cost_ratio = shipping_cost / sales if sales > 0 else 0.0
    discount_impact = discount * sales
    total_cost_spent = sales + shipping_cost
    
    r = {
        'sales': sales,
        'discount': discount,
        'quantity': quantity,
        'shipping_cost': shipping_cost,
        'shipping_cost_ratio': shipping_cost_ratio,
        'discount_impact': discount_impact,
        'total_cost_spent': total_cost_spent,
    }
    for c in cols:
        if c not in r:
            r[c] = 0
    _ohe = {
        f"ship_mode_{row['ship_mode']}": 1,
        f"segment_{row['segment']}": 1,
        f"market_{row['market']}": 1,
        f"region_{row['region']}": 1,
        f"category_{row['category']}": 1,
        f"sub_category_{row['sub_category']}": 1,
    }
    for k, v in _ohe.items():
        if k in r:
            r[k] = v
    df_single = pd.DataFrame([r])[cols]
    df_single_scaled = df_single.copy()
    df_single_scaled[numeric_cols] = scaler.transform(df_single[numeric_cols])
    p = model.predict(df_single_scaled)[0]
    prob = model.predict_proba(df_single_scaled)[0]
    predictions.append(p)
    probas.append(prob)

df_raw['pred'] = predictions
df_raw['prob_0'] = [p[0] for p in probas]
df_raw['prob_1'] = [p[1] for p in probas]

print('Pred value counts on 500 real DB samples:')
print(df_raw['pred'].value_counts())
print('\nCross-tab with true order_priority:')
print(pd.crosstab(df_raw['order_priority'], df_raw['pred']))
print('\nAverage prob_1 by true order_priority:')
print(df_raw.groupby('order_priority')[['prob_0', 'prob_1']].mean())
