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
        branded_keywords TEXT,
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

    // Add is_tracked column if not exists (idempotent migration)
    await pool.query(`
      ALTER TABLE keywords
      ADD COLUMN IF NOT EXISTS is_tracked BOOLEAN DEFAULT FALSE;
    `);

    // Add branded_keywords to projects (idempotent migration)
    await pool.query(`
      ALTER TABLE projects
      ADD COLUMN IF NOT EXISTS branded_keywords TEXT;
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


// ─────────────────────────────────────────────────────────────────────────────
// NLP HELPERS — Classification par règles locales (sans LLM, instantané)
// FIX: Garantit la diversité des intents même si le LLM échoue ou n'est pas appelé
// ─────────────────────────────────────────────────────────────────────────────

const TRANSACTIONAL_SIGNALS = [
  "acheter","achat","commander","commande","prix","tarif","tarifs","devis",
  "promo","promotion","solde","soldes","reduction","réduction","pas cher",
  "bon marché","moins cher","offre","offres","livraison","expédition",
  "boutique","shop","store","abonnement","forfait","comparatif","comparaison",
  "meilleur prix","inscription","essai gratuit","télécharger","download","installer",
];

const NAVIGATIONAL_SIGNALS = [
  "connexion","login","se connecter","mon compte","espace client",
  "espace personnel","tableau de bord","dashboard","accueil","accès",
  ".com",".fr","officiel","site officiel","portail","compte",
];

const INFORMATIONAL_SIGNALS = [
  "comment","pourquoi","qu'est","qu est","c'est quoi","c est quoi",
  "définition","definition","guide","tutoriel","tutorial","apprendre",
  "comprendre","expliquer","explication","différence","difference",
  "vs "," vs","versus","que faire","quand ","où ","qui est",
  "histoire de","signification",
];

function classifyByRules(
  keyword: string,
  brandedKeywords: string[] = []
): {
  search_intent: "informationnelle" | "transactionnelle" | "navigationnelle";
  branded_status: "branded" | "non_branded";
  tail_type: "long_tail" | "generic";
  confidence: "high" | "medium" | "low";
} {
  const kw = keyword.toLowerCase().trim();
  const words = kw.split(/\s+/);
  const branded_status = brandedKeywords.some((b) => kw.includes(b.toLowerCase()))
    ? "branded" : "non_branded";
  const tail_type: "long_tail" | "generic" = words.length >= 4 ? "long_tail" : "generic";
  const tScore = TRANSACTIONAL_SIGNALS.filter((s) => kw.includes(s)).length;
  const nScore = NAVIGATIONAL_SIGNALS.filter((s) => kw.includes(s)).length;
  const iScore = INFORMATIONAL_SIGNALS.filter((s) => kw.includes(s)).length;
  let search_intent: "informationnelle" | "transactionnelle" | "navigationnelle";
  let confidence: "high" | "medium" | "low";
  if (tScore > 0) {
    search_intent = "transactionnelle";
    confidence = tScore >= 2 ? "high" : "medium";
  } else if (nScore > 0) {
    search_intent = "navigationnelle";
    confidence = nScore >= 2 ? "high" : "medium";
  } else if (iScore > 0) {
    search_intent = "informationnelle";
    confidence = iScore >= 2 ? "high" : "medium";
  } else {
    search_intent = words.length <= 2 ? "navigationnelle" : "informationnelle";
    confidence = "low";
  }
  return { search_intent, branded_status, tail_type, confidence };
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
        normalizeDate(item.date),   // FIX: normalize ISO dates to YYYY-MM-DD
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
    console.log("DATA", data);

    data.forEach((item, i) => {
      const idx = i * 17;
      placeholders.push(
        `($${idx + 1}, $${idx + 2}, $${idx + 3}, $${idx + 4}, $${idx + 5}, $${idx + 6}, $${idx + 7}, $${idx + 8}, $${idx + 9}, $${idx + 10}, $${idx + 11}, $${idx + 12}, $${idx + 13}, $${idx + 14}, $${idx + 15}, $${idx + 16}, $${idx + 17})`
      );

      values.push(
        Number(projectId),
        item.keyword,
        normalizeDate(item.date),   // FIX: normalize ISO dates to YYYY-MM-DD
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

// ─────────────────────────────────────────────────────────────────────────────
// KPI HELPERS
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// KPI COMPUTATION — GSC-FIRST
// Tous les KPIs sont calculables uniquement avec les données GSC.
// SERP est utilisé en bonus si disponible, jamais requis.
//
// Formules basées uniquement sur GSC :
//   position    → proxy de visibilité + ctr_gap
//   ctr         → performance réelle vs benchmark
//   impressions → proxy du volume de recherche
//   clicks      → trafic organique réel
//   drift       → comparaison J vs J-1
// ─────────────────────────────────────────────────────────────────────────────

// Benchmark CTR par position (Backlinko / AWR)
const EXPECTED_CTR_BY_POSITION: Record<number, number> = {
  1: 0.284, 2: 0.151, 3: 0.103, 4: 0.073, 5: 0.057,
  6: 0.045, 7: 0.036, 8: 0.030, 9: 0.025, 10: 0.021,
};

function getExpectedCtr(position: number): number {
  const pos = Math.max(1, Math.min(10, Math.round(Number(position) || 10)));
  return EXPECTED_CTR_BY_POSITION[pos] ?? 0.01;
}

function normalizeDate(d: any): string {
  return String(d || "").slice(0, 10);
}

// competition_score — GSC-first
// Sans données SERP : estimé depuis la position GSC
// Avec données SERP : enrichi avec PAA, AI Overview, domaines
function computeCompetitionScore(gscRow: any, serpRow?: any): number {
  const pos = Number(gscRow?.position) || 50;

  // Estimation depuis la position GSC seule :
  // Plus la position est haute (proche de 1), plus la compétition est forte
  let score: number;
  if (pos <= 3)       score = 0.85;
  else if (pos <= 5)  score = 0.70;
  else if (pos <= 10) score = 0.55;
  else if (pos <= 20) score = 0.40;
  else if (pos <= 30) score = 0.30;
  else                score = 0.20;

  // Bonus SERP si disponible (optionnel)
  if (serpRow) {
    const rawComp = Number(serpRow.competition);
    if (rawComp > 0) {
      // Moyenne pondérée : 60% position GSC + 40% competition SERP
      score = score * 0.6 + rawComp * 0.4;
    }
    if (serpRow.ai_overview_present === true || serpRow.ai_overview_present === "true") score = Math.min(1, score + 0.10);
    const paa = Number(serpRow.paa_count ?? 0);
    if (paa >= 4) score = Math.min(1, score + 0.08);
    else if (paa >= 2) score = Math.min(1, score + 0.04);
  }

  return Math.round(score * 1000) / 1000;
}

// ctr_gap = CTR attendu selon position - CTR réel GSC
// Toujours calculable avec GSC seul
function computeCtrGap(position: number, realCtr: number): number {
  const expected = getExpectedCtr(Number(position) || 20);
  const real = Number(realCtr) || 0;
  return Math.round((expected - real) * 10000) / 10000;
}

// opportunity_score — 100% basé sur GSC
// Logique :
//   (1) position améliorable = entre 4 et 50
//   (2) ctr en dessous du benchmark = marge de gain
//   (3) impressions = proxy du volume (plus d'impressions = plus de trafic potentiel)
//   (4) long_tail = bonus (moins de concurrence)
//
// Score final : 0 à 1, jamais 0 si la position est améliorable
function computeOpportunityScore(params: {
  position: number;
  ctr: number;
  impressions: number;
  ctr_gap: number;
  competition_score: number;
  long_tail_indicator: number;
  clicks: number;
  // SERP optionnel — utilisé si volume disponible
  volume?: number;
}): number {
  const { position, ctr, impressions, ctr_gap, competition_score, long_tail_indicator, clicks, volume } = params;

  const pos  = Number(position)   || 50;
  const imp  = Number(impressions)|| 0;
  const gap  = Number(ctr_gap)    || 0;
  const comp = Number(competition_score) || 0.5;

  // Seules les positions améliorables comptent
  if (pos < 4 || pos > 50) return 0;
  // Pas d'impressions = pas de visibilité = pas d'opportunité calculable
  if (imp === 0) return 0;

  // ── Composante 1 : Potentiel CTR (toujours dispo via GSC) ────────────────
  // gap > 0 = on est sous le benchmark → on peut gagner du CTR
  const ctrPotential = Math.max(0, gap);

  // ── Composante 2 : Potentiel de position (position améliorable) ──────────
  // Plus on est loin de la position 1, plus le gain potentiel est grand
  // Normalisé entre 0 et 1
  const positionPotential = Math.min(1, (pos - 3) / 47);

  // ── Composante 3 : Poids du volume (impressions GSC ou volume SERP) ──────
  // On utilise le volume SERP si disponible et > 0, sinon les impressions GSC
  const vol = (volume && volume > 0) ? volume : imp;
  // Normalisation logarithmique pour éviter que les gros volumes écrasent tout
  // log10(1000 imp) = 3, log10(100) = 2, log10(10) = 1
  const volumeWeight = Math.min(1, Math.log10(Math.max(1, vol)) / 4); // max à 10 000

  // ── Score final ──────────────────────────────────────────────────────────
  // (1 - comp) = espace disponible sur le marché
  // ctrPotential = marge de gain CTR
  // positionPotential = distance à améliorer
  // volumeWeight = importance de la requête
  let score = (1 - comp) * (ctrPotential + positionPotential * 0.3) * volumeWeight;

  // Bonus long tail
  if (long_tail_indicator === 1) score *= 1.25;

  return Math.min(1, Math.round(score * 10000) / 10000);
}

app.post("/api/compute/kpis", checkApiKey, async (req, res) => {
  const { projectId, date } = req.body;
  if (!projectId || !date) return res.status(400).json({ error: "projectId and date are required" });

  const nd = normalizeDate(date);
  console.log(`\n[KPI] ▶ START compute/kpis projectId=${projectId} date=${nd}`);

  try {
    const exists = await ensureProjectExists(Number(projectId));
    if (!exists) return res.status(404).json({ error: `Project ${projectId} not found` });

    // GSC = source principale (toujours requise)
    // SERP = source optionnelle (enrichissement si disponible)
    // Jour précédent = pour le performance_drift
    const [gscRes, serpRes, prevGscRes] = await Promise.all([
      pool.query(
        `SELECT * FROM gsc_daily WHERE projectid=$1 AND LEFT(date::text,10)=$2`,
        [projectId, nd]
      ),
      pool.query(
        `SELECT keyword, competition, volume, paa_count, ai_overview_present, serp_top3_domains
         FROM serp_daily WHERE projectid=$1 AND LEFT(date::text,10)=$2`,
        [projectId, nd]
      ),
      pool.query(
        `SELECT keyword, position, ctr, impressions, clicks
         FROM gsc_daily
         WHERE projectid=$1
           AND LEFT(date::text,10) = (($2::date) - interval '1 day')::text`,
        [projectId, nd]
      ),
    ]);

    const gscData = gscRes.rows;
    const serpData = serpRes.rows;

    console.log(`[KPI] GSC rows    : ${gscData.length}`);
    console.log(`[KPI] SERP rows   : ${serpData.length} (optionnel)`);
    if (gscData.length > 0) {
      const s = gscData[0];
      console.log(`[KPI] GSC sample  : keyword="${s.keyword}" pos=${s.position} ctr=${s.ctr} imp=${s.impressions} clicks=${s.clicks}`);
    }

    if (gscData.length === 0) {
      console.warn(`[KPI] ⚠ NO GSC DATA for project=${projectId} date=${nd}`);
      return res.json({ success: true, count: 0, warning: `No GSC data for project ${projectId} on ${nd}` });
    }

    // Maps pour accès O(1)
    const serpMap = new Map<string, any>(serpData.map((s: any) => [s.keyword, s]));
    const prevGscMap = new Map<string, any>(prevGscRes.rows.map((r: any) => [r.keyword, r]));

    const results: any[] = [];
    let serpMatchCount = 0;

    for (const g of gscData) {
      const s = serpMap.get(g.keyword) || null;
      if (s) serpMatchCount++;

      const position    = Number(g.position)    || 50;
      const realCtr     = Number(g.ctr)         || 0;
      const impressions = Number(g.impressions) || 0;
      const clicks      = Number(g.clicks)      || 0;
      const long_tail   = g.keyword.trim().split(/\s+/).length > 3 ? 1 : 0;

      // Tous les KPIs calculés depuis GSC, SERP en bonus
      const competition_score = computeCompetitionScore(g, s);
      const ctr_gap           = computeCtrGap(position, realCtr);
      const volume            = s ? Number(s.volume ?? 0) : 0;

      const opportunity_score = computeOpportunityScore({
        position, ctr: realCtr, impressions, ctr_gap,
        competition_score, long_tail_indicator: long_tail,
        clicks, volume,
      });

      // performance_drift = variation de position par rapport à J-1
      // Positif = amélioration (position qui descend numériquement)
      const prev = prevGscMap.get(g.keyword);
      const performance_drift = prev
        ? Number(prev.position) - position
        : 0;

      results.push({
        projectId, keyword: g.keyword, date: nd,
        competition_score, opportunity_score,
        ctr_gap, performance_drift,
        long_tail_indicator: long_tail,
      });
    }

    // Logs de contrôle
    const nonZeroOpp  = results.filter((r) => r.opportunity_score  > 0).length;
    const nonZeroComp = results.filter((r) => r.competition_score  > 0).length;
    console.log(`[KPI] SERP enrichment : ${serpMatchCount}/${gscData.length} keywords enriched`);
    console.log(`[KPI] non-zero opp    : ${nonZeroOpp}/${results.length}`);
    console.log(`[KPI] non-zero comp   : ${nonZeroComp}/${results.length}`);
    if (results.length > 0) {
      const r = results[0];
      console.log(`[KPI] Sample → keyword="${r.keyword}" opp=${r.opportunity_score} comp=${r.competition_score} gap=${r.ctr_gap} drift=${r.performance_drift}`);
    }

    if (results.length === 0) return res.json({ success: true, count: 0 });

    // Batch upsert
    const values = results.flatMap((item) => [
      item.projectId, item.keyword, item.date,
      item.competition_score, item.opportunity_score,
      item.ctr_gap, item.performance_drift, item.long_tail_indicator,
    ]);
    const placeholders = results
      .map((_, i) => `($${i*8+1},$${i*8+2},$${i*8+3},$${i*8+4},$${i*8+5},$${i*8+6},$${i*8+7},$${i*8+8})`)
      .join(",");

    await pool.query(
      `INSERT INTO scores_daily
         (projectid,keyword,date,competition_score,opportunity_score,ctr_gap,performance_drift,long_tail_indicator)
       VALUES ${placeholders}
       ON CONFLICT (projectid,keyword,date) DO UPDATE SET
         competition_score   = EXCLUDED.competition_score,
         opportunity_score   = EXCLUDED.opportunity_score,
         ctr_gap             = EXCLUDED.ctr_gap,
         performance_drift   = EXCLUDED.performance_drift,
         long_tail_indicator = EXCLUDED.long_tail_indicator`,
      values
    );

    console.log(`[KPI] ✓ Upserted ${results.length} rows into scores_daily\n`);
    res.json({
      success: true,
      count: results.length,
      serpEnrichment: `${serpMatchCount}/${gscData.length}`,
      nonZeroOpportunity: nonZeroOpp,
    });
  } catch (err) {
    console.error("[KPI] ✗ Compute error:", err);
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
       AND LEFT(g.date::text,10) = $1
      LEFT JOIN serp_daily s
        ON k.projectid = s.projectid
       AND k.keyword = s.keyword
       AND LEFT(s.date::text,10) = $1
      LEFT JOIN scores_daily sc
        ON k.projectid = sc.projectid
       AND k.keyword = sc.keyword
       AND LEFT(sc.date::text,10) = $1
      LEFT JOIN nlp_keyword_enrichment n
        ON k.projectid = n.projectid
       AND k.keyword = n.keyword
       AND LEFT(n.date::text,10) = $1
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
     AND LEFT(g.date::text,10) = $1
    LEFT JOIN serp_daily s
      ON k.projectid = s.projectid
     AND k.keyword = s.keyword
     AND LEFT(s.date::text,10) = $2
    LEFT JOIN scores_daily sc
      ON k.projectid = sc.projectid
     AND k.keyword = sc.keyword
     AND LEFT(sc.date::text,10) = $3
    LEFT JOIN nlp_keyword_enrichment n
      ON k.projectid = n.projectid
     AND k.keyword = n.keyword
     AND LEFT(n.date::text,10) = $4
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
        ln.reasoning,
        COALESCE(k.is_tracked, false) AS is_tracked
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

  console.log(`\n[NLP] \u25b6 qualify ${keywords.length} keywords for project ${projectId}`);

  // Branded keywords du projet pour la détection locale
  let brandedKeywords: string[] = [];
  try {
    const projRes = await pool.query("SELECT branded_keywords FROM projects WHERE id=$1", [projectId]);
    if (projRes.rows[0]?.branded_keywords) {
      brandedKeywords = String(projRes.rows[0].branded_keywords)
        .split(/[,\n]/).map((k: string) => k.trim()).filter(Boolean);
    }
  } catch (_) {}

  // Étape 1 — classification par règles locales (instantané, sans LLM)
  // FIX: garantit la diversité des intents même si le LLM échoue
  const ruleResults = keywords.map((item: any) => ({
    ...item,
    ...classifyByRules(item.keyword || "", brandedKeywords),
  }));

  // Étape 2 — enrichissement LLM pour les keywords à faible confiance uniquement
  const lowConf = ruleResults.filter((r: any) => r.confidence === "low");
  console.log(`[NLP] Rules: ${ruleResults.length - lowConf.length} high/med, ${lowConf.length} low → LLM`);

  const llmMap = new Map<string, any>();

  if (lowConf.length > 0) {
    try {
      const prompt = `Tu es un expert NLP SEO. Analyse ces mots-clés et retourne leur classification.

Données (JSON): ${JSON.stringify(lowConf.map((r: any) => ({
        keyword: r.keyword,
        position: r.position || 0,
        ctr: r.ctr || 0,
        cpc: r.cpc || 0,
        volume: r.volume || 0,
        opportunity_score: r.opportunity_score || 0,
      })))}

RÈGLES :
search_intent — UN seul parmi :
  "transactionnelle" → acheter, prix, devis, commander, tarif, promo, pas cher, livraison, abonnement
  "navigationnelle"  → accès direct à un site/marque, connexion, login, espace client
  "informationnelle" → apprendre, comprendre, guide, comment, pourquoi, définition

branded_status : "branded" si nom de marque, sinon "non_branded"
stability_status : "stable" si position<=10 ET ctr>0.05, sinon "opportunity"
priority_level : "high" si opp_score>0.5 ou (pos 4-15 et vol>500), "medium" si 0.1-0.5, "low" sinon
qualification_label : phrase courte (ex: "Opportunité long-tail commerciale")
action_hint : action SEO concrète (ex: "Optimiser le titre avec le mot prix")
reasoning : 1-2 phrases max

RETOURNE UNIQUEMENT ce tableau JSON valide :
[{"keyword","search_intent","branded_status","stability_status","priority_level","qualification_label","action_hint","reasoning"}]`;

      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: prompt,
        config: { responseMimeType: "application/json" },
      });

      let rawText = (response.text || "[]").trim()
        .replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/i, "").trim();

      const parsed = JSON.parse(rawText);
      if (Array.isArray(parsed)) {
        parsed.forEach((item: any) => { if (item.keyword) llmMap.set(item.keyword, item); });
        console.log(`[NLP] LLM enriched ${llmMap.size}/${lowConf.length}`);
      }
    } catch (llmErr) {
      console.error("[NLP] LLM failed, using rules only:", llmErr);
    }
  }

  // Étape 3 — fusion règles + LLM
  const VALID_INTENTS   = ["informationnelle","transactionnelle","navigationnelle"];
  const VALID_BRANDED   = ["branded","non_branded"];
  const VALID_STABILITY = ["stable","opportunity"];
  const VALID_PRIORITY  = ["low","medium","high"];

  const finalResults = ruleResults.map((ruleItem: any) => {
    const llm = llmMap.get(ruleItem.keyword);
    const search_intent = llm && VALID_INTENTS.includes(llm.search_intent)
      ? llm.search_intent : ruleItem.search_intent;
    const branded_status = llm && VALID_BRANDED.includes(llm.branded_status)
      ? llm.branded_status : ruleItem.branded_status;
    const stability = llm && VALID_STABILITY.includes(llm.stability_status)
      ? llm.stability_status
      : (Number(ruleItem.position||50) > 10 || Number(ruleItem.ctr||0) <= 0.05 ? "opportunity" : "stable");
    const priority = llm && VALID_PRIORITY.includes(llm.priority_level)
      ? llm.priority_level
      : (Number(ruleItem.opportunity_score||0) > 0.5 ? "high"
         : Number(ruleItem.opportunity_score||0) > 0.1 ? "medium" : "low");
    const words = (ruleItem.keyword||"").trim().split(/\s+/).length;
    const tail_type = words >= 4 ? "long_tail" : "generic";
    const exclude_from_opportunity = branded_status === "branded" && stability === "stable";

    console.log(`[NLP] "${ruleItem.keyword}" → intent=${search_intent} branded=${branded_status} priority=${priority}`);

    return {
      keyword: ruleItem.keyword,
      search_intent, branded_status,
      stability_status: stability,
      tail_type, exclude_from_opportunity,
      priority_level: priority,
      qualification_label: llm?.qualification_label || `${search_intent} / ${tail_type}`,
      action_hint: llm?.action_hint || "Analyser et optimiser le contenu existant",
      reasoning: llm?.reasoning || `Classifié par règles (confidence: ${ruleItem.confidence})`,
      kpi_interpretation: {
        search_intent: `Intent: ${search_intent}${llm ? " (LLM)" : " (règles)"}`,
        branded: `Branded: ${branded_status}`,
        tail: `Type: ${tail_type} (${words} mots)`,
      },
    };
  });

  // Étape 4 — upsert en base
  const today = normalizeDate(date || new Date().toISOString());
  let savedCount = 0;

  for (const item of finalResults) {
    try {
      await pool.query(
        `INSERT INTO nlp_keyword_enrichment
           (projectid,keyword,date,branded_status,stability_status,tail_type,
            search_intent,exclude_from_opportunity,qualification_label,priority_level,
            action_hint,reasoning)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT(projectid,keyword,date) DO UPDATE SET
           branded_status=EXCLUDED.branded_status,
           stability_status=EXCLUDED.stability_status,
           tail_type=EXCLUDED.tail_type,
           search_intent=EXCLUDED.search_intent,
           exclude_from_opportunity=EXCLUDED.exclude_from_opportunity,
           qualification_label=EXCLUDED.qualification_label,
           priority_level=EXCLUDED.priority_level,
           action_hint=EXCLUDED.action_hint,
           reasoning=EXCLUDED.reasoning`,
        [
          projectId, item.keyword, today,
          item.branded_status, item.stability_status, item.tail_type,
          item.search_intent, item.exclude_from_opportunity,
          item.qualification_label, item.priority_level,
          item.action_hint,
          JSON.stringify({ ...item.kpi_interpretation, reasoning: item.reasoning }),
        ]
      );
      savedCount++;
    } catch (dbErr) {
      console.error(`[NLP] DB error for "${item.keyword}":`, dbErr);
    }
  }

  const intentDist = finalResults.reduce((acc: any, r) => {
    acc[r.search_intent] = (acc[r.search_intent] || 0) + 1;
    return acc;
  }, {});
  console.log(`[NLP] \u2713 Saved ${savedCount}/${finalResults.length} | Distribution:`, intentDist);

  res.json({ success: true, results: finalResults, intentDistribution: intentDist });
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

// ── Keyword Track / Untrack ───────────────────────────────────────────────
// These routes were called by Opportunities.tsx but didn't exist in the backend.
// They toggle the is_tracked boolean on the keywords table.

app.post("/api/keywords/:keywordId/track", authenticate, async (req: any, res) => {
  const { keywordId } = req.params;
  try {
    // Verify ownership via project join
    const check = await pool.query(
      `SELECT k.id FROM keywords k
       JOIN projects p ON p.id = k.projectid
       WHERE k.id = $1 AND p.userid = $2`,
      [keywordId, req.user.id]
    );
    if (check.rows.length === 0) {
      return res.status(404).json({ error: "Keyword not found" });
    }
    await pool.query(
      "UPDATE keywords SET is_tracked = TRUE WHERE id = $1",
      [keywordId]
    );
    res.json({ success: true, is_tracked: true });
  } catch (err) {
    console.error("Track keyword error:", err);
    res.status(500).json({ error: "Failed to track keyword" });
  }
});

app.post("/api/keywords/:keywordId/untrack", authenticate, async (req: any, res) => {
  const { keywordId } = req.params;
  try {
    const check = await pool.query(
      `SELECT k.id FROM keywords k
       JOIN projects p ON p.id = k.projectid
       WHERE k.id = $1 AND p.userid = $2`,
      [keywordId, req.user.id]
    );
    if (check.rows.length === 0) {
      return res.status(404).json({ error: "Keyword not found" });
    }
    await pool.query(
      "UPDATE keywords SET is_tracked = FALSE WHERE id = $1",
      [keywordId]
    );
    res.json({ success: true, is_tracked: false });
  } catch (err) {
    console.error("Untrack keyword error:", err);
    res.status(500).json({ error: "Failed to untrack keyword" });
  }
});

// ── Opportunities Reset (triggers n8n workflow) ────────────────────────────
// Was called by resetFilters() in Opportunities.tsx but didn't exist.
// Delegates to the generic n8n trigger route internally.

app.post("/api/opportunities/reset", authenticate, async (req: any, res) => {
  const N8N_BASE_URL = process.env.N8N_BASE_URL || "https://n8n.srv770401.hstgr.cloud";
  const webhookUrl = `${N8N_BASE_URL}/webhook/reset-collecte`;

  try {
    const n8nResponse = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        triggeredBy: req.user?.email || "unknown",
        projectId: req.body?.projectId || null,
        timestamp: new Date().toISOString(),
      }),
    });

    const responseText = await n8nResponse.text();

    if (!n8nResponse.ok) {
      console.error("n8n reset-collecte error:", n8nResponse.status, responseText);
      let userMessage: string;
      if (n8nResponse.status === 404) {
        userMessage = `Workflow "reset-collecte" introuvable dans n8n. Vérifiez que le workflow est ACTIF (toggle vert dans l'éditeur n8n) et que le chemin du webhook est exactement "reset-collecte".`;
      } else {
        userMessage = `Erreur n8n (${n8nResponse.status}). Vérifiez les logs n8n.`;
      }
      return res.status(502).json({ error: userMessage, details: responseText.slice(0, 300) });
    }

    let result: any = { success: true };
    try { result = JSON.parse(responseText); } catch {}
    res.json({ success: true, result });

  } catch (err: any) {
    console.error("opportunities/reset network error:", err);
    const isDown = err.code === "ECONNREFUSED" || err.message?.includes("ECONNREFUSED");
    res.status(500).json({
      error: isDown
        ? `Impossible de contacter n8n sur ${N8N_BASE_URL}. Vérifiez que n8n est démarré.`
        : `Erreur réseau: ${err.message}`,
    });
  }
});

// ── n8n Workflow Trigger ───────────────────────────────────────────────────
// FIX: This endpoint was missing entirely — the frontend had no way to trigger
// n8n workflows. The error "webhook not registered / 404" was caused by:
//   1. No backend proxy route existed
//   2. Using /webhook-test/ (test URL) instead of /webhook/ (production URL)
//   3. The n8n workflow was inactive
//
// Usage from frontend: POST /api/n8n/trigger/reset-collecte
// Make sure N8N_BASE_URL is in .env and the n8n workflow is ACTIVE.

app.post("/api/n8n/trigger/:workflowName", authenticate, async (req: any, res) => {
  const { workflowName } = req.params;
  const N8N_BASE_URL = process.env.N8N_BASE_URL || "https://n8n.srv770401.hstgr.cloud";

  // IMPORTANT: /webhook/ = production (workflow must be ACTIVE)
  //            /webhook-test/ = only works while workflow is open in editor
  const webhookUrl = `${N8N_BASE_URL}/webhook/${workflowName}`;

  try {
    const n8nResponse = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        triggeredBy: req.user?.email || "unknown",
        timestamp: new Date().toISOString(),
        ...req.body,
      }),
    });

    const responseText = await n8nResponse.text();

    if (!n8nResponse.ok) {
      console.error(`n8n webhook error [${workflowName}] HTTP ${n8nResponse.status}:`, responseText);

      // Provide a clear, actionable error message to the frontend
      let userMessage: string;
      if (n8nResponse.status === 404) {
        userMessage = `Workflow "${workflowName}" introuvable dans n8n. Vérifiez que (1) le nom du webhook est exactement "${workflowName}", (2) le workflow est ACTIF (toggle vert dans l'éditeur n8n).`;
      } else if (n8nResponse.status >= 500) {
        userMessage = `Erreur interne n8n (${n8nResponse.status}). Vérifiez les logs n8n.`;
      } else {
        userMessage = `n8n a retourné une erreur (${n8nResponse.status}).`;
      }

      return res.status(502).json({
        error: userMessage,
        status: n8nResponse.status,
        details: responseText.slice(0, 500),
      });
    }

    // Try to parse JSON response, fall back to raw text
    let result: any = { success: true };
    try { result = JSON.parse(responseText); } catch {}

    res.json({ success: true, result });
  } catch (err: any) {
    console.error("n8n trigger network error:", err);

    const isConnectionRefused = err.code === "ECONNREFUSED" || err.message?.includes("ECONNREFUSED");
    res.status(500).json({
      error: isConnectionRefused
        ? `Impossible de contacter n8n sur ${N8N_BASE_URL}. Vérifiez que n8n est démarré et que N8N_BASE_URL est correct dans .env.`
        : `Erreur réseau lors du déclenchement du workflow: ${err.message}`,
      details: err.message,
    });
  }
});


// ─────────────────────────────────────────────────────────────────────────────
// DEBUG — GET /api/debug/data-check?projectId=1&date=2024-03-15
// Appelle depuis Postman pour diagnostiquer les données en temps réel
// ─────────────────────────────────────────────────────────────────────────────

app.get("/api/debug/data-check", authenticate, async (req: any, res) => {
  const { projectId, date } = req.query;
  if (!projectId) return res.status(400).json({ error: "projectId required" });
  const nd = date ? normalizeDate(date) : null;
  try {
    const [gscCount, serpCount, scoresCount, nlpCount] = await Promise.all([
      pool.query(`SELECT COUNT(*) AS n, MAX(LEFT(date::text,10)) AS latest FROM gsc_daily WHERE projectid=$1`, [projectId]),
      pool.query(`SELECT COUNT(*) AS n, MAX(LEFT(date::text,10)) AS latest,
                         COUNT(CASE WHEN volume>0 THEN 1 END) AS with_volume,
                         COUNT(CASE WHEN competition>0 THEN 1 END) AS with_competition
                  FROM serp_daily WHERE projectid=$1`, [projectId]),
      pool.query(`SELECT COUNT(*) AS n,
                         COUNT(CASE WHEN opportunity_score>0 THEN 1 END) AS non_zero_opp,
                         ROUND(AVG(opportunity_score)::numeric,4) AS avg_opp,
                         ROUND(AVG(competition_score)::numeric,4) AS avg_comp
                  FROM scores_daily WHERE projectid=$1`, [projectId]),
      pool.query(`SELECT search_intent, COUNT(*) AS n FROM nlp_keyword_enrichment WHERE projectid=$1 GROUP BY search_intent`, [projectId]),
    ]);
    const targetDate = nd || gscCount.rows[0]?.latest;
    let joinCheck: any = null;
    let sample: any = null;
    if (targetDate) {
      const jRes = await pool.query(
        `SELECT COUNT(g.keyword) AS gsc_keywords, COUNT(s.keyword) AS serp_matched,
                COUNT(CASE WHEN s.volume>0 THEN 1 END) AS with_volume,
                COUNT(CASE WHEN s.competition>0 THEN 1 END) AS with_competition
         FROM gsc_daily g
         LEFT JOIN serp_daily s ON g.projectid=s.projectid AND g.keyword=s.keyword
           AND LEFT(g.date::text,10)=LEFT(s.date::text,10)
         WHERE g.projectid=$1 AND LEFT(g.date::text,10)=$2`,
        [projectId, targetDate]
      );
      joinCheck = jRes.rows[0];
      const sRes = await pool.query(
        `SELECT g.keyword, g.position, g.ctr, g.impressions,
                s.volume, s.competition, s.paa_count, s.ai_overview_present,
                sc.opportunity_score, sc.competition_score, sc.ctr_gap,
                n.search_intent, n.branded_status
         FROM gsc_daily g
         LEFT JOIN serp_daily s ON g.projectid=s.projectid AND g.keyword=s.keyword AND LEFT(s.date::text,10)=$2
         LEFT JOIN scores_daily sc ON g.projectid=sc.projectid AND g.keyword=sc.keyword AND LEFT(sc.date::text,10)=$2
         LEFT JOIN nlp_keyword_enrichment n ON g.projectid=n.projectid AND g.keyword=n.keyword
         WHERE g.projectid=$1 AND LEFT(g.date::text,10)=$2 LIMIT 5`,
        [projectId, targetDate]
      );
      sample = sRes.rows;
    }
    const issues: string[] = [];
    if (Number(gscCount.rows[0]?.n) === 0) issues.push("\u274c gsc_daily vide — le workflow n8n n\'a pas ingéré les données GSC");
    if (Number(serpCount.rows[0]?.n) === 0) issues.push("\u274c serp_daily vide — le workflow n8n n\'a pas ingéré les données SERP");
    if (Number(serpCount.rows[0]?.with_volume) === 0) issues.push("\u26a0 serp_daily: aucun volume > 0 — le scraper ne récupère pas le volume");
    if (Number(serpCount.rows[0]?.with_competition) === 0) issues.push("\u26a0 serp_daily: aucune competition > 0 — vérifier le payload SERP");
    if (joinCheck && Number(joinCheck.serp_matched) === 0 && Number(joinCheck.gsc_keywords) > 0)
      issues.push("\u26a0 JOIN GSC\u2194SERP: 0 match — keywords ou formats de date différents");
    if (Number(scoresCount.rows[0]?.non_zero_opp) === 0 && Number(scoresCount.rows[0]?.n) > 0)
      issues.push("\u26a0 scores_daily: tous opportunity_score=0 — relancer /api/compute/kpis");
    if (nlpCount.rows.length === 1) issues.push("\u26a0 NLP: un seul type d\'intent — classification non diversifiée");
    if (issues.length === 0) issues.push("\u2705 Aucun problème détecté");
    res.json({
      projectId, checkedDate: targetDate,
      tables: {
        gsc_daily:    { total: Number(gscCount.rows[0]?.n), latestDate: gscCount.rows[0]?.latest },
        serp_daily:   { total: Number(serpCount.rows[0]?.n), latestDate: serpCount.rows[0]?.latest,
                        withVolume: Number(serpCount.rows[0]?.with_volume), withCompetition: Number(serpCount.rows[0]?.with_competition) },
        scores_daily: { total: Number(scoresCount.rows[0]?.n), nonZeroOpportunity: Number(scoresCount.rows[0]?.non_zero_opp),
                        avgOpportunityScore: Number(scoresCount.rows[0]?.avg_opp), avgCompetitionScore: Number(scoresCount.rows[0]?.avg_comp) },
        nlp_enrichment: { intentDistribution: nlpCount.rows },
      },
      joinCheck: joinCheck ? {
        gscKeywords: Number(joinCheck.gsc_keywords), serpMatched: Number(joinCheck.serp_matched),
        matchRate: Number(joinCheck.gsc_keywords) > 0 ? `${Math.round((joinCheck.serp_matched/joinCheck.gsc_keywords)*100)}%` : "0%",
        withVolume: Number(joinCheck.with_volume), withCompetition: Number(joinCheck.with_competition),
      } : null,
      sample, issues,
    });
  } catch (err) {
    console.error("[DEBUG] data-check error:", err);
    res.status(500).json({ error: "Debug check failed", details: String(err) });
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