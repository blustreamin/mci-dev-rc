
import express from 'express';
import cors from 'cors';
import { google } from 'googleapis';
import { Stream } from 'stream';
import fetch from 'node-fetch'; // Using built-in or node-fetch if available in env
import { Buffer } from 'buffer';

const app = express();
const PORT = process.env.PORT || 8080;

// Env Vars
const SHARED_DRIVE_ID = process.env.SHARED_DRIVE_ID;
const SNAPSHOT_FOLDER_ID = process.env.SNAPSHOT_FOLDER_ID;
// Fix: Default to 'dev-key' if not set, to match client-side default and prevent 403s in dev
const API_KEY = process.env.API_KEY || 'dev-key';
const SERVICE_ACCOUNT_JSON = process.env.SERVICE_ACCOUNT_JSON;
const DATAFORSEO_LOGIN = process.env.DATAFORSEO_LOGIN;
const DATAFORSEO_PASSWORD = process.env.DATAFORSEO_PASSWORD;

// Google Drive Auth
let drive: any = null;
if (SERVICE_ACCOUNT_JSON) {
    try {
        const auth = new google.auth.GoogleAuth({
            credentials: JSON.parse(SERVICE_ACCOUNT_JSON),
            scopes: ['https://www.googleapis.com/auth/drive.file'],
        });
        drive = google.drive({ version: 'v3', auth });
    } catch (e) {
        console.error("Drive Auth Failed:", e);
    }
}

// Middleware
app.use(cors({
  origin: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'X-API-Key', 'X-Filename', 'Authorization']
}));
app.use(express.json({ limit: '50mb' })); // Increased limit for large payloads

// --- PUBLIC DIAGNOSTIC ENDPOINTS (Bypass API Key) ---

app.get('/healthz', (req, res) => {
  console.log('[PROXY][HEALTHZ] Ping received');
  res.json({
    ok: true,
    ts: new Date().toISOString(),
    version: '1.0.4-proxy-secured',
    env: {
      hasDfsKey: !!(DATAFORSEO_LOGIN && DATAFORSEO_PASSWORD),
      hasDriveKey: !!SERVICE_ACCOUNT_JSON,
      projectId: process.env.GOOGLE_CLOUD_PROJECT || 'unknown'
    }
  });
});

app.get('/dfs/ping', async (req, res) => {
  // This endpoint is legacy but kept for basic connectivity checks if needed.
  // It uses server-side env vars if available.
  const start = Date.now();
  if (!DATAFORSEO_LOGIN || !DATAFORSEO_PASSWORD) {
    return res.status(503).json({ ok: false, error: 'DFS_CREDS_MISSING_ON_PROXY', latencyMs: Date.now() - start });
  }

  try {
    const auth = Buffer.from(`${DATAFORSEO_LOGIN}:${DATAFORSEO_PASSWORD}`).toString('base64');
    const postUrl = "https://api.dataforseo.com/v3/keywords_data/google_ads/search_volume/task_post";
    const postBody = [{
        keywords: ["razor"],
        location_code: 2356,
        language_code: 'en'
    }];

    console.log('[PROXY][DFS_PING] Triggering minimal task_post to DataForSEO');
    const response = await fetch(postUrl, {
      method: 'POST',
      headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(postBody)
    });

    const data: any = await response.json();
    const ok = response.ok && data?.status_code === 20000;

    res.json({
      ok,
      status: response.status,
      latencyMs: Date.now() - start,
      error: ok ? null : (data?.status_message || response.statusText)
    });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e.message, latencyMs: Date.now() - start });
  }
});

// Middleware: API Key Auth (Required for standard routes)
app.use((req, res, next) => {
  if (req.method === 'OPTIONS') return next();
  const key = req.header('X-API-Key');
  if (!key || key !== API_KEY) {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  next();
});

// --- GENERIC DFS PROXY (THE SOURCE OF TRUTH) ---

// ALLOWLIST: Only permit these upstream paths for security
const ALLOWED_DFS_PATHS = [
    // Google Ads
    "keywords_data/google_ads/search_volume/live",
    "keywords_data/google_ads/search_volume/task_post",
    "keywords_data/google_ads/search_volume/task_get",
    // Amazon (Merchant API used by Client)
    "merchant/amazon/keywords_data/search_volume/live",
    "merchant/amazon/keywords_data/dataforseo_labs/keyword_ideas/live",
    // Amazon (Standard Keywords API - Expanded Scope)
    "keywords_data/amazon/search_volume/",
    "keywords_data/amazon/bulk_search_volume/",
    "keywords_data/amazon/related_keywords/",
    "keywords_data/amazon/keyword_suggestions/",
    // Amazon Labs (Corrected Endpoint)
    "dataforseo_labs/amazon/bulk_search_volume/live"
];

app.post('/dfs/proxy', async (req, res) => {
    // Support both schemas: Client sends { path, ... }, Legacy might send { endpoint, ... }
    let { path, endpoint, payload, creds } = req.body;
    
    // Normalize to 'path' (no leading slash, no v3)
    if (!path && endpoint) {
        path = endpoint.replace(/^\/?v3\//, '').replace(/^\//, '');
    }

    if (!path || !creds?.login || !creds?.password) {
        return res.status(400).json({ error: "Missing required fields: path/endpoint, creds.login, creds.password" });
    }

    // 1. Guard: V3 Prefix
    if (path.startsWith('v3/')) {
        return res.status(400).json({ 
            code: "DFS_INVALID_PATH_PREFIX", 
            error: "Do not include 'v3/' in path. Proxy appends it." 
        });
    }

    // 2. Allowlist Check
    const isAllowed = ALLOWED_DFS_PATHS.some(prefix => path.startsWith(prefix));
    
    const start = Date.now();
    const url = `https://api.dataforseo.com/v3/${path}`;

    // Log request
    console.log("[DFS_PROXY][REQ]", { rawPath: path, targetUrl: url });

    if (!isAllowed) {
        console.log("[DFS_PROXY][BLOCKED]", { rawPath: path, reason: "Allowlist Miss" });
        return res.status(403).json({ 
            code: "DFS_PATH_BLOCKED", 
            error: "Path not allowed by proxy", 
            path 
        });
    }
    
    try {
        const auth = Buffer.from(`${creds.login}:${creds.password}`).toString('base64');
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Basic ${auth}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        // We forward the raw status and body from DFS
        const data = await response.json();
        
        console.log(`[DFS_PROXY] <- ${response.status} (${Date.now() - start}ms)`);
        
        // Return 200 even if DFS failed logic, client handles the DFS error structure
        res.status(200).json({
            proxyStatus: response.status,
            data: data
        });

    } catch (e: any) {
        console.error(`[DFS_PROXY] ERROR: ${e.message}`);
        res.status(500).json({ error: "Proxy Request Failed", details: e.message });
    }
});

// --- GOOGLE DRIVE ROUTES ---

app.get('/snapshots', async (req, res) => {
  if (!drive || !SNAPSHOT_FOLDER_ID) return res.status(503).json({ error: "Drive not configured" });
  try {
    const response = await drive.files.list({
      q: `'${SNAPSHOT_FOLDER_ID}' in parents and trashed = false`,
      orderBy: 'createdTime desc',
      pageSize: 20,
      fields: 'files(id, name, createdTime, size)',
      includeItemsFromAllDrives: true,
      supportsAllDrives: true,
      driveId: SHARED_DRIVE_ID,
      corpora: 'drive',
    });
    res.json(response.data.files || []);
  } catch (error: any) {
    console.error("List Error:", error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/snapshots', async (req, res) => {
  if (!drive || !SNAPSHOT_FOLDER_ID) return res.status(503).json({ error: "Drive not configured" });
  const filename = req.header('X-Filename') || `snapshot-${Date.now()}.json.gz`;
  try {
    const fileMetadata = { name: filename, parents: [SNAPSHOT_FOLDER_ID] };
    const media = { mimeType: 'application/gzip', body: req };
    const response = await drive.files.create({
      requestBody: fileMetadata,
      media: media,
      fields: 'id',
      supportsAllDrives: true,
    });
    res.json({ fileId: response.data.id, status: 'uploaded' });
  } catch (error: any) {
    console.error("Upload Error:", error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/snapshots/:id', async (req, res) => {
  if (!drive) return res.status(503).json({ error: "Drive not configured" });
  try {
    const fileId = req.params.id;
    const response = await drive.files.get(
      { fileId, alt: 'media', supportsAllDrives: true },
      { responseType: 'stream' }
    );
    res.setHeader('Content-Type', 'application/gzip');
    (response.data as Stream).pipe(res);
  } catch (error: any) {
    console.error("Download Error:", error);
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
