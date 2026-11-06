import httpx

url = "https://macdn.aoneroom.com/other/2026/10/10/80da52722ee7de7a4303290af6783424.mp4"
headers = {
    "User-Agent": "com.community.mbox.in/50020130 (Linux; U; Android 14; en_IN; Pixel 8; Build/UD1A.230803.041; Cronet/145.0.7582.0)",
    "Referer": "https://api3.aoneroom.com/"
}

try:
    response = httpx.get(url, headers=headers, follow_redirects=True)
    print("Status Code:", response.status_code)
    if response.status_code == 200:
        print("✅ Link bilkul chal raha hai! Video play ho jayegi.")
    else:
        print("❌ Link kaam nahi kar raha.")
except Exception as e:
    print("Error aaya:", e)