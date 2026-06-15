/**
 * BG Predictor — Dexcom Share Proxy
 * Deploy to Railway: https://railway.app
 *
 * No npm dependencies — uses Node built-ins only.
 */

const http = require("http");
const https = require("https");
const url = require("url");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;

const DEXCOM_SHARE_US  = "share2.dexcom.com";
const DEXCOM_SHARE_OUS = "shareous1.dexcom.com";
const LOGIN_PATH    = "/ShareWebServices/Services/General/LoginPublisherAccountById";
const READINGS_PATH = "/ShareWebServices/Services/Publisher/ReadPublisherLatestGlucoseValues";
const APPLICATION_ID = "d89443d2-327c-4a6f-89e5-496bbb0317db";

// In-memory session store keyed by a random token we issue to the browser
const sessions = {};

function dexcomPost(host, path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const options = {
      hostname: host, path, method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(data),
        "User-Agent": "Dexcom Share/3.0.2.11 CFNetwork/711.2.23 Darwin/14.0.0",
        Accept: "application/json",
      },
    };
    const req = https.request(options, (res) => {
      let raw = "";
      res.on("data", (c) => (raw += c));
      res.on("end", () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
        catch { resolve({ status: res.statusCode, body: raw }); }
      });
    });
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

async function dexcomLogin(username, password, outsideUS) {
  const host = outsideUS ? DEXCOM_SHARE_OUS : DEXCOM_SHARE_US;
  const result = await dexcomPost(host, LOGIN_PATH, {
    accountName: username, password, applicationId: APPLICATION_ID,
  });
  if (result.status !== 200 || typeof result.body !== "string")
    throw new Error(`Login failed (${result.status}): ${JSON.stringify(result.body)}`);
  return result.body.replace(/"/g, "");
}

async function dexcomReadings(shareSessionId, minutes, maxCount, outsideUS) {
  const host = outsideUS ? DEXCOM_SHARE_OUS : DEXCOM_SHARE_US;
  const qs = `?sessionId=${shareSessionId}&minutes=${minutes}&maxCount=${maxCount}`;
  return new Promise((resolve, reject) => {
    https.get({
      hostname: host, path: READINGS_PATH + qs,
      headers: {
        Accept: "application/json",
        "User-Agent": "Dexcom Share/3.0.2.11 CFNetwork/711.2.23 Darwin/14.0.0",
      },
    }, (res) => {
      let raw = "";
      res.on("data", (c) => (raw += c));
      res.on("end", () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
        catch { resolve({ status: res.statusCode, body: raw }); }
      });
    }).on("error", reject);
  });
}

function randomToken() {
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Session-Token");
}

function json(res, status, data) {
  cors(res);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => { try { resolve(JSON.parse(data)); } catch { resolve({}); } });
  });
}

// Prune old sessions every hour
setInterval(() => {
  const now = Date.now();
  for (const [token, s] of Object.entries(sessions)) {
    if (now > s.expiry) delete sessions[token];
  }
}, 60 * 60 * 1000);

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);

  if (req.method === "OPTIONS") { cors(res); res.writeHead(204); res.end(); return; }

  // Serve index.html for root
  if (req.method === "GET" && (parsed.pathname === "/" || parsed.pathname === "/index.html")) {
    try {
      const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
      cors(res);
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(html);
    } catch { json(res, 404, { error: "index.html not found" }); }
    return;
  }

  // POST /login
  if (req.method === "POST" && parsed.pathname === "/login") {
    const body = await readBody(req);
    const { username, password, outsideUS } = body;
    if (!username || !password) return json(res, 400, { error: "username and password required" });
    try {
      const shareSessionId = await dexcomLogin(username, password, !!outsideUS);
      const token = randomToken();
      sessions[token] = {
        shareSessionId,
        username, password, outsideUS: !!outsideUS,
        expiry: Date.now() + 8 * 60 * 60 * 1000,
      };
      json(res, 200, { token });
    } catch (e) {
      json(res, 401, { error: e.message });
    }
    return;
  }

  // GET /readings
  if (req.method === "GET" && parsed.pathname === "/readings") {
    const token = req.headers["x-session-token"];
    const session = sessions[token];
    if (!session) return json(res, 401, { error: "Not logged in" });

    // Auto-renew if session is close to expiry
    if (Date.now() > session.expiry - 30 * 60 * 1000) {
      try {
        session.shareSessionId = await dexcomLogin(session.username, session.password, session.outsideUS);
        session.expiry = Date.now() + 8 * 60 * 60 * 1000;
      } catch (e) {
        delete sessions[token];
        return json(res, 401, { error: "Session expired: " + e.message });
      }
    }

    const minutes  = parseInt(parsed.query.minutes)  || 60;
    const maxCount = parseInt(parsed.query.maxCount) || 12;
    try {
      let result = await dexcomReadings(session.shareSessionId, minutes, maxCount, session.outsideUS);
      // Retry once on server error (stale Dexcom session)
      if (result.status === 500) {
        session.shareSessionId = await dexcomLogin(session.username, session.password, session.outsideUS);
        session.expiry = Date.now() + 8 * 60 * 60 * 1000;
        result = await dexcomReadings(session.shareSessionId, minutes, maxCount, session.outsideUS);
      }
      json(res, result.status, result.body);
    } catch (e) {
      json(res, 500, { error: e.message });
    }
    return;
  }

  json(res, 404, { error: "Not found" });
});

server.listen(PORT, () => console.log(`BG Predictor running on port ${PORT}`));
