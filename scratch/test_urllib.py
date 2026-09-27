import urllib.request
import json
import time

url = "https://adwyaalk.pythonanywhere.com/api/predict/classify"
data = json.dumps({"sales": 100, "discount": 10, "quantity": 2, "shipping_cost": 5, "category": "Furniture", "sub_category": "Bookcases", "segment": "Consumer", "market": "US", "ship_mode": "Standard Class", "order_priority": "Medium", "region": "West"}).encode("utf-8")

req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"}, method="POST")

print("Sending request...")
start = time.time()
try:
    with urllib.request.urlopen(req, timeout=10) as response:
        print("Status:", response.status)
        print("Body:", response.read().decode("utf-8"))
except Exception as e:
    print("Error:", e)
print("Time taken:", time.time() - start)
