import express from 'express';
import cors from 'cors';
import { MovieboxSession, search, getMovieStreamUrl } from 'moviebox-js-sdk';

const app = express();
app.use(cors());

// Health check
app.get('/', (req, res) => {
    res.json({ status: "success", message: "CineBox Node API is running on Vercel!" });
});

// 1. Search Endpoint
app.get('/api/search', async (req, res) => {
    try {
        const query = req.query.q;
        if (!query) return res.status(400).json({ status: "error", message: "Movie name required" });

        // Direct MovieBox API call (jo localhost par chali thi)
        const url = `https://h5.aoneroom.com/wefeed-h5api-bff/subject/search?keyword=${encodeURIComponent(query)}`;
        
        const response = await fetch(url, {
            headers: {
                "User-Agent": "com.community.mbox.in/50020130 (Linux; U; Android 14; en_IN; Pixel 8; Build/UD1A.230803.041; Cronet/145.0.7582.0)",
                "Referer": "https://api3.aoneroom.com/",
                "Accept": "application/json"
            },
            redirect: 'follow'
        });

        const data = await response.json();

        let results = [];
        if (data && data.data && data.data.items) {
            results = data.data.items.map(item => ({
                subject_id: String(item.subjectId),
                title: item.title,
                poster: item.cover ? item.cover.url : '',
                year: item.releaseDate ? item.releaseDate.substring(0, 4) : ''
            }));
        }

        res.json({ status: "success", results: results });
    } catch (error) {
        res.status(500).json({ status: "error", message: error.message });
    }
});

// 2. Stream Endpoint
app.get('/api/stream/:subject_id', async (req, res) => {
    try {
        const session = new MovieboxSession();
        const stream = await getMovieStreamUrl(session, { 
            detailPath: req.params.subject_id, 
            quality: 'best' 
        });
        
        res.json({
            status: "success",
            url: stream.stream?.url || "",
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Referer": "https://moviebox.ng/"
            }
        });
    } catch (error) {
        res.status(500).json({ status: "error", message: error.message });
    }
});

// VERCEL KE LIYE SABSE AHEM CHANGE:
// app.listen() hata dein aur app ko export kar dein
export default app;
