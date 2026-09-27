import requests

url = "https://adwyaalk.pythonanywhere.com/api/predict/classify"
payload = {
  "sales": 100,
  "discount": 10,
  "quantity": 2,
  "shipping_cost": 5,
  "category": "Furniture",
  "sub_category": "Bookcases",
  "segment": "Consumer",
  "market": "US",
  "ship_mode": "Standard Class",
  "order_priority": "Medium",
  "region": "West"
}

try:
    response = requests.post(url, json=payload)
    print("Status Code:", response.status_code)
    print("Response JSON:", response.json())
except Exception as e:
    print("Error:", e)
