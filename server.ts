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
  ssl: process.env.DATABASE_URL?.includes("localhost")
    ? false
    : { rejectUnauthorized: false },
});

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error("JWT_SECRET is not defined");
}

const API_KEY = process.env.API_KEY_N8N || "n8n-secret-key";
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

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
        userid INTEGER REFERENCES users(id)
      );

      CREATE TABLE IF NOT EXISTS keywords (
        id SERIAL PRIMARY KEY,
        projectid INTEGER REFERENCES projects(id),
        keyword TEXT,
        volume INTEGER,
        position INTEGER,
        prev_position INTEGER,
        impressions INTEGER,
        ctr REAL,
        prev_ctr REAL,
        competition REAL,
        trend REAL,
        status TEXT,
        type TEXT,
        intent TEXT
      );

      CREATE TABLE IF NOT EXISTS events (
        id SERIAL PRIMARY KEY,
        projectid INTEGER REFERENCES projects(id),
        title TEXT,
        description TEXT,
        start_date TIMESTAMP,
        end_date TIMESTAMP,
        type TEXT
      );

      CREATE TABLE IF NOT EXISTS gsc_daily (
        id SERIAL PRIMARY KEY,
        projectid INTEGER REFERENCES projects(id),
        keyword TEXT,
        date TEXT,
        impressions INTEGER,
        clicks INTEGER,
        position REAL,
        ctr REAL,
        UNIQUE(projectid, keyword, date)
      );

      CREATE TABLE IF NOT EXISTS serp_daily (
        id SERIAL PRIMARY KEY,
        projectid INTEGER REFERENCES projects(id),
        keyword TEXT,
        date TEXT,
        position INTEGER,
        competition REAL,
        volume INTEGER,
        cpc REAL,
        serp_result_count INTEGER DEFAULT 0,
        serp_top1_title TEXT,
        serp_top1_link TEXT,
        serp_top3_links TEXT,
        serp_top3_domains TEXT,
        paa_count INTEGER DEFAULT 0,
        paa_questions_newline TEXT,
        ai_overview_present BOOLEAN DEFAULT FALSE,
        ai_overview_text TEXT,
        top_organic_urls TEXT,
        UNIQUE(projectid, keyword, date)
      );

      CREATE TABLE IF NOT EXISTS scores_daily (
        id SERIAL PRIMARY KEY,
        projectid INTEGER REFERENCES projects(id),
        keyword TEXT,
        date TEXT,
        competition_score REAL,
        opportunity_score REAL,
        ctr_gap REAL,
        performance_drift REAL,
        long_tail_indicator REAL,
        UNIQUE(projectid, keyword, date)
      );

      CREATE TABLE IF NOT EXISTS nlp_keyword_enrichment (
        id SERIAL PRIMARY KEY,
        projectid INTEGER REFERENCES projects(id),
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
        UNIQUE(projectid, keyword, date)
      );

      CREATE TABLE IF NOT EXISTS keyword_clusters (
        id SERIAL PRIMARY KEY,
        projectid INTEGER REFERENCES projects(id),
        cluster_name TEXT,
        keywords TEXT,
        description TEXT,
        priority TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await pool.query(`
      ALTER TABLE serp_daily
      ADD COLUMN IF NOT EXISTS serp_result_count INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS serp_top1_title TEXT,
      ADD COLUMN IF NOT EXISTS serp_top1_link TEXT,
      ADD COLUMN IF NOT EXISTS serp_top3_links TEXT,
      ADD COLUMN IF NOT EXISTS serp_top3_domains TEXT,
      ADD COLUMN IF NOT EXISTS paa_count INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS paa_questions_newline TEXT,
      ADD COLUMN IF NOT EXISTS ai_overview_present BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS ai_overview_text TEXT,
      ADD COLUMN IF NOT EXISTS top_organic_urls TEXT;
    `);

    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS keywords_project_keyword_unique
      ON keywords (projectid, keyword);
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_gsc_daily_project_date
      ON gsc_daily(projectid, date);
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_serp_daily_project_date
      ON serp_daily(projectid, date);
    `);

    const userRes = await pool.query(
      "SELECT * FROM users WHERE email = $1",
      ["admin@example.com"]
    );

    if (userRes.rows.length === 0) {
      const hashed = bcrypt.hashSync("password123", 10);
      await pool.query(
        "INSERT INTO users (email, password) VALUES ($1, $2)",
        ["admin@example.com", hashed]
      );
    }

    console.log("Database initialized successfully");
  } catch (err) {
    console.error("Database initialization failed:", err);
  }
}

initDb();

const app = express();
app.use(express.json());

const authenticate = (req: any, res: any, next: any) => {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).json({ error: "Missing Authorization header" });
  }

  if (!authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Invalid Authorization format" });
  }

  const token = authHeader.substring(7);

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
};

const checkApiKey = (req: any, res: any, next: any) => {
  const apiKey = req.headers["x-api-key"];
  if (apiKey !== API_KEY) {
    return res.status(401).json({ error: "Invalid API Key" });
  }
  next();
};

async function ensureProjectExists(projectId: number) {
  const projectRes = await pool.query("SELECT id FROM projects WHERE id = $1", [projectId]);
  return projectRes.rows.length > 0;
}

async function upsertKeywords(projectId: number, data: any[]) {
  const uniqueKeywords = [...new Set(data.map((item: any) => item.keyword).filter(Boolean))];

  for (const kw of uniqueKeywords) {
    await pool.query(
      `
      INSERT INTO keywords (projectid, keyword)
      VALUES ($1, $2)
      ON CONFLICT (projectid, keyword) DO NOTHING
      `,
      [projectId, kw]
    );
  }
}

app.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body;

  try {
    const userRes = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
    const user = userRes.rows[0];

    if (!user || !bcrypt.compareSync(password, user.password)) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: "24h" });
    res.json({ token, user: { id: user.id, email: user.email } });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "Login failed" });
  }
});

app.get("/api/projects", authenticate, async (req: any, res) => {
  try {
    const projectsRes = await pool.query(
      `SELECT
        id,
        name,
        domain,
        country,
        language,
        created_at,
        userid AS "userId"
      FROM projects
      WHERE userid = $1
      ORDER BY created_at DESC`,
      [req.user.id]
    );

    res.json(projectsRes.rows);
  } catch (err) {
    console.error("Get projects error:", err);
    res.status(500).json({ error: "Failed to fetch projects" });
  }
});

app.post("/api/projects", authenticate, async (req: any, res) => {
  const { name, domain, country, language } = req.body;

  try {
    const result = await pool.query(
      `INSERT INTO projects (name, domain, country, language, userid)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [name, domain, country, language, req.user.id]
    );

    res.json({ id: result.rows[0].id });
  } catch (err) {
    console.error("Create project error:", err);
    res.status(500).json({ error: "Failed to create project" });
  }
});

app.put("/api/projects/:projectId", authenticate, async (req: any, res) => {
  const { projectId } = req.params;
  const { name, domain, country, language } = req.body;

  try {
    const existing = await pool.query(
      "SELECT * FROM projects WHERE id = $1 AND userid = $2",
      [projectId, req.user.id]
    );

    if (existing.rows.length === 0) {
      return res.status(404).json({ error: "Project not found" });
    }

    const result = await pool.query(
      `UPDATE projects
       SET name = $1,
           domain = $2,
           country = $3,
           language = $4
       WHERE id = $5 AND userid = $6
       RETURNING id, name, domain, country, language, created_at, userid AS "userId"`,
      [name, domain, country, language, projectId, req.user.id]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error("Update project error:", err);
    res.status(500).json({ error: "Failed to update project" });
  }
});

app.delete("/api/projects/:projectId", authenticate, async (req: any, res) => {
  const { projectId } = req.params;

  try {
    const existing = await pool.query(
      "SELECT * FROM projects WHERE id = $1 AND userid = $2",
      [projectId, req.user.id]
    );

    if (existing.rows.length === 0) {
      return res.status(404).json({ error: "Project not found" });
    }

    await pool.query("DELETE FROM keyword_clusters WHERE projectid = $1", [projectId]);
    await pool.query("DELETE FROM nlp_keyword_enrichment WHERE projectid = $1", [projectId]);
    await pool.query("DELETE FROM scores_daily WHERE projectid = $1", [projectId]);
    await pool.query("DELETE FROM serp_daily WHERE projectid = $1", [projectId]);
    await pool.query("DELETE FROM gsc_daily WHERE projectid = $1", [projectId]);
    await pool.query("DELETE FROM events WHERE projectid = $1", [projectId]);
    await pool.query("DELETE FROM keywords WHERE projectid = $1", [projectId]);
    await pool.query("DELETE FROM projects WHERE id = $1 AND userid = $2", [projectId, req.user.id]);

    res.json({ success: true });
  } catch (err) {
    console.error("Delete project error:", err);
    res.status(500).json({ error: "Failed to delete project" });
  }
});

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.post("/api/ingest/gsc", checkApiKey, async (req, res) => {
  const { projectId, data } = req.body;

  if (!projectId || !Array.isArray(data)) {
    return res.status(400).json({ error: "Invalid payload" });
  }

  if (data.length === 0) {
    return res.json({ success: true, count: 0 });
  }

  try {
    const exists = await ensureProjectExists(Number(projectId));
    if (!exists) {
      return res.status(404).json({ error: `Project ${projectId} not found` });
    }

    await upsertKeywords(Number(projectId), data);

    const values: any[] = [];
    const placeholders: string[] = [];

    data.forEach((item, i) => {
      const idx = i * 7;
      placeholders.push(`($${idx + 1}, $${idx + 2}, $${idx + 3}, $${idx + 4}, $${idx + 5}, $${idx + 6}, $${idx + 7})`);
      values.push(
        Number(projectId),
        item.keyword,
        item.date,
        item.impressions ?? 0,
        item.clicks ?? 0,
        item.position ?? 0,
        item.ctr ?? 0
      );
    });

    const query = `
      INSERT INTO gsc_daily
      (projectid, keyword, date, impressions, clicks, position, ctr)
      VALUES ${placeholders.join(",")}
      ON CONFLICT (projectid, keyword, date)
      DO UPDATE SET
        impressions = EXCLUDED.impressions,
        clicks = EXCLUDED.clicks,
        position = EXCLUDED.position,
        ctr = EXCLUDED.ctr
    `;

    await pool.query(query, values);
    res.json({ success: true, count: data.length });
  } catch (err) {
    console.error("Bulk GSC insert error:", err);
    res.status(500).json({ error: "Insert failed" });
  }
});

app.post("/api/ingest/serp", checkApiKey, async (req, res) => {
  const { projectId, data } = req.body;

  if (!projectId || !Array.isArray(data)) {
    return res.status(400).json({ error: "Invalid payload" });
  }

  if (data.length === 0) {
    return res.json({ success: true, count: 0 });
  }

  try {
    const exists = await ensureProjectExists(Number(projectId));
    if (!exists) {
      return res.status(404).json({ error: `Project ${projectId} not found` });
    }

    await upsertKeywords(Number(projectId), data);

    const values: any[] = [];
    const placeholders: string[] = [];

    data.forEach((item, i) => {
      const idx = i * 17;
      placeholders.push(
        `($${idx + 1}, $${idx + 2}, $${idx + 3}, $${idx + 4}, $${idx + 5}, $${idx + 6}, $${idx + 7}, $${idx + 8}, $${idx + 9}, $${idx + 10}, $${idx + 11}, $${idx + 12}, $${idx + 13}, $${idx + 14}, $${idx + 15}, $${idx + 16}, $${idx + 17})`
      );

      values.push(
        Number(projectId),
        item.keyword,
        item.date,
        item.position ?? 0,
        item.competition ?? 0,
        item.volume ?? 0,
        item.cpc ?? 0,
        item.serp_result_count ?? 0,
        item.serp_top1_title ?? "",
        item.serp_top1_link ?? "",
        item.serp_top3_links ?? "",
        item.serp_top3_domains ?? "",
        item.paa_count ?? 0,
        item.paa_questions_newline ?? "",
        item.ai_overview_present ?? false,
        item.ai_overview_text ?? "",
        item.top_organic_urls ?? ""
      );
    });

    const query = `
      INSERT INTO serp_daily (
        projectid, keyword, date, position, competition, volume, cpc,
        serp_result_count, serp_top1_title, serp_top1_link,
        serp_top3_links, serp_top3_domains,
        paa_count, paa_questions_newline,
        ai_overview_present, ai_overview_text, top_organic_urls
      )
      VALUES ${placeholders.join(",")}
      ON CONFLICT (projectid, keyword, date)
      DO UPDATE SET
        position = EXCLUDED.position,
        competition = EXCLUDED.competition,
        volume = EXCLUDED.volume,
        cpc = EXCLUDED.cpc,
        serp_result_count = EXCLUDED.serp_result_count,
        serp_top1_title = EXCLUDED.serp_top1_title,
        serp_top1_link = EXCLUDED.serp_top1_link,
        serp_top3_links = EXCLUDED.serp_top3_links,
        serp_top3_domains = EXCLUDED.serp_top3_domains,
        paa_count = EXCLUDED.paa_count,
        paa_questions_newline = EXCLUDED.paa_questions_newline,
        ai_overview_present = EXCLUDED.ai_overview_present,
        ai_overview_text = EXCLUDED.ai_overview_text,
        top_organic_urls = EXCLUDED.top_organic_urls
    `;

    await pool.query(query, values);
    res.json({ success: true, count: data.length });
  } catch (err) {
    console.error("Bulk SERP insert error:", err);
    res.status(500).json({ error: "Insert failed" });
  }
});

app.post("/api/compute/kpis", checkApiKey, async (req, res) => {
  const { projectId, date } = req.body;

  if (!projectId || !date) {
    return res.status(400).json({ error: "projectId and date are required" });
  }

  try {
    const exists = await ensureProjectExists(Number(projectId));
    if (!exists) {
      return res.status(404).json({ error: `Project ${projectId} not found` });
    }

    const gscRes = await pool.query(
      "SELECT * FROM gsc_daily WHERE projectid = $1 AND date = $2",
      [projectId, date]
    );

    const serpRes = await pool.query(
      "SELECT * FROM serp_daily WHERE projectid = $1 AND date = $2",
      [projectId, date]
    );

    const gscData = gscRes.rows;
    const serpData = serpRes.rows;
    const results: any[] = [];

    for (const g of gscData) {
      const s: any = serpData.find((item: any) => item.keyword === g.keyword);
      if (!s) continue;

      const competition_score = s.competition || 0.5;
      const ctr_gap = (g.position < 3 ? 0.3 : 0.1) - g.ctr;
      const opportunity_score = (1 - competition_score) * ((s.volume || 0) / 1000) * Math.max(0, ctr_gap);
      const performance_drift = 0;
      const long_tail_indicator = g.keyword.split(" ").length > 3 ? 1 : 0;

      results.push({
        projectId,
        keyword: g.keyword,
        date,
        competition_score,
        opportunity_score,
        ctr_gap,
        performance_drift,
        long_tail_indicator,
      });
    }

    for (const item of results) {
      await pool.query(
        `
        INSERT INTO scores_daily
        (projectid, keyword, date, competition_score, opportunity_score, ctr_gap, performance_drift, long_tail_indicator)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT(projectid, keyword, date)
        DO UPDATE SET
          competition_score = EXCLUDED.competition_score,
          opportunity_score = EXCLUDED.opportunity_score,
          ctr_gap = EXCLUDED.ctr_gap,
          performance_drift = EXCLUDED.performance_drift,
          long_tail_indicator = EXCLUDED.long_tail_indicator
        `,
        [
          item.projectId,
          item.keyword,
          item.date,
          item.competition_score,
          item.opportunity_score,
          item.ctr_gap,
          item.performance_drift,
          item.long_tail_indicator,
        ]
      );
    }

    res.json({ success: true, count: results.length });
  } catch (err) {
    console.error("Compute KPIs error:", err);
    res.status(500).json({ error: "Failed to compute KPIs" });
  }
});

app.get("/api/projects/:projectId/latest-date", authenticate, async (req: any, res) => {
  const { projectId } = req.params;

  try {
    const result = await pool.query(
      `
      SELECT MAX(date) AS latest_date
      FROM (
        SELECT date FROM gsc_daily WHERE projectid = $1
        UNION
        SELECT date FROM serp_daily WHERE projectid = $1
      ) t
      `,
      [projectId]
    );

    res.json({ latestDate: result.rows[0]?.latest_date || null });
  } catch (err) {
    console.error("Latest date error:", err);
    res.status(500).json({ error: "Failed to fetch latest date" });
  }
});

app.get("/api/projects/:projectId/dashboard-data", authenticate, async (req: any, res) => {
  const { projectId } = req.params;
  const { date } = req.query;

  if (!date) {
    return res.status(400).json({ error: "date is required" });
  }

  try {
    const result = await pool.query(
      `
      SELECT
        k.id,
        k.projectid AS "projectId",
        k.keyword,

        g.impressions,
        g.clicks,
        g.position AS gsc_position,
        g.ctr,

        s.position AS serp_position,
        s.competition,
        s.volume,
        s.cpc,
        s.serp_result_count,
        s.serp_top1_title,
        s.serp_top1_link,
        s.serp_top3_links,
        s.serp_top3_domains,
        s.paa_count,
        s.paa_questions_newline,
        s.ai_overview_present,
        s.ai_overview_text,
        s.top_organic_urls,

        sc.competition_score,
        sc.opportunity_score,
        sc.ctr_gap,
        sc.performance_drift,
        sc.long_tail_indicator,

        n.branded_status,
        n.stability_status,
        n.tail_type,
        n.search_intent,
        n.exclude_from_opportunity,
        n.qualification_label,
        n.priority_level,
        n.action_hint,
        n.reasoning

      FROM keywords k
      LEFT JOIN gsc_daily g
        ON k.projectid = g.projectid
       AND k.keyword = g.keyword
       AND g.date = $1
      LEFT JOIN serp_daily s
        ON k.projectid = s.projectid
       AND k.keyword = s.keyword
       AND s.date = $1
      LEFT JOIN scores_daily sc
        ON k.projectid = sc.projectid
       AND k.keyword = sc.keyword
       AND sc.date = $1
      LEFT JOIN nlp_keyword_enrichment n
        ON k.projectid = n.projectid
       AND k.keyword = n.keyword
       AND n.date = $1
      WHERE k.projectid = $2
      ORDER BY COALESCE(sc.opportunity_score, 0) DESC, k.keyword ASC
      `,
      [date, projectId]
    );

    res.json(result.rows);
  } catch (err) {
    console.error("Dashboard data error:", err);
    res.status(500).json({ error: "Failed to fetch dashboard data" });
  }
});

app.get("/api/projects/:projectId/keywords", authenticate, async (req: any, res) => {
  const { projectId } = req.params;
  const { date } = req.query;

  const query = `
    SELECT
      k.id,
      k.projectid AS "projectId",
      k.keyword,
      g.impressions,
      g.clicks,
      g.position AS position,
      g.ctr,
      s.position AS serp_position,
      s.competition,
      s.volume,
      s.cpc,
      s.serp_result_count,
      s.serp_top1_title,
      s.serp_top1_link,
      s.serp_top3_links,
      s.serp_top3_domains,
      s.paa_count,
      s.paa_questions_newline,
      s.ai_overview_present,
      s.ai_overview_text,
      s.top_organic_urls,
      sc.competition_score,
      sc.opportunity_score,
      sc.ctr_gap,
      sc.performance_drift,
      sc.long_tail_indicator,
      n.branded_status,
      n.stability_status,
      n.tail_type,
      n.search_intent,
      n.exclude_from_opportunity,
      n.qualification_label,
      n.priority_level,
      n.action_hint,
      n.reasoning
    FROM keywords k
    LEFT JOIN gsc_daily g
      ON k.projectid = g.projectid
     AND k.keyword = g.keyword
     AND g.date = $1
    LEFT JOIN serp_daily s
      ON k.projectid = s.projectid
     AND k.keyword = s.keyword
     AND s.date = $2
    LEFT JOIN scores_daily sc
      ON k.projectid = sc.projectid
     AND k.keyword = sc.keyword
     AND sc.date = $3
    LEFT JOIN nlp_keyword_enrichment n
      ON k.projectid = n.projectid
     AND k.keyword = n.keyword
     AND n.date = $4
    WHERE k.projectid = $5
    ORDER BY k.id ASC
  `;

  try {
    const keywordsRes = await pool.query(query, [date, date, date, date, projectId]);
    res.json(keywordsRes.rows);
  } catch (err) {
    console.error("Get keywords error:", err);
    res.status(500).json({ error: "Failed to fetch keywords" });
  }
});

app.get("/api/dashboard", authenticate, async (req: any, res) => {
  const { projectId } = req.query;

  try {
    const params: any[] = [req.user.id];
    let projectFilter = "";
    let projectFilterWithAlias = "";

    if (projectId) {
      params.push(Number(projectId));
      projectFilter = ` AND p.id = $2 `;
      projectFilterWithAlias = ` AND k.projectid = $2 `;
    }

    const kpisQuery = `
      SELECT
        COUNT(DISTINCT k.id) AS total_keywords,
        COALESCE(SUM(g.clicks), 0) AS organic_traffic,
        COALESCE(ROUND(AVG(g.ctr)::numeric * 100, 2), 0) AS avg_ctr,
        COALESCE(ROUND(AVG(g.position)::numeric, 2), 0) AS avg_position
      FROM projects p
      LEFT JOIN keywords k ON k.projectid = p.id
      LEFT JOIN gsc_daily g ON g.projectid = p.id AND g.keyword = k.keyword
      WHERE p.userid = $1
      ${projectFilter}
    `;

    const trafficTrendQuery = `
      SELECT
        g.date,
        COALESCE(SUM(g.clicks), 0) AS traffic
      FROM gsc_daily g
      JOIN projects p ON p.id = g.projectid
      WHERE p.userid = $1
      ${projectFilter ? `AND g.projectid = $2` : ""}
      GROUP BY g.date
      ORDER BY g.date ASC
      LIMIT 30
    `;

    const brandedQuery = `
      SELECT
        CASE
          WHEN LOWER(COALESCE(n.branded_status, k.type, 'non-branded')) IN ('branded', 'brand') THEN 'Branded'
          ELSE 'Non-branded'
        END AS name,
        COUNT(*)::int AS value
      FROM keywords k
      JOIN projects p ON p.id = k.projectid
      LEFT JOIN LATERAL (
        SELECT ne.branded_status
        FROM nlp_keyword_enrichment ne
        WHERE ne.projectid = k.projectid
          AND ne.keyword = k.keyword
        ORDER BY ne.date DESC NULLS LAST
        LIMIT 1
      ) n ON true
      WHERE p.userid = $1
      ${projectFilterWithAlias}
      GROUP BY 1
      ORDER BY 1
    `;

    const alertsQuery = `
      WITH latest_scores AS (
        SELECT DISTINCT ON (s.projectid, s.keyword)
          s.projectid,
          s.keyword,
          s.date,
          s.performance_drift,
          s.opportunity_score,
          s.ctr_gap
        FROM scores_daily s
        JOIN projects p ON p.id = s.projectid
        WHERE p.userid = $1
        ${projectFilter ? `AND s.projectid = $2` : ""}
        ORDER BY s.projectid, s.keyword, s.date DESC
      )
      SELECT
        COUNT(*) FILTER (WHERE performance_drift <= -5) AS strong_drop,
        COUNT(*) FILTER (WHERE performance_drift > -5 AND performance_drift <= -2) AS to_watch,
        COUNT(*) FILTER (WHERE opportunity_score >= 0.5) AS opportunities
      FROM latest_scores
    `;

    const keywordsQuery = `
      SELECT
        k.id,
        k.projectid AS "projectId",
        k.keyword,
        k.volume,
        k.position,
        k.prev_position,
        k.impressions,
        k.ctr,
        k.prev_ctr,
        k.competition,
        k.trend,
        k.status,
        k.type,
        k.intent,
        n.branded_status,
        n.stability_status,
        n.tail_type,
        n.search_intent,
        n.exclude_from_opportunity,
        n.qualification_label,
        n.priority_level,
        n.action_hint,
        n.reasoning
      FROM keywords k
      JOIN projects p ON p.id = k.projectid
      LEFT JOIN LATERAL (
        SELECT *
        FROM nlp_keyword_enrichment ne
        WHERE ne.projectid = k.projectid
          AND ne.keyword = k.keyword
        ORDER BY ne.date DESC NULLS LAST
        LIMIT 1
      ) n ON true
      WHERE p.userid = $1
      ${projectFilterWithAlias}
      ORDER BY k.id ASC
    `;

    const [kpisRes, trafficRes, brandedRes, alertsRes, keywordsRes] = await Promise.all([
      pool.query(kpisQuery, params),
      pool.query(trafficTrendQuery, params),
      pool.query(brandedQuery, params),
      pool.query(alertsQuery, params),
      pool.query(keywordsQuery, params),
    ]);

    const kpisRow = kpisRes.rows[0] || {
      total_keywords: 0,
      organic_traffic: 0,
      avg_ctr: 0,
      avg_position: 0,
    };

    const pieRaw = brandedRes.rows || [];
    const totalPie = pieRaw.reduce((sum: number, item: any) => sum + Number(item.value || 0), 0);

    const pieData = pieRaw.map((item: any) => ({
      name: item.name,
      value: totalPie > 0 ? Math.round((Number(item.value) / totalPie) * 100) : 0,
      count: Number(item.value || 0),
    }));

    const chartData = (trafficRes.rows || []).map((row: any) => ({
      name: row.date ? String(row.date).slice(5).replace("-", "/") : "",
      traffic: Number(row.traffic || 0),
    }));

    const alertsRow = alertsRes.rows[0] || {
      strong_drop: 0,
      to_watch: 0,
      opportunities: 0,
    };

    res.json({
      kpis: {
        totalKeywords: Number(kpisRow.total_keywords || 0),
        organicTraffic: Number(kpisRow.organic_traffic || 0),
        avgCtr: Number(kpisRow.avg_ctr || 0),
        avgPosition: Number(kpisRow.avg_position || 0),
      },
      charts: {
        trafficTrend: chartData,
        brandedSplit: pieData,
      },
      alerts: {
        strongDrop: Number(alertsRow.strong_drop || 0),
        toWatch: Number(alertsRow.to_watch || 0),
        opportunities: Number(alertsRow.opportunities || 0),
      },
      keywords: keywordsRes.rows || [],
    });
  } catch (err) {
    console.error("Dashboard error:", err);
    res.status(500).json({ error: "Failed to fetch dashboard data" });
  }
});

app.get("/api/opportunities", authenticate, async (req: any, res) => {
  const { projectId } = req.query;

  try {
    const params: any[] = [req.user.id];
    let projectFilter = "";

    if (projectId) {
      params.push(Number(projectId));
      projectFilter = ` AND k.projectid = $2 `;
    }

    const query = `
      WITH latest_gsc AS (
        SELECT DISTINCT ON (g.projectid, g.keyword)
          g.projectid,
          g.keyword,
          g.date,
          g.impressions,
          g.clicks,
          g.position,
          g.ctr
        FROM gsc_daily g
        ORDER BY g.projectid, g.keyword, g.date DESC
      ),
      latest_serp AS (
        SELECT DISTINCT ON (s.projectid, s.keyword)
          s.projectid,
          s.keyword,
          s.date,
          s.position AS serp_position,
          s.competition,
          s.volume,
          s.cpc
        FROM serp_daily s
        ORDER BY s.projectid, s.keyword, s.date DESC
      ),
      latest_scores AS (
        SELECT DISTINCT ON (sc.projectid, sc.keyword)
          sc.projectid,
          sc.keyword,
          sc.date,
          sc.competition_score,
          sc.opportunity_score,
          sc.ctr_gap,
          sc.performance_drift,
          sc.long_tail_indicator
        FROM scores_daily sc
        ORDER BY sc.projectid, sc.keyword, sc.date DESC
      ),
      latest_nlp AS (
        SELECT DISTINCT ON (n.projectid, n.keyword)
          n.projectid,
          n.keyword,
          n.date,
          n.branded_status,
          n.stability_status,
          n.tail_type,
          n.search_intent,
          n.exclude_from_opportunity,
          n.qualification_label,
          n.priority_level,
          n.action_hint,
          n.reasoning
        FROM nlp_keyword_enrichment n
        ORDER BY n.projectid, n.keyword, n.date DESC
      )
      SELECT
        k.id,
        k.projectid AS "projectId",
        k.keyword,
        COALESCE(ls.volume, k.volume, 0) AS volume,
        COALESCE(lg.position, k.position, 0) AS position,
        COALESCE(ls.competition, k.competition, 0) AS competition,
        COALESCE(k.trend, 0) AS trend,
        COALESCE(lg.impressions, k.impressions, 0) AS impressions,
        COALESCE(lg.ctr, k.ctr, 0) AS ctr,
        COALESCE(sc.competition_score, ls.competition, k.competition, 0) AS competition_score,
        COALESCE(sc.opportunity_score, 0) AS opportunity_score,
        COALESCE(sc.ctr_gap, 0) AS ctr_gap,
        COALESCE(sc.performance_drift, 0) AS performance_drift,
        COALESCE(
          sc.long_tail_indicator,
          CASE WHEN array_length(string_to_array(k.keyword, ' '), 1) > 3 THEN 1 ELSE 0 END
        ) AS long_tail_indicator,
        COALESCE(ln.branded_status, k.type, 'non-branded') AS branded_status,
        COALESCE(ln.stability_status, k.status, 'opportunity') AS stability_status,
        COALESCE(ln.tail_type, 'generic') AS tail_type,
        COALESCE(ln.search_intent, k.intent, 'informationnelle') AS search_intent,
        COALESCE(ln.exclude_from_opportunity, false) AS exclude_from_opportunity,
        ln.qualification_label,
        ln.priority_level,
        ln.action_hint,
        ln.reasoning
      FROM keywords k
      JOIN projects p ON p.id = k.projectid
      LEFT JOIN latest_gsc lg
        ON lg.projectid = k.projectid
       AND lg.keyword = k.keyword
      LEFT JOIN latest_serp ls
        ON ls.projectid = k.projectid
       AND ls.keyword = k.keyword
      LEFT JOIN latest_scores sc
        ON sc.projectid = k.projectid
       AND sc.keyword = k.keyword
      LEFT JOIN latest_nlp ln
        ON ln.projectid = k.projectid
       AND ln.keyword = k.keyword
      WHERE p.userid = $1
      ${projectFilter}
      ORDER BY
        COALESCE(sc.opportunity_score, 0) DESC,
        COALESCE(ls.volume, k.volume, 0) DESC,
        COALESCE(ls.competition, k.competition, 0) ASC
      LIMIT 100
    `;

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error("Opportunities error:", err);
    res.status(500).json({ error: "Failed to fetch opportunities" });
  }
});

app.post("/api/nlp/qualify", authenticate, async (req: any, res) => {
  const { projectId, keywords, date } = req.body;

  if (!projectId || !keywords || !Array.isArray(keywords)) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  const prompt = `Tu es le module "ML & NLP Intelligence" d’une plateforme SaaS SEO.
Analyse et enrichis les mots-clés suivants pour la qualification automatique.

Données (JSON): ${JSON.stringify(keywords)}

Ta mission :
1) Qualification multi-dimension :
   - branded_status: branded|non_branded
   - stability_status: stable|opportunity
   - tail_type: long_tail|generic
   - search_intent: informationnelle|transactionnelle|navigationnelle

2) Filtrage stratégique :
   - exclude_from_opportunity: true si branded ET stable, sinon false

3) Sortie :
   - qualification_label
   - priority_level (low|medium|high)
   - action_hint
   - kpi_interpretation (objet simple avec 3 à 5 clés max)
   - reasoning

RETOURNE UNIQUEMENT UN TABLEAU JSON avec ces clés :
keyword, branded_status, stability_status, tail_type, search_intent, exclude_from_opportunity, qualification_label, priority_level, action_hint, kpi_interpretation, reasoning`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: { responseMimeType: "application/json" },
    });

    const results = JSON.parse(response.text || "[]");

    for (const item of results) {
      await pool.query(
        `
        INSERT INTO nlp_keyword_enrichment (
          projectid, keyword, date, branded_status, stability_status, tail_type,
          search_intent, exclude_from_opportunity, qualification_label, priority_level,
          action_hint, reasoning
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        ON CONFLICT(projectid, keyword, date)
        DO UPDATE SET
          branded_status = EXCLUDED.branded_status,
          stability_status = EXCLUDED.stability_status,
          tail_type = EXCLUDED.tail_type,
          search_intent = EXCLUDED.search_intent,
          exclude_from_opportunity = EXCLUDED.exclude_from_opportunity,
          qualification_label = EXCLUDED.qualification_label,
          priority_level = EXCLUDED.priority_level,
          action_hint = EXCLUDED.action_hint,
          reasoning = EXCLUDED.reasoning
        `,
        [
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
          JSON.stringify({ ...(item.kpi_interpretation || {}), reasoning: item.reasoning || "" }),
        ]
      );
    }

    res.json({ success: true, results });
  } catch (err) {
    console.error("NLP Qualify error:", err);
    res.status(500).json({ error: "Failed to qualify keywords" });
  }
});

app.post("/api/nlp/save-enrichment", authenticate, async (req: any, res) => {
  const { results } = req.body;

  if (!results || !Array.isArray(results)) {
    return res.status(400).json({ error: "Invalid data" });
  }

  try {
    for (const item of results) {
      await pool.query(
        `
        INSERT INTO nlp_keyword_enrichment (
          projectid, keyword, date, branded_status, stability_status, tail_type,
          search_intent, exclude_from_opportunity, qualification_label, priority_level,
          action_hint, reasoning
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        ON CONFLICT(projectid, keyword, date)
        DO UPDATE SET
          branded_status = EXCLUDED.branded_status,
          stability_status = EXCLUDED.stability_status,
          tail_type = EXCLUDED.tail_type,
          search_intent = EXCLUDED.search_intent,
          exclude_from_opportunity = EXCLUDED.exclude_from_opportunity,
          qualification_label = EXCLUDED.qualification_label,
          priority_level = EXCLUDED.priority_level,
          action_hint = EXCLUDED.action_hint,
          reasoning = EXCLUDED.reasoning
        `,
        [
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
          item.reasoning,
        ]
      );
    }

    res.json({ success: true });
  } catch (err) {
    console.error("Save enrichment error:", err);
    res.status(500).json({ error: "Failed to save enrichment" });
  }
});

app.get("/api/calendar", authenticate, async (req: any, res) => {
  try {
    const eventsRes = await pool.query(
      `SELECT
        e.id,
        e.projectid AS "projectId",
        e.title,
        e.description,
        e.start_date,
        e.end_date,
        e.type
      FROM events e
      JOIN projects p ON e.projectid = p.id
      WHERE p.userid = $1
      ORDER BY e.start_date ASC`,
      [req.user.id]
    );

    res.json(eventsRes.rows);
  } catch (err) {
    console.error("Get calendar error:", err);
    res.status(500).json({ error: "Failed to fetch calendar events" });
  }
});

app.post("/api/calendar", authenticate, async (req: any, res) => {
  const { projectId, title, description, start_date, end_date, type } = req.body;

  try {
    await pool.query(
      `INSERT INTO events
       (projectid, title, description, start_date, end_date, type)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [projectId, title, description, start_date, end_date, type]
    );

    res.json({ success: true });
  } catch (err) {
    console.error("Add event error:", err);
    res.status(500).json({ error: "Failed to add event" });
  }
});

app.post("/api/projects/:projectId/cluster", authenticate, async (req: any, res) => {
  const { projectId } = req.params;

  try {
    const keywordsRes = await pool.query("SELECT keyword FROM keywords WHERE projectid = $1", [projectId]);
    const keywords = keywordsRes.rows;

    if (keywords.length === 0) {
      return res.json({ success: true, clusters: [] });
    }

    const keywordList = keywords.map((k: any) => k.keyword).join(", ");
    const prompt = `Tu es un expert SEO. Regroupe les mots-clés suivants en clusters sémantiques logiques.
Pour chaque cluster, donne un nom, une brève description, la liste des mots-clés et un niveau de priorité (High, Medium, Low).
Mots-clés: ${keywordList}
RETOURNE UNIQUEMENT UN TABLEAU JSON d'objets avec ces clés: cluster_name, description, keywords (array), priority`;

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: { responseMimeType: "application/json" },
    });

    const clusters = JSON.parse(response.text || "[]");

    await pool.query("DELETE FROM keyword_clusters WHERE projectid = $1", [projectId]);

    for (const c of clusters) {
      await pool.query(
        `INSERT INTO keyword_clusters
         (projectid, cluster_name, keywords, description, priority)
         VALUES ($1, $2, $3, $4, $5)`,
        [projectId, c.cluster_name, JSON.stringify(c.keywords), c.description, c.priority]
      );
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
    const clustersRes = await pool.query(
      `SELECT
        id,
        projectid AS "projectId",
        cluster_name,
        keywords,
        description,
        priority,
        created_at
      FROM keyword_clusters
      WHERE projectid = $1
      ORDER BY created_at DESC`,
      [projectId]
    );

    res.json(
      clustersRes.rows.map((c: any) => ({
        ...c,
        keywords: JSON.parse(c.keywords),
      }))
    );
  } catch (err) {
    console.error("Get clusters error:", err);
    res.status(500).json({ error: "Failed to fetch clusters" });
  }
});

app.get("/api/projects/:projectId/action-plan", authenticate, async (req: any, res) => {
  const { projectId } = req.params;

  try {
    const keywordsRes = await pool.query(
      `
      SELECT
        k.keyword,
        g.position,
        g.ctr,
        s.volume,
        sc.opportunity_score,
        n.action_hint
      FROM keywords k
      LEFT JOIN gsc_daily g
        ON k.projectid = g.projectid
       AND k.keyword = g.keyword
      LEFT JOIN serp_daily s
        ON k.projectid = s.projectid
       AND k.keyword = s.keyword
      LEFT JOIN scores_daily sc
        ON k.projectid = sc.projectid
       AND k.keyword = sc.keyword
      LEFT JOIN nlp_keyword_enrichment n
        ON k.projectid = n.projectid
       AND k.keyword = n.keyword
      WHERE k.projectid = $1
      ORDER BY sc.opportunity_score DESC NULLS LAST
      LIMIT 20
      `,
      [projectId]
    );

    const keywords = keywordsRes.rows;

    const prompt = `Analyse les données SEO suivantes pour le projet ${projectId} et génère un plan d'action de 5 points prioritaires pour améliorer le trafic.
Données: ${JSON.stringify(keywords)}
RETOURNE UNIQUEMENT UN TABLEAU JSON d'objets avec ces clés: title, description, priority (High|Medium|Low), impact (High|Medium|Low)`;

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: { responseMimeType: "application/json" },
    });

    const plan = JSON.parse(response.text || "[]");
    res.json(plan);
  } catch (err) {
    console.error("Action Plan error:", err);
    res.status(500).json({ error: "Failed to generate action plan" });
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
