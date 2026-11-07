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

        const session = new MovieboxSession();
        const results = await search(session, { query: query });
        
        // Vercel ke logs mein dekhne ke liye
        console.log("ASAL RESPONSE:", results);

        let formattedResults = [];
        
        if (results && results.results && Array.isArray(results.results)) {
            formattedResults = results.results.map(item => ({
                subject_id: String(item.subjectId || item.detailPath || ""),
                title: item.title || "Unknown Title",
                poster: item.cover?.url || item.cover || '',
                year: item.releaseDate ? item.releaseDate.substring(0, 4) : ''
            }));
        }

        res.json({
            status: "success",
            results: formattedResults
        });
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