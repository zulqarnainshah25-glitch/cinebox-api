from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
import httpx

app = FastAPI(title="CineBox API")

# CORS settings taake aapki React app isay access kar sake
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# MovieBox ke custom headers
MOVIEBOX_HEADERS = {
    "User-Agent": "com.community.mbox.in/50020130 (Linux; U; Android 14; en_IN; Pixel 8; Build/UD1A.230803.041; Cronet/145.0.7582.0)",
    "Referer": "https://api3.aoneroom.com/",
    "Accept": "application/json"
}

@app.get("/")
def read_root():
    return {"status": "success", "message": "CineBox API is running!"}

# 1. Search Endpoint
@app.get("/api/search")
async def search_movie(q: str = Query(..., description="Movie name to search")):
    try:
        url = f"https://moviebox.ng/wefeed-h5api-bff/subject/search?keyword={q}"
        async with httpx.AsyncClient() as client:
            response = await client.get(url, headers=MOVIEBOX_HEADERS)
            response.raise_for_status()
            data = response.json()
            
            results = []
            if "data" in data and "items" in data["data"]:
                for item in data["data"]["items"]:
                    results.append({
                        "subject_id": str(item.get("subjectId")),
                        "title": item.get("title"),
                        "poster": item.get("cover", {}).get("url"),
                        "year": item.get("releaseDate", "")[:4]
                    })
            return {"status": "success", "results": results}
    except Exception as e:
        return {"status": "error", "message": str(e)}

# 2. Stream Link Endpoint
@app.get("/api/stream/{subject_id}")
async def get_stream(subject_id: str, se: int = 0, ep: int = 0):
    try:
        url = f"https://moviebox.ng/wefeed-h5api-bff/media/play?subjectId={subject_id}&se={se}&ep={ep}"
        async with httpx.AsyncClient() as client:
            response = await client.get(url, headers=MOVIEBOX_HEADERS)
            response.raise_for_status()
            data = response.json()
            
            stream_url = ""
            if "data" in data and "streams" in data["data"]:
                streams = data["data"]["streams"]
                if len(streams) > 0:
                    stream_url = streams[0].get("url", "")
            
            return {
                "status": "success",
                "url": stream_url,
                "headers": MOVIEBOX_HEADERS
            }
    except Exception as e:
        return {"status": "error", "message": str(e)}