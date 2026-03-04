import express from "express";
import { createServer as createViteServer } from "vite";
import pkg from "pg";
const { Pool } = pkg;
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import path from "path";
import "dotenv/config";
import { fileURLToPath } from "url";
import { GoogleGenAI } from "@google/genai";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes("localhost") ? false : { rejectUnauthorized: false }
});

const JWT_SECRET = process.env.JWT_SECRET || "seo-bi-secret-key-12345";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

// Initialize Database
async function initDb() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email TEXT UNIQUE,
        password TEXT
      );

      CREATE TABLE IF NOT EXISTS projects (
        id SERIAL PRIMARY KEY,
        name TEXT,
        domain TEXT,
        country TEXT,
        language TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        userId INTEGER REFERENCES users(id)
      );

      CREATE TABLE IF NOT EXISTS keywords (
        id SERIAL PRIMARY KEY,
        projectId INTEGER REFERENCES projects(id),
        keyword TEXT,
        volume INTEGER,
        position INTEGER,
        prev_position INTEGER,
        impressions INTEGER,
        ctr REAL,
        prev_ctr REAL,
        competition REAL,
        trend REAL,
        status TEXT, -- 'Stable', 'Risk', 'Action Required'
        type TEXT, -- 'branded', 'non-branded'
        intent TEXT -- 'Informational', 'Transactional', 'Navigational'
      );

      CREATE TABLE IF NOT EXISTS events (
        id SERIAL PRIMARY KEY,
        projectId INTEGER REFERENCES projects(id),
        title TEXT,
        description TEXT,
        start_date TIMESTAMP,
        end_date TIMESTAMP,
        type TEXT -- 'Publication', 'Saison', 'Audit', 'Urgent'
      );

      CREATE TABLE IF NOT EXISTS gsc_daily (
        id SERIAL PRIMARY KEY,
        projectId INTEGER REFERENCES projects(id),
        keyword TEXT,
        date TEXT,
        impressions INTEGER,
        clicks INTEGER,
        position REAL,
        ctr REAL
      );

      CREATE TABLE IF NOT EXISTS serp_daily (
        id SERIAL PRIMARY KEY,
        projectId INTEGER REFERENCES projects(id),
        keyword TEXT,
        date TEXT,
        position INTEGER,
        competition REAL,
        volume INTEGER,
        cpc REAL
      );

      CREATE TABLE IF NOT EXISTS scores_daily (
        id SERIAL PRIMARY KEY,
        projectId INTEGER REFERENCES projects(id),
        keyword TEXT,
        date TEXT,
        competition_score REAL,
        opportunity_score REAL,
        ctr_gap REAL,
        performance_drift REAL,
        long_tail_indicator REAL,
        UNIQUE(projectId, keyword, date)
      );

      CREATE TABLE IF NOT EXISTS nlp_keyword_enrichment (
        id SERIAL PRIMARY KEY,
        projectId INTEGER REFERENCES projects(id),
        keyword TEXT,
        date TEXT,
        branded_status TEXT,
        stability_status TEXT,
        tail_type TEXT,
        search_intent TEXT,
        exclude_from_opportunity BOOLEAN,
        qualification_label TEXT,
        priority_level TEXT,
        action_hint TEXT,
        reasoning TEXT,
        UNIQUE(projectId, keyword, date)
      );

      CREATE TABLE IF NOT EXISTS keyword_clusters (
        id SERIAL PRIMARY KEY,
        projectId INTEGER REFERENCES projects(id),
        cluster_name TEXT,
        keywords TEXT, -- JSON array of keywords
        description TEXT,
        priority TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS connectors (
        id SERIAL PRIMARY KEY,
        projectId INTEGER REFERENCES projects(id),
        type TEXT, -- 'GSC', 'SEMrush', 'GoogleSheets'
        config TEXT, -- JSON config
        status TEXT, -- 'Connected', 'Disconnected'
        last_sync TIMESTAMP
      );
    `);

    // Seed initial user if not exists
    const userRes = await pool.query("SELECT * FROM users WHERE email = $1", ["admin@example.com"]);
    if (userRes.rows.length === 0) {
      const hashed = bcrypt.hashSync("password123", 10);
      await pool.query("INSERT INTO users (email, password) VALUES ($1, $2)", ["admin@example.com", hashed]);
    }
    console.log("Database initialized successfully");
  } catch (err) {
    console.error("Database initialization failed:", err);
  }
}

initDb();

const app = express();
app.use(express.json());

// Auth Middleware
const authenticate = (req: any, res: any, next: any) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "Unauthorized" });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    res.status(401).json({ error: "Invalid token" });
  }
};

// Auth Routes
app.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body;
  const userRes = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
  const user = userRes.rows[0];
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: "Invalid credentials" });
  }
  const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: "24h" });
  res.json({ token, user: { id: user.id, email: user.email } });
});

// Project Routes
app.get("/api/projects", authenticate, async (req: any, res) => {
  const projectsRes = await pool.query("SELECT * FROM projects WHERE userId = $1", [req.user.id]);
  res.json(projectsRes.rows);
});

app.post("/api/projects", authenticate, async (req: any, res) => {
  const { name, domain, country, language } = req.body;
  const result = await pool.query(
    "INSERT INTO projects (name, domain, country, language, userId) VALUES ($1, $2, $3, $4, $5) RETURNING id",
    [name, domain, country, language, req.user.id]
  );
  
  const projectId = result.rows[0].id;
  const dummyKeywords = [
    { keyword: "seo tools", volume: 12000, position: 5, impressions: 50000, ctr: 0.05, competition: 0.8, trend: 0.1, intent: "Informational" },
    { keyword: "best seo agency", volume: 5000, position: 12, impressions: 20000, ctr: 0.02, competition: 0.9, trend: -0.05, intent: "Transactional" },
    { keyword: "how to rank on google", volume: 25000, position: 2, impressions: 100000, ctr: 0.15, competition: 0.6, trend: 0.2, intent: "Informational" },
  ];

  for (const k of dummyKeywords) {
    await pool.query(
      "INSERT INTO keywords (projectId, keyword, volume, position, prev_position, impressions, ctr, prev_ctr, competition, trend, status, type, intent) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)",
      [projectId, k.keyword, k.volume, k.position, k.position + 2, k.impressions, k.ctr, k.ctr - 0.01, k.competition, k.trend, "Stable", "non-branded", k.intent]
    );
  }

  res.json({ id: projectId });
});

// Health Check
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Ingestion Routes (n8n compatible)
const API_KEY = process.env.API_KEY_N8N || "n8n-secret-key";

const checkApiKey = (req: any, res: any, next: any) => {
  const apiKey = req.headers["x-api-key"];
  if (apiKey !== API_KEY) {
    return res.status(401).json({ error: "Invalid API Key" });
  }
  next();
};

app.post("/api/ingest/gsc", checkApiKey, async (req, res) => {
  const { projectId, data } = req.body;
  try {
    for (const item of data) {
      await pool.query(
        "INSERT INTO gsc_daily (projectId, keyword, date, impressions, clicks, position, ctr) VALUES ($1, $2, $3, $4, $5, $6, $7)",
        [projectId, item.keyword, item.date, item.impressions, item.clicks, item.position, item.ctr]
      );
    }
    res.json({ success: true, count: data.length });
  } catch (err) {
    console.error("GSC Ingest error:", err);
    res.status(500).json({ error: "Failed to ingest GSC data" });
  }
});

app.post("/api/ingest/serp", checkApiKey, async (req, res) => {
  const { projectId, data } = req.body;
  try {
    for (const item of data) {
      await pool.query(
        "INSERT INTO serp_daily (projectId, keyword, date, position, competition, volume, cpc) VALUES ($1, $2, $3, $4, $5, $6, $7)",
        [projectId, item.keyword, item.date, item.position, item.competition, item.volume, item.cpc]
      );
    }
    res.json({ success: true, count: data.length });
  } catch (err) {
    console.error("SERP Ingest error:", err);
    res.status(500).json({ error: "Failed to ingest SERP data" });
  }
});

// KPI Decision Engine
app.post("/api/compute/kpis", checkApiKey, async (req, res) => {
  const { projectId, date } = req.body;
  try {
    const gscRes = await pool.query("SELECT * FROM gsc_daily WHERE projectId = $1 AND date = $2", [projectId, date]);
    const serpRes = await pool.query("SELECT * FROM serp_daily WHERE projectId = $1 AND date = $2", [projectId, date]);
    
    const gscData = gscRes.rows;
    const serpData = serpRes.rows;
    
    const results = [];
    for (const g of gscData) {
      const s: any = serpData.find((item: any) => item.keyword === g.keyword);
      if (!s) continue;

      const competition_score = s.competition || 0.5;
      const ctr_gap = (g.position < 3 ? 0.3 : 0.1) - g.ctr;
      const opportunity_score = (1 - competition_score) * (s.volume / 1000) * Math.max(0, ctr_gap);
      const performance_drift = 0; // Simplified
      const long_tail_indicator = g.keyword.split(" ").length > 3 ? 1 : 0;

      results.push({
        projectId, keyword: g.keyword, date,
        competition_score, opportunity_score, ctr_gap, performance_drift, long_tail_indicator
      });
    }

    for (const item of results) {
      await pool.query(`
        INSERT INTO scores_daily (projectId, keyword, date, competition_score, opportunity_score, ctr_gap, performance_drift, long_tail_indicator)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT(projectId, keyword, date) DO UPDATE SET
          competition_score=EXCLUDED.competition_score,
          opportunity_score=EXCLUDED.opportunity_score,
          ctr_gap=EXCLUDED.ctr_gap,
          performance_drift=EXCLUDED.performance_drift,
          long_tail_indicator=EXCLUDED.long_tail_indicator
      `, [item.projectId, item.keyword, item.date, item.competition_score, item.opportunity_score, item.ctr_gap, item.performance_drift, item.long_tail_indicator]);
    }
    res.json({ success: true, count: results.length });
  } catch (err) {
    console.error("Compute KPIs error:", err);
    res.status(500).json({ error: "Failed to compute KPIs" });
  }
});

// Updated Read Endpoint
app.get("/api/projects/:projectId/keywords", authenticate, async (req: any, res) => {
  const { projectId } = req.params;
  const { date } = req.query;

  const query = `
    SELECT 
      k.id, k.keyword,
      g.impressions, g.clicks, g.position as position, g.ctr,
      s.position as serp_position, s.competition, s.volume, s.cpc,
      sc.competition_score, sc.opportunity_score, sc.ctr_gap, sc.performance_drift, sc.long_tail_indicator,
      n.branded_status, n.stability_status, n.tail_type, n.search_intent, 
      n.exclude_from_opportunity, n.qualification_label, n.priority_level, n.action_hint, n.reasoning
    FROM keywords k
    LEFT JOIN gsc_daily g ON k.projectId = g.projectId AND k.keyword = g.keyword AND g.date = $1
    LEFT JOIN serp_daily s ON k.projectId = s.projectId AND k.keyword = s.keyword AND s.date = $2
    LEFT JOIN scores_daily sc ON k.projectId = sc.projectId AND k.keyword = sc.keyword AND sc.date = $3
    LEFT JOIN nlp_keyword_enrichment n ON k.projectId = n.projectId AND k.keyword = n.keyword AND n.date = $4
    WHERE k.projectId = $5
  `;
  
  try {
    const keywordsRes = await pool.query(query, [date, date, date, date, projectId]);
    res.json(keywordsRes.rows);
  } catch (err) {
    console.error("Get keywords error:", err);
    res.status(500).json({ error: "Failed to fetch keywords" });
  }
});

// Dashboard Routes (Legacy compatibility)
app.get("/api/dashboard", authenticate, async (req: any, res) => {
  const { projectId } = req.query;
  
  let query = `
    SELECT k.*, n.branded_status, n.stability_status, n.tail_type, n.search_intent, 
           n.exclude_from_opportunity, n.qualification_label, n.priority_level, n.action_hint, n.reasoning
    FROM keywords k
    LEFT JOIN nlp_keyword_enrichment n ON k.projectId = n.projectId AND k.keyword = n.keyword
  `;
  let params = [];
  if (projectId) {
    query += " WHERE k.projectId = $1";
    params.push(projectId);
  } else {
    query = `
      SELECT k.*, n.branded_status, n.stability_status, n.tail_type, n.search_intent, 
             n.exclude_from_opportunity, n.qualification_label, n.priority_level, n.action_hint, n.reasoning
      FROM keywords k 
      JOIN projects p ON k.projectId = p.id 
      LEFT JOIN nlp_keyword_enrichment n ON k.projectId = n.projectId AND k.keyword = n.keyword
      WHERE p.userId = $1
    `;
    params.push(req.user.id);
  }
  try {
    const keywordsRes = await pool.query(query, params);
    res.json(keywordsRes.rows);
  } catch (err) {
    console.error("Dashboard error:", err);
    res.status(500).json({ error: "Failed to fetch dashboard data" });
  }
});

app.post("/api/nlp/qualify", authenticate, async (req: any, res) => {
  const { projectId, keywords, date } = req.body;
  if (!projectId || !keywords || !Array.isArray(keywords)) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  const prompt = `Tu es le module "ML & NLP Intelligence" d’une plateforme SaaS SEO.
Analyse et enrichis les mots-clés suivants pour la "Qualification Automatique".

Données (JSON): ${JSON.stringify(keywords)}

Ta mission :
1) Qualification Automatique multi-dimension :
   - branded_status: branded|non_branded
   - stability_status: stable|opportunity
   - tail_type: long_tail|generic
   - search_intent: informationnelle|transactionnelle|navigationnelle

2) Filtrage stratégique :
   - exclude_from_opportunity: true si branded ET stable, sinon false

3) KPIs décisionnels (interprétation) :
   - Explique brièvement comment les KPIs influencent la décision.

4) Sortie :
   - qualification_label (court)
   - priority_level (low|medium|high)
   - action_hint (1 action principale)

RETOURNE UNIQUEMENT UN TABLEAU JSON d'objets avec ces clés:
keyword, branded_status, stability_status, tail_type, search_intent, exclude_from_opportunity, qualification_label, priority_level, action_hint, reasoning`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
      }
    });

    const results = JSON.parse(response.text || "[]");
    
    // Save results to DB
    for (const item of results) {
      await pool.query(`
        INSERT INTO nlp_keyword_enrichment (
          projectId, keyword, date, branded_status, stability_status, tail_type, 
          search_intent, exclude_from_opportunity, qualification_label, priority_level, 
          action_hint, reasoning
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        ON CONFLICT(projectId, keyword, date) DO UPDATE SET
          branded_status=EXCLUDED.branded_status,
          stability_status=EXCLUDED.stability_status,
          tail_type=EXCLUDED.tail_type,
          search_intent=EXCLUDED.search_intent,
          exclude_from_opportunity=EXCLUDED.exclude_from_opportunity,
          qualification_label=EXCLUDED.qualification_label,
          priority_level=EXCLUDED.priority_level,
          action_hint=EXCLUDED.action_hint,
          reasoning=EXCLUDED.reasoning
      `, [
        projectId,
        item.keyword,
        date,
        item.branded_status,
        item.stability_status,
        item.tail_type,
        item.search_intent,
        item.exclude_from_opportunity ? true : false,
        item.qualification_label,
        item.priority_level,
        item.action_hint,
        item.reasoning
      ]);
    }

    res.json({ success: true, results });
  } catch (err) {
    console.error("NLP Qualify error:", err);
    res.status(500).json({ error: "Failed to qualify keywords" });
  }
});

// NLP Routes
app.post("/api/nlp/save-enrichment", authenticate, async (req: any, res) => {
  const { results } = req.body;
  if (!results || !Array.isArray(results)) return res.status(400).json({ error: "Invalid data" });

  try {
    for (const item of results) {
      await pool.query(`
        INSERT INTO nlp_keyword_enrichment (
          projectId, keyword, date, branded_status, stability_status, tail_type, 
          search_intent, exclude_from_opportunity, qualification_label, priority_level, 
          action_hint, reasoning
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        ON CONFLICT(projectId, keyword, date) DO UPDATE SET
          branded_status=EXCLUDED.branded_status,
          stability_status=EXCLUDED.stability_status,
          tail_type=EXCLUDED.tail_type,
          search_intent=EXCLUDED.search_intent,
          exclude_from_opportunity=EXCLUDED.exclude_from_opportunity,
          qualification_label=EXCLUDED.qualification_label,
          priority_level=EXCLUDED.priority_level,
          action_hint=EXCLUDED.action_hint,
          reasoning=EXCLUDED.reasoning
      `, [
        item.project_id,
        item.keyword,
        item.date,
        item.branded_status,
        item.stability_status,
        item.tail_type,
        item.search_intent,
        item.exclude_from_opportunity ? true : false,
        item.qualification_label,
        item.priority_level,
        item.action_hint,
        item.reasoning
      ]);
    }
    res.json({ success: true });
  } catch (err) {
    console.error("Save enrichment error:", err);
    res.status(500).json({ error: "Failed to save enrichment" });
  }
});

app.post("/api/keywords/classify", authenticate, async (req: any, res) => {
  const { projectId } = req.body;
  if (!projectId) return res.status(400).json({ error: "Project ID required" });

  try {
    const keywordsRes = await pool.query("SELECT id, keyword FROM keywords WHERE projectId = $1", [projectId]);
    const keywords = keywordsRes.rows;
    if (keywords.length === 0) return res.json({ success: true, message: "No keywords to classify" });

    const keywordList = keywords.map((k: any) => k.keyword).join(", ");
    const prompt = `Classify the following SEO keywords into one of these three search intents: Informational, Transactional, Navigational. 
    Return the result as a JSON array of objects with "keyword" and "intent" properties.
    Keywords: ${keywordList}`;

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
      }
    });

    const classifications = JSON.parse(response.text || "[]");
    
    for (const item of classifications) {
      const k = keywords.find((kw: any) => kw.keyword.toLowerCase() === item.keyword.toLowerCase());
      if (k) {
        await pool.query("UPDATE keywords SET intent = $1 WHERE id = $2", [item.intent, k.id]);
      }
    }

    res.json({ success: true, classifications });
  } catch (err) {
    console.error("Classification error:", err);
    res.status(500).json({ error: "Failed to classify keywords" });
  }
});

// Calendar Routes
app.get("/api/calendar", authenticate, async (req: any, res) => {
  try {
    const eventsRes = await pool.query("SELECT e.* FROM events e JOIN projects p ON e.projectId = p.id WHERE p.userId = $1", [req.user.id]);
    res.json(eventsRes.rows);
  } catch (err) {
    console.error("Get calendar error:", err);
    res.status(500).json({ error: "Failed to fetch calendar events" });
  }
});

app.post("/api/calendar", authenticate, async (req: any, res) => {
  const { projectId, title, description, start_date, end_date, type } = req.body;
  try {
    await pool.query("INSERT INTO events (projectId, title, description, start_date, end_date, type) VALUES ($1, $2, $3, $4, $5, $6)", [projectId, title, description, start_date, end_date, type]);
    res.json({ success: true });
  } catch (err) {
    console.error("Add event error:", err);
    res.status(500).json({ error: "Failed to add event" });
  }
});

// Clustering Endpoint
app.post("/api/projects/:projectId/cluster", authenticate, async (req: any, res) => {
  const { projectId } = req.params;
  try {
    const keywordsRes = await pool.query("SELECT keyword FROM keywords WHERE projectId = $1", [projectId]);
    const keywords = keywordsRes.rows;
    if (keywords.length === 0) return res.json({ success: true, clusters: [] });

    const keywordList = keywords.map((k: any) => k.keyword).join(", ");
    const prompt = `Tu es un expert SEO. Regroupe les mots-clés suivants en clusters sémantiques logiques. 
    Pour chaque cluster, donne un nom, une brève description, la liste des mots-clés et un niveau de priorité (High, Medium, Low).
    Mots-clés: ${keywordList}
    RETOURNE UNIQUEMENT UN TABLEAU JSON d'objets avec ces clés: cluster_name, description, keywords (array), priority`;

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: { responseMimeType: "application/json" }
    });

    const clusters = JSON.parse(response.text || "[]");
    
    // Clear old clusters for this project
    await pool.query("DELETE FROM keyword_clusters WHERE projectId = $1", [projectId]);
    
    for (const c of clusters) {
      await pool.query("INSERT INTO keyword_clusters (projectId, cluster_name, keywords, description, priority) VALUES ($1, $2, $3, $4, $5)", [projectId, c.cluster_name, JSON.stringify(c.keywords), c.description, c.priority]);
    }

    res.json({ success: true, clusters });
  } catch (err) {
    console.error("Clustering error:", err);
    res.status(500).json({ error: "Failed to cluster keywords" });
  }
});

app.get("/api/projects/:projectId/clusters", authenticate, async (req: any, res) => {
  const { projectId } = req.params;
  try {
    const clustersRes = await pool.query("SELECT * FROM keyword_clusters WHERE projectId = $1", [projectId]);
    res.json(clustersRes.rows.map((c: any) => ({ ...c, keywords: JSON.parse(c.keywords) })));
  } catch (err) {
    console.error("Get clusters error:", err);
    res.status(500).json({ error: "Failed to fetch clusters" });
  }
});

// AI Action Plan Endpoint
app.get("/api/projects/:projectId/action-plan", authenticate, async (req: any, res) => {
  const { projectId } = req.params;
  try {
    const keywordsRes = await pool.query(`
      SELECT k.keyword, g.position, g.ctr, s.volume, sc.opportunity_score, n.action_hint
      FROM keywords k
      LEFT JOIN gsc_daily g ON k.projectId = g.projectId AND k.keyword = g.keyword
      LEFT JOIN serp_daily s ON k.projectId = s.projectId AND k.keyword = s.keyword
      LEFT JOIN scores_daily sc ON k.projectId = sc.projectId AND k.keyword = sc.keyword
      LEFT JOIN nlp_keyword_enrichment n ON k.projectId = n.projectId AND k.keyword = n.keyword
      WHERE k.projectId = $1
      ORDER BY sc.opportunity_score DESC NULLS LAST
      LIMIT 20
    `, [projectId]);
    const keywords = keywordsRes.rows;

    const prompt = `Analyse les données SEO suivantes pour le projet ${projectId} et génère un plan d'action de 5 points prioritaires pour améliorer le trafic.
    Données: ${JSON.stringify(keywords)}
    RETOURNE UNIQUEMENT UN TABLEAU JSON d'objets avec ces clés: title, description, priority (High|Medium|Low), impact (High|Medium|Low)`;

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: { responseMimeType: "application/json" }
    });
    const plan = JSON.parse(response.text || "[]");
    res.json(plan);
  } catch (err) {
    console.error("Action Plan error:", err);
    res.status(500).json({ error: "Failed to generate action plan" });
  }
});

// Connectors Endpoints
app.get("/api/projects/:projectId/connectors", authenticate, async (req: any, res) => {
  const { projectId } = req.params;
  try {
    const connectorsRes = await pool.query("SELECT * FROM connectors WHERE projectId = $1", [projectId]);
    res.json(connectorsRes.rows.map((c: any) => ({ ...c, config: JSON.parse(c.config) })));
  } catch (err) {
    console.error("Get connectors error:", err);
    res.status(500).json({ error: "Failed to fetch connectors" });
  }
});

app.post("/api/projects/:projectId/connectors", authenticate, async (req: any, res) => {
  const { projectId } = req.params;
  const { type, config } = req.body;
  try {
    await pool.query("INSERT INTO connectors (projectId, type, config, status) VALUES ($1, $2, $3, $4)", [projectId, type, JSON.stringify(config), "Connected"]);
    res.json({ success: true });
  } catch (err) {
    console.error("Add connector error:", err);
    res.status(500).json({ error: "Failed to add connector" });
  }
});

async function startServer() {
  const PORT = 3000;

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(__dirname, "dist", "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
