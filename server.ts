import express from "express";
import { createServer as createViteServer } from "vite";
import pkg from "pg";
const { Pool } = pkg;
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import path from "path";
import "dotenv/config";
import { fileURLToPath } from "url";
import OpenAI from "openai";
import { z } from "zod";
import crypto from "crypto";
import nodemailer from "nodemailer";
import cron from "node-cron";
import swaggerJsdoc from "swagger-jsdoc";
import swaggerUi from "swagger-ui-express";

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
// Z.AI Coding Plan: must use the dedicated /api/coding/paas/v4 endpoint.
// The general /api/paas/v4 endpoint reports "Insufficient balance" because
// coding-plan credits are not redeemable there.
// timeout=60s so the server fails fast instead of leaving the UI spinning
// indefinitely if Z.AI hangs. Model: glm-4.5 (non-reasoning, ~1s typical).
const zhipu = new OpenAI({
  apiKey: process.env.ZHIPU_API_KEY || "",
  baseURL: "https://api.z.ai/api/coding/paas/v4/",
  timeout: 60_000,
  maxRetries: 1,
});

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

      -- Master keyword list. Une seule ligne par (projectid, keyword). Les
      -- valeurs journalières (position, ctr, impressions, clicks) vivent dans
      -- gsc_daily/scores_daily ; les colonnes snapshot ci-dessous sont des
      -- fallbacks pour les jointures, pas une source de vérité.
      CREATE TABLE IF NOT EXISTS keywords (
        id SERIAL PRIMARY KEY,
        projectid INTEGER REFERENCES projects(id),
        keyword TEXT,
        position INTEGER,
        prev_position INTEGER,
        impressions INTEGER,
        ctr REAL,
        prev_ctr REAL,
        optimization_start_date DATE,
        CONSTRAINT keywords_project_keyword_unique UNIQUE (projectid, keyword)
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

      -- serp_daily v2 — schéma source: migrations/serp_daily_v2.sql.
      -- IF NOT EXISTS pour le bootstrap d'une DB neuve. Sur une DB existante,
      -- exécuter la migration manuellement (DROP + CREATE).
      CREATE TABLE IF NOT EXISTS serp_daily (
        id                  SERIAL PRIMARY KEY,
        projectid           INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        keyword             TEXT    NOT NULL,
        date                DATE    NOT NULL,
        device              TEXT    NOT NULL DEFAULT 'desktop',
        gl                  TEXT,
        hl                  TEXT,
        engine              TEXT    NOT NULL DEFAULT 'google',
        your_position       INTEGER,
        your_url            TEXT,
        your_title          TEXT,
        your_snippet        TEXT,
        your_in_aio         BOOLEAN NOT NULL DEFAULT FALSE,
        has_ai_overview     BOOLEAN NOT NULL DEFAULT FALSE,
        has_paa             BOOLEAN NOT NULL DEFAULT FALSE,
        has_knowledge_graph BOOLEAN NOT NULL DEFAULT FALSE,
        has_inline_videos   BOOLEAN NOT NULL DEFAULT FALSE,
        has_inline_images   BOOLEAN NOT NULL DEFAULT FALSE,
        has_sitelinks       BOOLEAN NOT NULL DEFAULT FALSE,
        has_rich_snippets   BOOLEAN NOT NULL DEFAULT FALSE,
        total_results       BIGINT,
        organic_count       INTEGER NOT NULL DEFAULT 0,
        paa_count           INTEGER NOT NULL DEFAULT 0,
        organic_results     JSONB   NOT NULL DEFAULT '[]'::jsonb,
        paa_questions       JSONB   NOT NULL DEFAULT '[]'::jsonb,
        related_searches    JSONB   NOT NULL DEFAULT '[]'::jsonb,
        ai_overview         JSONB,
        knowledge_graph     JSONB,
        raw_response        JSONB,
        error               TEXT,
        scraped_at          TIMESTAMPTZ,
        created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT serp_daily_unique UNIQUE (projectid, keyword, date, device)
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

    // serp_daily v2 — indexes + trigger pour les bootstraps de DB neuve.
    // Une DB existante doit appliquer migrations/serp_daily_v2.sql à la main.
    await pool.query(`
      CREATE INDEX IF NOT EXISTS serp_daily_project_date_idx
        ON serp_daily (projectid, date DESC);
      CREATE INDEX IF NOT EXISTS serp_daily_keyword_idx
        ON serp_daily (keyword);
      CREATE INDEX IF NOT EXISTS serp_daily_your_position_idx
        ON serp_daily (your_position) WHERE your_position IS NOT NULL;
      CREATE INDEX IF NOT EXISTS serp_daily_has_ai_overview_idx
        ON serp_daily (has_ai_overview) WHERE has_ai_overview = TRUE;
      CREATE INDEX IF NOT EXISTS serp_daily_organic_results_gin
        ON serp_daily USING GIN (organic_results);
      CREATE INDEX IF NOT EXISTS serp_daily_ai_overview_gin
        ON serp_daily USING GIN (ai_overview);
    `);

    await pool.query(`
      CREATE OR REPLACE FUNCTION serp_daily_set_updated_at()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_at = NOW();
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
      DROP TRIGGER IF EXISTS serp_daily_updated_at_trg ON serp_daily;
      CREATE TRIGGER serp_daily_updated_at_trg
        BEFORE UPDATE ON serp_daily
        FOR EACH ROW EXECUTE FUNCTION serp_daily_set_updated_at();
    `);

    // Add is_tracked column if not exists (idempotent migration)
    await pool.query(`
      ALTER TABLE keywords
      ADD COLUMN IF NOT EXISTS is_tracked BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS optimization_start_date DATE;
    `);

    // Promotion idempotente : si on a un INDEX unique sur (projectid, keyword)
    // mais pas de CONSTRAINT formelle, on convertit. Si rien n'existe (DB
    // fraîche créée par une autre voie), on crée la contrainte de zéro.
    // Sans ça, ON CONFLICT (projectid, keyword) dans upsertKeywords casserait.
    await pool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint c
          JOIN pg_class t ON t.oid = c.conrelid
          JOIN pg_namespace n ON n.oid = t.relnamespace
          WHERE n.nspname='public' AND t.relname='keywords'
            AND c.contype='u' AND c.conname='keywords_project_keyword_unique'
        ) THEN
          IF EXISTS (
            SELECT 1 FROM pg_indexes
            WHERE schemaname='public' AND tablename='keywords'
              AND indexname='keywords_project_keyword_unique'
          ) THEN
            ALTER TABLE keywords
              ADD CONSTRAINT keywords_project_keyword_unique
              UNIQUE USING INDEX keywords_project_keyword_unique;
          ELSE
            ALTER TABLE keywords
              ADD CONSTRAINT keywords_project_keyword_unique
              UNIQUE (projectid, keyword);
          END IF;
        END IF;
      END $$;
    `);

    // Add branded_keywords to projects (idempotent migration)
    await pool.query(`
      ALTER TABLE projects
      ADD COLUMN IF NOT EXISTS branded_keywords TEXT;
    `);

    await pool.query(`
      ALTER TABLE scores_daily
      ADD COLUMN IF NOT EXISTS quick_win_score REAL,
      ADD COLUMN IF NOT EXISTS priority_score REAL;
    `);

    // User-level settings (alert thresholds, notifications, theme)
    await pool.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS settings JSONB DEFAULT '{}'::jsonb;
    `);

    // Profile picture (relative URL, e.g. /uploads/avatars/3-1730000000.jpg)
    await pool.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS avatar_url TEXT;
    `);

    // Admin role flag — gates user-management endpoints
    await pool.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE;
    `);

    // Bootstrap admin via variable d'env BOOTSTRAP_ADMIN_EMAIL.
    // Au boot, si la variable est définie ET que l'utilisateur existe déjà en
    // base (créé via signup), on le promeut admin. Aucune création de compte,
    // aucune injection de mot de passe : c'est juste un flag is_admin = TRUE
    // appliqué à un compte existant. Idempotent (relancer le serveur n'a aucun
    // effet de bord). Si BOOTSTRAP_ADMIN_EMAIL est vide ou que l'email n'existe
    // pas encore en base, on log et on n'agit pas.
    const bootstrapAdminEmail = (process.env.BOOTSTRAP_ADMIN_EMAIL || "").toLowerCase().trim();
    if (bootstrapAdminEmail) {
      const r = await pool.query(
        `UPDATE users
           SET is_admin = TRUE
         WHERE LOWER(email) = $1
           AND is_admin = FALSE
         RETURNING email`,
        [bootstrapAdminEmail]
      );
      if (r.rows.length > 0) {
        console.log(`[initDb] BOOTSTRAP_ADMIN_EMAIL → promoted ${r.rows[0].email} to admin`);
      } else {
        const exists = await pool.query(
          "SELECT id FROM users WHERE LOWER(email) = $1",
          [bootstrapAdminEmail]
        );
        if (exists.rows.length === 0) {
          console.log(
            `[initDb] BOOTSTRAP_ADMIN_EMAIL=${bootstrapAdminEmail} : compte non trouvé en base. ` +
            `Créez-le via /api/auth/signup puis redémarrez le serveur pour le promouvoir.`
          );
        }
      }
    }

    // Password reset tokens — separate table for token isolation + audit
    await pool.query(`
      CREATE TABLE IF NOT EXISTS password_resets (
        id          SERIAL PRIMARY KEY,
        user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token       TEXT    NOT NULL UNIQUE,
        expires_at  TIMESTAMPTZ NOT NULL,
        used_at     TIMESTAMPTZ,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS password_resets_user_id_idx ON password_resets(user_id);
      CREATE INDEX IF NOT EXISTS password_resets_expires_at_idx ON password_resets(expires_at);
    `);

    // Notifications déjà envoyées — dédup pour éviter de renvoyer le même
    // courriel quotidiennement. ref_key = "projectid:keyword" (positionDrop) ou
    // "event:id" (upcomingEvents). Fenêtre de re-notification : 7 jours.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS notifications_sent (
        id        SERIAL PRIMARY KEY,
        user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        type      TEXT NOT NULL,
        ref_key   TEXT NOT NULL,
        sent_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS notifications_sent_user_type_idx
        ON notifications_sent (user_id, type, sent_at DESC);
    `);

    // Schema drift cleanup — drop columns/table added externally and now dead.
    // Idempotent: IF EXISTS guards re-runs.
    await pool.query(`
      ALTER TABLE keywords    DROP COLUMN IF EXISTS trend;
      ALTER TABLE keywords    DROP COLUMN IF EXISTS status;
      ALTER TABLE keywords    DROP COLUMN IF EXISTS type;
      ALTER TABLE keywords    DROP COLUMN IF EXISTS intent;
      ALTER TABLE keywords    DROP COLUMN IF EXISTS volume;
      ALTER TABLE keywords    DROP COLUMN IF EXISTS competition;
      ALTER TABLE projects    DROP COLUMN IF EXISTS site_url;
      ALTER TABLE projects    DROP COLUMN IF EXISTS gsc_property;
      ALTER TABLE projects    DROP COLUMN IF EXISTS default_days_back;
      ALTER TABLE projects    DROP COLUMN IF EXISTS is_active;
      ALTER TABLE projects    DROP COLUMN IF EXISTS updated_at;
      ALTER TABLE gsc_daily   DROP COLUMN IF EXISTS page;
      DROP TABLE IF EXISTS user_settings;
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_gsc_daily_project_date
      ON gsc_daily(projectid, date);
    `);

    // (serp_daily indexes are created above as part of the v2 schema bootstrap)

    // ── Accent-insensitive uniqueness ────────────────────────────────────────
    // Google Search Console returns the user's exact query text, which means
    // the same logical keyword can arrive as "complement" or "complément"
    // depending on how the searcher typed it. Without normalisation those land
    // as two rows even for the same (project, date). We collapse them with a
    // functional UNIQUE index on LOWER(unaccent(keyword)).
    //
    // `unaccent` is not IMMUTABLE by default (its dictionary can change), so a
    // small wrapper marked IMMUTABLE is needed before it can sit inside an
    // index expression.
    await pool.query(`CREATE EXTENSION IF NOT EXISTS unaccent`);
    await pool.query(`
      CREATE OR REPLACE FUNCTION immutable_unaccent(text) RETURNS text
        LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT AS
      $$ SELECT public.unaccent('public.unaccent', $1) $$
    `);

    // Drop legacy plain-text UNIQUE constraints if they still exist (DBs
    // bootstrapped before this migration), then create the new functional
    // indexes. IF NOT EXISTS / IF EXISTS makes the whole block idempotent.
    await pool.query(`
      ALTER TABLE gsc_daily              DROP CONSTRAINT IF EXISTS gsc_daily_unique;
      ALTER TABLE serp_daily             DROP CONSTRAINT IF EXISTS serp_daily_unique;
      ALTER TABLE scores_daily           DROP CONSTRAINT IF EXISTS scores_daily_projectid_keyword_date_key;
      ALTER TABLE nlp_keyword_enrichment DROP CONSTRAINT IF EXISTS nlp_keyword_enrichment_projectid_keyword_date_key;
      ALTER TABLE keywords               DROP CONSTRAINT IF EXISTS keywords_project_keyword_unique;
    `);
    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS gsc_daily_uniq_norm
        ON gsc_daily (projectid, (LOWER(immutable_unaccent(keyword))), date);
      CREATE UNIQUE INDEX IF NOT EXISTS serp_daily_uniq_norm
        ON serp_daily (projectid, (LOWER(immutable_unaccent(keyword))), date, device);
      CREATE UNIQUE INDEX IF NOT EXISTS scores_daily_uniq_norm
        ON scores_daily (projectid, (LOWER(immutable_unaccent(keyword))), date);
      CREATE UNIQUE INDEX IF NOT EXISTS nlp_keyword_enrichment_uniq_norm
        ON nlp_keyword_enrichment (projectid, (LOWER(immutable_unaccent(keyword))), date);
      CREATE UNIQUE INDEX IF NOT EXISTS keywords_uniq_norm
        ON keywords (projectid, (LOWER(immutable_unaccent(keyword))));
    `);

    console.log("Database initialized successfully");
  } catch (err) {
    console.error("Database initialization failed:", err);
  }
}

initDb();

const app = express();
app.use(express.json({ limit: "5mb" }));
// Serve uploaded avatars at /uploads/* in dev too (Vite serves /public/* in dev,
// but uploads land outside the bundled tree so we mount them explicitly)
app.use("/uploads", express.static(path.join(__dirname, "public", "uploads")));

// ── Swagger / OpenAPI 3.0 ────────────────────────────────────────────────────
// Documentation interactive de l'API REST. Active via SWAGGER_ENABLED=true
// dans .env. Les annotations @swagger sont lues depuis swagger-docs.ts.
// UI accessible via la route définie par SWAGGER_ROUTE (par défaut /api-docs).
if ((process.env.SWAGGER_ENABLED || "true").toLowerCase() === "true") {
  const swaggerSpec = swaggerJsdoc({
    definition: {
      openapi: "3.0.0",
      info: {
        title: process.env.SWAGGER_TITLE || "SEO BI API",
        version: process.env.SWAGGER_VERSION || "1.0.0",
        description:
          process.env.SWAGGER_DESCRIPTION ||
          "API REST de l'application SEO Business Intelligence — gestion projets, suivi de mots-clés, KPIs SEO et IA.",
      },
      servers: [
        {
          url: process.env.SWAGGER_SERVER_URL || "http://localhost:3000",
          description: "Serveur courant",
        },
      ],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: "http",
            scheme: "bearer",
            bearerFormat: "JWT",
            description: "Token JWT obtenu via /api/auth/login (valable 24h)",
          },
          apiKeyAuth: {
            type: "apiKey",
            in: "header",
            name: "x-api-key",
            description: "Clé API_KEY_N8N partagée avec les workflows n8n",
          },
        },
      },
    },
    apis: [path.join(__dirname, "swagger-docs.ts")],
  });

  const swaggerRoute = process.env.SWAGGER_ROUTE || "/api-docs";
  app.use(
    swaggerRoute,
    swaggerUi.serve,
    swaggerUi.setup(swaggerSpec, {
      customSiteTitle: process.env.SWAGGER_TITLE || "SEO BI API",
      customCss: ".swagger-ui .topbar { display: none }",
    })
  );
  // Spec JSON brut pour exports / outils externes
  app.get(`${swaggerRoute}.json`, (_req, res) => res.json(swaggerSpec));
  console.log(`📚 Swagger UI disponible sur ${swaggerRoute}`);
}

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

// Gate user-management endpoints. Re-checks the DB on every call so that a
// user demoted in one session loses access immediately, without waiting for
// their JWT to expire.
const requireAdmin = async (req: any, res: any, next: any) => {
  try {
    const r = await pool.query("SELECT is_admin FROM users WHERE id = $1", [req.user?.id]);
    if (!r.rows[0]?.is_admin) {
      return res.status(403).json({ error: "Accès réservé aux administrateurs" });
    }
    next();
  } catch (err) {
    console.error("requireAdmin error:", err);
    res.status(500).json({ error: "Authorization check failed" });
  }
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
      ON CONFLICT (projectid, (LOWER(immutable_unaccent(keyword))))
      DO UPDATE SET keyword = EXCLUDED.keyword
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
    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        avatar_url: user.avatar_url ?? null,
        is_admin: user.is_admin === true,
      },
    });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "Login failed" });
  }
});

// ── Signup ─────────────────────────────────────────────────────────────────
app.post("/api/auth/signup", async (req, res) => {
  const { email, password, avatar } = req.body || {};

  if (!email || !password) {
    return res.status(400).json({ error: "Email et mot de passe requis" });
  }
  if (typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: "Adresse email invalide" });
  }
  if (typeof password !== "string" || password.length < 6) {
    return res.status(400).json({ error: "Le mot de passe doit contenir au moins 6 caractères" });
  }

  try {
    const existing = await pool.query("SELECT id FROM users WHERE email = $1", [email.toLowerCase()]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: "Un compte avec cet email existe déjà" });
    }

    const hashed = bcrypt.hashSync(password, 10);
    const result = await pool.query(
      "INSERT INTO users (email, password) VALUES ($1, $2) RETURNING id, email",
      [email.toLowerCase(), hashed]
    );
    const user = result.rows[0];

    // Optional avatar upload (data URL)
    let avatar_url: string | null = null;
    if (avatar) {
      try {
        avatar_url = saveAvatarDataUrl(avatar, user.id);
        if (avatar_url) {
          await pool.query("UPDATE users SET avatar_url = $1 WHERE id = $2", [avatar_url, user.id]);
        }
      } catch (avatarErr: any) {
        // Account was created but avatar failed — surface the error so the UI can retry
        console.error("Signup avatar error:", avatarErr);
        return res.status(400).json({ error: avatarErr.message || "Échec de l'upload de la photo" });
      }
    }

    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: "24h" });
    res.status(201).json({
      token,
      user: { id: user.id, email: user.email, avatar_url, is_admin: false },
    });
  } catch (err: any) {
    if (err?.code === "23505") {
      return res.status(409).json({ error: "Un compte avec cet email existe déjà" });
    }
    console.error("Signup error:", err);
    res.status(500).json({ error: "Échec de la création du compte" });
  }
});

// ── Password reset ────────────────────────────────────────────────────────
// Configurable via env vars:
//   APP_URL    — public URL of the frontend (used in the reset link)
//   SMTP_HOST  — if set, real emails are sent; otherwise the link is logged
//   SMTP_PORT  — default 587
//   SMTP_USER, SMTP_PASS — SMTP auth
//   SMTP_FROM  — From: address (default: SMTP_USER, fallback: noreply@localhost)

const APP_URL = process.env.APP_URL || "http://localhost:3000";
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

let mailer: nodemailer.Transporter | null = null;
if (process.env.SMTP_HOST) {
  mailer = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: Number(process.env.SMTP_PORT || 587) === 465,
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      : undefined,
  });
}

async function sendPasswordResetEmail(to: string, link: string) {
  const subject = "Réinitialisation de votre mot de passe — SEO BI";
  const text =
`Bonjour,

Vous avez demandé à réinitialiser votre mot de passe sur SEO BI.

Cliquez sur le lien ci-dessous pour choisir un nouveau mot de passe (valable 1 heure) :

${link}

Si vous n'êtes pas à l'origine de cette demande, ignorez cet email — votre mot de passe restera inchangé.

— SEO BI by Waoo`;

  const html = `<!doctype html>
<html><body style="font-family:system-ui,-apple-system,sans-serif;background:#f8fafc;padding:32px;color:#0f172a">
  <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:24px;padding:40px;border:1px solid #e2e8f0">
    <h1 style="margin:0 0 8px;font-size:22px;color:#1d4ed8">Réinitialisation du mot de passe</h1>
    <p style="color:#475569;line-height:1.6;margin:16px 0">
      Vous avez demandé à réinitialiser votre mot de passe sur <strong>SEO BI</strong>.
      Cliquez sur le bouton ci-dessous pour en choisir un nouveau (lien valable 1 heure) :
    </p>
    <p style="margin:28px 0">
      <a href="${link}"
         style="display:inline-block;background:#2563eb;color:#fff;font-weight:700;
                padding:14px 28px;border-radius:14px;text-decoration:none">
        Réinitialiser mon mot de passe
      </a>
    </p>
    <p style="color:#64748b;font-size:13px;line-height:1.5">
      Si le bouton ne fonctionne pas, copiez ce lien dans votre navigateur :<br>
      <a href="${link}" style="color:#2563eb;word-break:break-all">${link}</a>
    </p>
    <hr style="border:none;border-top:1px solid #e2e8f0;margin:28px 0">
    <p style="color:#94a3b8;font-size:12px;margin:0">
      Si vous n'êtes pas à l'origine de cette demande, ignorez cet email — votre mot de passe restera inchangé.
    </p>
  </div>
</body></html>`;

  if (mailer) {
    await mailer.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER || "noreply@localhost",
      to,
      subject,
      text,
      html,
    });
    console.log(`[forgot-password] email sent to ${to}`);
  } else {
    console.log(`[forgot-password] SMTP not configured. Reset link for ${to}:\n  ${link}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Notifications quotidiennes (chute de position, événements à venir)
// Préférences stockées dans users.settings.notifications + users.settings.thresholds.
// Dédup via la table notifications_sent (fenêtre de 7 jours par défaut).
// ─────────────────────────────────────────────────────────────────────────────

const NOTIF_DEDUP_DAYS = 7;
const UPCOMING_EVENT_DAYS = 3;
const NOTIF_DEFAULT_DRIFT_THRESHOLD = 3;

async function wasNotifiedRecently(userId: number, type: string, refKey: string): Promise<boolean> {
  const r = await pool.query(
    `SELECT 1 FROM notifications_sent
     WHERE user_id = $1 AND type = $2 AND ref_key = $3
       AND sent_at >= NOW() - ($4 || ' days')::interval
     LIMIT 1`,
    [userId, type, refKey, String(NOTIF_DEDUP_DAYS)]
  );
  return r.rowCount! > 0;
}

async function recordNotification(userId: number, type: string, refKey: string): Promise<void> {
  await pool.query(
    `INSERT INTO notifications_sent (user_id, type, ref_key) VALUES ($1, $2, $3)`,
    [userId, type, refKey]
  );
}

async function sendNotificationEmail(to: string, subject: string, html: string, text: string): Promise<void> {
  if (mailer) {
    await mailer.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER || "noreply@localhost",
      to,
      subject,
      text,
      html,
    });
    console.log(`[notifications] email sent to ${to} — ${subject}`);
  } else {
    console.log(`[notifications] SMTP not configured. Would have sent to ${to}: ${subject}`);
  }
}

type PositionDropRow = { projectid: number; project_name: string; keyword: string; performance_drift: number; position: number };
type UpcomingEventRow = { id: number; project_name: string; title: string; start_date: string };

async function checkPositionDrops(user: { id: number; email: string }, driftThreshold: number): Promise<number> {
  const r = await pool.query(
    `SELECT s.projectid, p.name AS project_name, s.keyword,
            s.performance_drift, k.position
     FROM scores_daily s
     JOIN projects p ON p.id = s.projectid AND p.userid = $1
     JOIN keywords k ON k.projectid = s.projectid
                    AND LOWER(k.keyword) = LOWER(s.keyword)
                    AND k.is_tracked = TRUE
     WHERE s.performance_drift >= $2
       AND s.date::date >= (CURRENT_DATE - interval '2 days')
     ORDER BY s.performance_drift DESC`,
    [user.id, driftThreshold]
  );

  const drops: PositionDropRow[] = [];
  for (const row of r.rows) {
    const refKey = `${row.projectid}:${row.keyword}`;
    if (await wasNotifiedRecently(user.id, "positionDrop", refKey)) continue;
    drops.push(row);
  }
  if (drops.length === 0) return 0;

  const subject = `[SEO BI] ${drops.length} chute${drops.length > 1 ? "s" : ""} de position détectée${drops.length > 1 ? "s" : ""}`;
  const rowsHtml = drops.map((d) =>
    `<tr>
       <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0"><strong>${d.keyword}</strong></td>
       <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#475569">${d.project_name}</td>
       <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;text-align:right;color:#dc2626;font-weight:700">+${Number(d.performance_drift).toFixed(1)}</td>
     </tr>`
  ).join("");
  const html = `<!doctype html><html><body style="font-family:system-ui,-apple-system,sans-serif;background:#f8fafc;padding:32px;color:#0f172a">
    <div style="max-width:640px;margin:0 auto;background:#fff;border-radius:24px;padding:40px;border:1px solid #e2e8f0">
      <h1 style="margin:0 0 8px;font-size:22px;color:#dc2626">Alerte chute de position</h1>
      <p style="color:#475569;line-height:1.6;margin:16px 0">
        ${drops.length} mot${drops.length > 1 ? "s" : ""}-clé${drops.length > 1 ? "s suivis" : " suivi"} présente${drops.length > 1 ? "nt" : ""}
        une dérive de position supérieure ou égale au seuil défini (${driftThreshold}).
      </p>
      <table style="width:100%;border-collapse:collapse;margin-top:16px;font-size:14px">
        <thead><tr style="background:#f1f5f9;text-align:left">
          <th style="padding:8px 12px">Mot-clé</th><th style="padding:8px 12px">Projet</th><th style="padding:8px 12px;text-align:right">Dérive</th>
        </tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>
      <p style="color:#64748b;font-size:13px;margin-top:24px">
        Connectez-vous à <a href="${APP_URL}" style="color:#2563eb">SEO BI</a> pour examiner ces mots-clés.
      </p>
    </div></body></html>`;
  const text = `Alerte chute de position (seuil: ${driftThreshold})\n\n` +
    drops.map((d) => `- ${d.keyword} (${d.project_name}) : +${Number(d.performance_drift).toFixed(1)}`).join("\n") +
    `\n\nConnectez-vous à ${APP_URL}`;

  await sendNotificationEmail(user.email, subject, html, text);
  for (const d of drops) {
    await recordNotification(user.id, "positionDrop", `${d.projectid}:${d.keyword}`);
  }
  return drops.length;
}

async function checkUpcomingEvents(user: { id: number; email: string }): Promise<number> {
  const r = await pool.query(
    `SELECT e.id, p.name AS project_name, e.title, e.start_date
     FROM events e
     JOIN projects p ON p.id = e.projectid AND p.userid = $1
     WHERE e.start_date >= NOW()
       AND e.start_date <= NOW() + ($2 || ' days')::interval
     ORDER BY e.start_date ASC`,
    [user.id, String(UPCOMING_EVENT_DAYS)]
  );

  const upcoming: UpcomingEventRow[] = [];
  for (const row of r.rows) {
    if (await wasNotifiedRecently(user.id, "upcomingEvents", `event:${row.id}`)) continue;
    upcoming.push(row);
  }
  if (upcoming.length === 0) return 0;

  const subject = `[SEO BI] ${upcoming.length} événement${upcoming.length > 1 ? "s" : ""} à venir`;
  const rowsHtml = upcoming.map((e) => {
    const d = new Date(e.start_date).toLocaleString("fr-FR", { dateStyle: "long", timeStyle: "short" });
    return `<tr>
       <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0"><strong>${e.title}</strong></td>
       <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#475569">${e.project_name}</td>
       <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#0f172a">${d}</td>
     </tr>`;
  }).join("");
  const html = `<!doctype html><html><body style="font-family:system-ui,-apple-system,sans-serif;background:#f8fafc;padding:32px;color:#0f172a">
    <div style="max-width:640px;margin:0 auto;background:#fff;border-radius:24px;padding:40px;border:1px solid #e2e8f0">
      <h1 style="margin:0 0 8px;font-size:22px;color:#1d4ed8">Événements à venir</h1>
      <p style="color:#475569;line-height:1.6;margin:16px 0">
        ${upcoming.length} événement${upcoming.length > 1 ? "s sont" : " est"} programmé${upcoming.length > 1 ? "s" : ""}
        dans les ${UPCOMING_EVENT_DAYS} prochains jours.
      </p>
      <table style="width:100%;border-collapse:collapse;margin-top:16px;font-size:14px">
        <thead><tr style="background:#f1f5f9;text-align:left">
          <th style="padding:8px 12px">Titre</th><th style="padding:8px 12px">Projet</th><th style="padding:8px 12px">Date</th>
        </tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>
      <p style="color:#64748b;font-size:13px;margin-top:24px">
        Consultez votre calendrier sur <a href="${APP_URL}" style="color:#2563eb">SEO BI</a>.
      </p>
    </div></body></html>`;
  const text = `Événements à venir (${UPCOMING_EVENT_DAYS} jours)\n\n` +
    upcoming.map((e) => `- ${e.title} (${e.project_name}) : ${new Date(e.start_date).toLocaleString("fr-FR")}`).join("\n");

  await sendNotificationEmail(user.email, subject, html, text);
  for (const e of upcoming) {
    await recordNotification(user.id, "upcomingEvents", `event:${e.id}`);
  }
  return upcoming.length;
}

type NotifJobResult = { userId: number; email: string; positionDrops: number; upcomingEvents: number };

async function runNotificationsJob(): Promise<NotifJobResult[]> {
  const users = await pool.query(
    `SELECT id, email, COALESCE(settings, '{}'::jsonb) AS settings
     FROM users WHERE email IS NOT NULL`
  );
  const results: NotifJobResult[] = [];

  for (const u of users.rows) {
    const settings = u.settings || {};
    const notif = settings.notifications || {};
    const driftThreshold = Number(settings.thresholds?.drift ?? NOTIF_DEFAULT_DRIFT_THRESHOLD);

    let positionDrops = 0;
    let upcomingEvents = 0;
    try {
      if (notif.positionDrop) {
        positionDrops = await checkPositionDrops({ id: u.id, email: u.email }, driftThreshold);
      }
      if (notif.upcomingEvents) {
        upcomingEvents = await checkUpcomingEvents({ id: u.id, email: u.email });
      }
    } catch (err) {
      console.error(`[notifications] error for user ${u.id} (${u.email}):`, err);
    }

    if (positionDrops > 0 || upcomingEvents > 0) {
      results.push({ userId: u.id, email: u.email, positionDrops, upcomingEvents });
    }
  }
  console.log(`[notifications] job done — ${results.length} user(s) notified`);
  return results;
}

// Enregistrement du cron au démarrage du serveur.
// Désactivable via NOTIFICATIONS_ENABLED=false (par défaut: activé).
// Expression personnalisable via NOTIFICATIONS_CRON (par défaut: tous les jours 8h UTC).
const NOTIFICATIONS_ENABLED = (process.env.NOTIFICATIONS_ENABLED ?? "true").toLowerCase() !== "false";
const NOTIFICATIONS_CRON = process.env.NOTIFICATIONS_CRON || "0 8 * * *";
if (NOTIFICATIONS_ENABLED) {
  if (cron.validate(NOTIFICATIONS_CRON)) {
    cron.schedule(NOTIFICATIONS_CRON, () => {
      runNotificationsJob().catch((err) => console.error("[notifications] cron run failed:", err));
    }, { timezone: "UTC" });
    console.log(`[notifications] cron registered: '${NOTIFICATIONS_CRON}' (UTC)`);
  } else {
    console.warn(`[notifications] invalid cron expression '${NOTIFICATIONS_CRON}' — cron NOT registered`);
  }
} else {
  console.log("[notifications] disabled via NOTIFICATIONS_ENABLED=false");
}

// Déclenchement manuel — réservé aux admins, utile pour tester sans attendre le cron.
app.post("/api/notifications/trigger", authenticate, requireAdmin, async (_req, res) => {
  try {
    const results = await runNotificationsJob();
    res.json({ success: true, notified: results.length, results });
  } catch (err: any) {
    console.error("[notifications] manual trigger failed:", err);
    res.status(500).json({ error: err?.message || "trigger failed" });
  }
});

app.post("/api/auth/forgot-password", async (req, res) => {
  const email = (req.body?.email || "").toString().trim().toLowerCase();
  // Always return 200 to avoid leaking which emails are registered
  if (!email) {
    return res.json({ success: true });
  }

  try {
    const userRes = await pool.query("SELECT id, email FROM users WHERE email = $1", [email]);
    const user = userRes.rows[0];
    if (user) {
      const token = crypto.randomBytes(32).toString("hex");
      const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);
      await pool.query(
        "INSERT INTO password_resets (user_id, token, expires_at) VALUES ($1, $2, $3)",
        [user.id, token, expiresAt]
      );
      const link = `${APP_URL.replace(/\/$/, "")}/reset-password?token=${token}`;
      try {
        await sendPasswordResetEmail(user.email, link);
      } catch (mailErr) {
        // Don't reveal failure to caller; log for ops
        console.error("[forgot-password] mail send failed:", mailErr);
      }
    } else {
      console.log(`[forgot-password] no user for ${email} (silent 200)`);
    }
    res.json({ success: true });
  } catch (err) {
    console.error("forgot-password error:", err);
    // Still return 200 to avoid information leak
    res.json({ success: true });
  }
});

app.post("/api/auth/reset-password", async (req, res) => {
  const { token, password } = req.body || {};
  if (typeof token !== "string" || token.length < 16) {
    return res.status(400).json({ error: "Lien de réinitialisation invalide" });
  }
  if (typeof password !== "string" || password.length < 6) {
    return res.status(400).json({ error: "Le mot de passe doit contenir au moins 6 caractères" });
  }

  try {
    const r = await pool.query(
      `SELECT id, user_id, expires_at, used_at
       FROM password_resets WHERE token = $1`,
      [token]
    );
    const reset = r.rows[0];
    if (!reset) {
      return res.status(400).json({ error: "Lien invalide ou déjà utilisé" });
    }
    if (reset.used_at) {
      return res.status(400).json({ error: "Ce lien a déjà été utilisé" });
    }
    if (new Date(reset.expires_at).getTime() < Date.now()) {
      return res.status(400).json({ error: "Ce lien a expiré, demandez-en un nouveau" });
    }

    const hashed = bcrypt.hashSync(password, 10);
    await pool.query("UPDATE users SET password = $1 WHERE id = $2", [hashed, reset.user_id]);
    await pool.query("UPDATE password_resets SET used_at = NOW() WHERE id = $1", [reset.id]);
    // Invalidate any other pending tokens for this user
    await pool.query(
      "UPDATE password_resets SET used_at = NOW() WHERE user_id = $1 AND used_at IS NULL",
      [reset.user_id]
    );

    res.json({ success: true });
  } catch (err) {
    console.error("reset-password error:", err);
    res.status(500).json({ error: "Échec de la réinitialisation" });
  }
});

// ── Avatar upload helper ──────────────────────────────────────────────────
// Accepts a data-URL string ("data:image/jpeg;base64,..."), validates type +
// size, writes the decoded bytes to public/uploads/avatars/, returns the
// public URL ("/uploads/avatars/<file>"). Returns null on empty input.
import fs from "fs";
const AVATARS_DIR = path.join(__dirname, "public", "uploads", "avatars");
const AVATAR_MAX_BYTES = 2 * 1024 * 1024; // 2 MB after decode
const AVATAR_MIME_TO_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg":  "jpg",
  "image/png":  "png",
  "image/webp": "webp",
};

function saveAvatarDataUrl(dataUrl: string | undefined | null, userId: number): string | null {
  if (!dataUrl || typeof dataUrl !== "string") return null;
  const m = dataUrl.match(/^data:(image\/(?:jpeg|jpg|png|webp));base64,(.+)$/);
  if (!m) {
    throw new Error("Format d'image invalide (JPEG, PNG ou WebP attendu)");
  }
  const mime = m[1];
  const ext = AVATAR_MIME_TO_EXT[mime] || "bin";
  const buf = Buffer.from(m[2], "base64");
  if (buf.length > AVATAR_MAX_BYTES) {
    throw new Error("Image trop volumineuse (max 2 Mo)");
  }
  if (!fs.existsSync(AVATARS_DIR)) {
    fs.mkdirSync(AVATARS_DIR, { recursive: true });
  }
  const filename = `${userId}-${Date.now()}.${ext}`;
  fs.writeFileSync(path.join(AVATARS_DIR, filename), buf);
  return `/uploads/avatars/${filename}`;
}

// ── Profile (email + password + avatar change) ────────────────────────────
app.put("/api/profile", authenticate, async (req: any, res) => {
  const { email, currentPassword, newPassword, avatar } = req.body;
  if (!email && !newPassword && avatar === undefined) {
    return res.status(400).json({ error: "Nothing to update" });
  }
  try {
    const userRes = await pool.query("SELECT * FROM users WHERE id = $1", [req.user.id]);
    const user = userRes.rows[0];
    if (!user) return res.status(404).json({ error: "User not found" });

    if (newPassword) {
      if (!currentPassword || !bcrypt.compareSync(currentPassword, user.password)) {
        return res.status(403).json({ error: "Current password is incorrect" });
      }
      if (newPassword.length < 6) {
        return res.status(400).json({ error: "New password must be at least 6 characters" });
      }
    }

    let avatar_url: string | null | undefined = undefined;
    if (avatar) {
      try {
        avatar_url = saveAvatarDataUrl(avatar, req.user.id);
      } catch (e: any) {
        return res.status(400).json({ error: e.message || "Échec de l'upload de la photo" });
      }
    }

    const updates: string[] = [];
    const params: any[] = [];
    let p = 1;
    if (email && email !== user.email) {
      updates.push(`email = $${p++}`);
      params.push(email);
    }
    if (newPassword) {
      updates.push(`password = $${p++}`);
      params.push(bcrypt.hashSync(newPassword, 10));
    }
    if (avatar_url) {
      updates.push(`avatar_url = $${p++}`);
      params.push(avatar_url);
    }
    if (updates.length === 0) return res.json({ success: true });

    params.push(req.user.id);
    await pool.query(`UPDATE users SET ${updates.join(", ")} WHERE id = $${p}`, params);
    res.json({ success: true, email: email || user.email, avatar_url: avatar_url ?? user.avatar_url ?? null });
  } catch (err: any) {
    if (err?.code === "23505") {
      return res.status(409).json({ error: "Email already in use" });
    }
    console.error("Profile update error:", err);
    res.status(500).json({ error: "Failed to update profile" });
  }
});

// ── User settings (alert thresholds, notifications, theme) ─────────────────
app.get("/api/settings", authenticate, async (req: any, res) => {
  try {
    const r = await pool.query("SELECT settings FROM users WHERE id = $1", [req.user.id]);
    res.json(r.rows[0]?.settings || {});
  } catch (err) {
    console.error("Get settings error:", err);
    res.status(500).json({ error: "Failed to fetch settings" });
  }
});

app.put("/api/settings", authenticate, async (req: any, res) => {
  const settings = req.body || {};
  try {
    await pool.query(
      "UPDATE users SET settings = $1::jsonb WHERE id = $2",
      [JSON.stringify(settings), req.user.id]
    );
    res.json({ success: true });
  } catch (err) {
    console.error("Update settings error:", err);
    res.status(500).json({ error: "Failed to save settings" });
  }
});

// ── User CRUD (admin-style management from the Settings page) ──────────────
// Any authenticated user can manage users. Lock down with an is_admin flag
// later if needed. Self-deletion is always refused.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

app.get("/api/users", authenticate, requireAdmin, async (_req, res) => {
  try {
    const r = await pool.query(
      "SELECT id, email, avatar_url, is_admin FROM users ORDER BY id ASC"
    );
    res.json(r.rows);
  } catch (err) {
    console.error("List users error:", err);
    res.status(500).json({ error: "Failed to list users" });
  }
});

app.post("/api/users", authenticate, requireAdmin, async (req: any, res) => {
  const { email, password, avatar, is_admin } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: "Email et mot de passe requis" });
  }
  if (typeof email !== "string" || !EMAIL_RE.test(email)) {
    return res.status(400).json({ error: "Adresse email invalide" });
  }
  if (typeof password !== "string" || password.length < 6) {
    return res.status(400).json({ error: "Le mot de passe doit contenir au moins 6 caractères" });
  }

  try {
    const r = await pool.query(
      "INSERT INTO users (email, password, is_admin) VALUES ($1, $2, $3) RETURNING id, email, is_admin",
      [email.toLowerCase(), bcrypt.hashSync(password, 10), is_admin === true]
    );
    const user = r.rows[0];

    let avatar_url: string | null = null;
    if (avatar) {
      try {
        avatar_url = saveAvatarDataUrl(avatar, user.id);
        if (avatar_url) {
          await pool.query("UPDATE users SET avatar_url = $1 WHERE id = $2", [avatar_url, user.id]);
        }
      } catch (e: any) {
        return res.status(400).json({ error: e.message || "Échec de l'upload de la photo" });
      }
    }
    res.status(201).json({ ...user, avatar_url });
  } catch (err: any) {
    if (err?.code === "23505") {
      return res.status(409).json({ error: "Un compte avec cet email existe déjà" });
    }
    console.error("Create user error:", err);
    res.status(500).json({ error: "Échec de la création" });
  }
});

app.put("/api/users/:id", authenticate, requireAdmin, async (req: any, res) => {
  const id = Number(req.params.id);
  const { email, password, avatar, is_admin } = req.body || {};
  if (!Number.isFinite(id)) {
    return res.status(400).json({ error: "ID invalide" });
  }
  if (email !== undefined && (typeof email !== "string" || !EMAIL_RE.test(email))) {
    return res.status(400).json({ error: "Adresse email invalide" });
  }
  if (password !== undefined && (typeof password !== "string" || password.length < 6)) {
    return res.status(400).json({ error: "Le mot de passe doit contenir au moins 6 caractères" });
  }

  try {
    const existing = await pool.query("SELECT id, is_admin FROM users WHERE id = $1", [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: "Utilisateur introuvable" });
    }

    // Last-admin protection: refuse demoting the only admin
    if (is_admin === false && existing.rows[0].is_admin === true) {
      const adminCount = await pool.query("SELECT COUNT(*)::int AS n FROM users WHERE is_admin = TRUE");
      if (Number(adminCount.rows[0].n) <= 1) {
        return res.status(409).json({
          error: "Impossible de retirer le rôle admin : c'est le dernier administrateur. Promouvez d'abord un autre utilisateur.",
        });
      }
    }

    let avatar_url: string | null | undefined = undefined;
    if (avatar) {
      try {
        avatar_url = saveAvatarDataUrl(avatar, id);
      } catch (e: any) {
        return res.status(400).json({ error: e.message || "Échec de l'upload de la photo" });
      }
    }

    const updates: string[] = [];
    const params: any[] = [];
    let p = 1;
    if (email) {
      updates.push(`email = $${p++}`);
      params.push(email.toLowerCase());
    }
    if (password) {
      updates.push(`password = $${p++}`);
      params.push(bcrypt.hashSync(password, 10));
    }
    if (avatar_url) {
      updates.push(`avatar_url = $${p++}`);
      params.push(avatar_url);
    }
    if (typeof is_admin === "boolean") {
      updates.push(`is_admin = $${p++}`);
      params.push(is_admin);
    }
    if (updates.length === 0) {
      return res.json({ success: true });
    }

    params.push(id);
    const r = await pool.query(
      `UPDATE users SET ${updates.join(", ")} WHERE id = $${p} RETURNING id, email, avatar_url, is_admin`,
      params
    );
    res.json(r.rows[0]);
  } catch (err: any) {
    if (err?.code === "23505") {
      return res.status(409).json({ error: "Email déjà utilisé" });
    }
    console.error("Update user error:", err);
    res.status(500).json({ error: "Échec de la mise à jour" });
  }
});

app.delete("/api/users/:id", authenticate, requireAdmin, async (req: any, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    return res.status(400).json({ error: "ID invalide" });
  }
  if (id === req.user.id) {
    return res.status(400).json({ error: "Vous ne pouvez pas supprimer votre propre compte." });
  }

  try {
    const projCount = await pool.query(
      "SELECT COUNT(*)::int AS n FROM projects WHERE userid = $1",
      [id]
    );
    if (Number(projCount.rows[0].n) > 0) {
      return res.status(409).json({
        error: `Cet utilisateur possède ${projCount.rows[0].n} projet(s). Supprimez d'abord ses projets.`,
      });
    }
    const r = await pool.query("DELETE FROM users WHERE id = $1 RETURNING id", [id]);
    if (r.rows.length === 0) {
      return res.status(404).json({ error: "Utilisateur introuvable" });
    }
    res.json({ success: true });
  } catch (err) {
    console.error("Delete user error:", err);
    res.status(500).json({ error: "Échec de la suppression" });
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
        branded_keywords,
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

// Domain validation: same regex + cleaner used by the frontend (Projects.tsx)
const PROJECT_DOMAIN_RE = /^[a-z0-9][a-z0-9-]*\.[a-z]{2,}(\.[a-z]{2,})?$/i;
function cleanProjectDomain(raw: unknown): string {
  return String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "");
}

app.post("/api/projects", authenticate, async (req: any, res) => {
  const { name, country, language, branded_keywords } = req.body;
  const domain = cleanProjectDomain(req.body?.domain);

  if (!domain) {
    return res.status(400).json({ error: "Le domaine est requis." });
  }
  if (!PROJECT_DOMAIN_RE.test(domain)) {
    return res.status(400).json({
      error: "Le domaine doit avoir la structure « nomdusite.com » (ex : paraexpert.tn, mon-site.fr).",
    });
  }

  try {
    const result = await pool.query(
      `INSERT INTO projects (name, domain, country, language, branded_keywords, userid)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [name, domain, country, language, branded_keywords || null, req.user.id]
    );

    res.json({ id: result.rows[0].id });
  } catch (err) {
    console.error("Create project error:", err);
    res.status(500).json({ error: "Failed to create project" });
  }
});

app.put("/api/projects/:projectId", authenticate, async (req: any, res) => {
  const { projectId } = req.params;
  const { name, country, language, branded_keywords } = req.body;
  const domain = cleanProjectDomain(req.body?.domain);

  if (!domain) {
    return res.status(400).json({ error: "Le domaine est requis." });
  }
  if (!PROJECT_DOMAIN_RE.test(domain)) {
    return res.status(400).json({
      error: "Le domaine doit avoir la structure « nomdusite.com » (ex : paraexpert.tn, mon-site.fr).",
    });
  }

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
           language = $4,
           branded_keywords = $5
       WHERE id = $6 AND userid = $7
       RETURNING id, name, domain, country, language, branded_keywords, created_at, userid AS "userId"`,
      [name, domain, country, language, branded_keywords ?? existing.rows[0].branded_keywords, projectId, req.user.id]
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
      ON CONFLICT (projectid, (LOWER(immutable_unaccent(keyword))), date)
      DO UPDATE SET
        keyword     = EXCLUDED.keyword,
        impressions = EXCLUDED.impressions,
        clicks      = EXCLUDED.clicks,
        position    = EXCLUDED.position,
        ctr         = EXCLUDED.ctr
    `;

    await pool.query(query, values);
    res.json({ success: true, count: data.length });
  } catch (err) {
    console.error("Bulk GSC insert error:", err);
    res.status(500).json({ error: "Insert failed" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// /api/ingest/serp v2 — accepte le payload SerpAPI brut tel quel.
// Schéma serp_daily v2 (voir migrations/serp_daily_v2.sql).
// ─────────────────────────────────────────────────────────────────────────────

// Zod — .passthrough() partout pour ne pas casser si SerpAPI ajoute des champs
const SerpItemSchema = z.object({
  search_metadata:    z.object({ created_at: z.string().optional() }).passthrough().optional(),
  search_parameters:  z.object({
    q:      z.string(),
    engine: z.string().optional(),
    device: z.string().optional(),
    gl:     z.string().optional(),
    hl:     z.string().optional(),
  }).passthrough(),
  search_information: z.object({ total_results: z.number().optional() }).passthrough().optional(),
  organic_results:    z.array(z.any()).optional(),
  related_questions:  z.array(z.any()).optional(),
  related_searches:   z.array(z.any()).optional(),
  ai_overview:        z.object({
    text_blocks: z.array(z.any()).optional(),
    references:  z.array(z.any()).optional(),
  }).passthrough().optional(),
  knowledge_graph:    z.any().optional(),
  inline_videos:      z.array(z.any()).optional(),
  inline_images:      z.array(z.any()).optional(),
  short_videos:       z.array(z.any()).optional(),
  error:              z.string().optional(),
}).passthrough();

const IngestPayloadSchema = z.object({
  projectId: z.number().int().positive(),
  items:     z.array(SerpItemSchema).min(1),
});

// Helpers
function extractDomain(url: string | undefined | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

function transformOrganic(arr: any[] | undefined): any[] {
  if (!Array.isArray(arr)) return [];
  return arr.map((r: any) => ({
    position:   r.position ?? null,
    title:      r.title ?? null,
    link:       r.link ?? null,
    displayed_link: r.displayed_link ?? null,
    domain:     extractDomain(r.link),
    snippet:    r.snippet ?? null,
    sitelinks:  Array.isArray(r.sitelinks?.inline) ? r.sitelinks.inline
                : Array.isArray(r.sitelinks?.expanded) ? r.sitelinks.expanded
                : Array.isArray(r.sitelinks) ? r.sitelinks
                : [],
    rich_snippet: r.rich_snippet ?? null,
  }));
}

function transformPaa(arr: any[] | undefined): any[] {
  if (!Array.isArray(arr)) return [];
  return arr.map((q: any) => ({
    question: q.question ?? null,
    snippet:  q.snippet ?? null,
    title:    q.title ?? null,
    link:     q.link ?? null,
  }));
}

function transformRelatedSearches(arr: any[] | undefined): any[] {
  if (!Array.isArray(arr)) return [];
  return arr.map((r: any) => ({
    query: r.query ?? r.text ?? null,
    link:  r.link ?? null,
  }));
}

function transformAiOverview(aio: any, projectDomain: string | null): { json: any; cited: boolean } {
  if (!aio) return { json: null, cited: false };
  const refs = Array.isArray(aio.references) ? aio.references : [];
  const cited = !!projectDomain && refs.some((r: any) => {
    const d = extractDomain(r?.link);
    return d && (d === projectDomain || d.endsWith(`.${projectDomain}`));
  });
  return {
    json: {
      text_blocks: aio.text_blocks ?? [],
      references:  refs.map((r: any) => ({
        title: r.title ?? null,
        link:  r.link ?? null,
        domain: extractDomain(r.link),
        source: r.source ?? null,
      })),
    },
    cited,
  };
}

function findYourPosition(
  organic: any[],
  projectDomain: string | null
): { position: number | null; url: string | null; title: string | null; snippet: string | null } {
  if (!projectDomain || !Array.isArray(organic)) {
    return { position: null, url: null, title: null, snippet: null };
  }
  for (const r of organic) {
    const d = r?.domain || extractDomain(r?.link);
    if (d && (d === projectDomain || d.endsWith(`.${projectDomain}`))) {
      return {
        position: typeof r.position === "number" ? r.position : null,
        url:      r.link ?? null,
        title:    r.title ?? null,
        snippet:  r.snippet ?? null,
      };
    }
  }
  return { position: null, url: null, title: null, snippet: null };
}

app.post("/api/ingest/serp", checkApiKey, async (req, res) => {
  // Temp request logger to diagnose n8n callbacks
  const bodyKeys = Object.keys(req.body || {});
  const itemsPreview = Array.isArray(req.body?.items)
    ? `items[${req.body.items.length}]`
    : Array.isArray(req.body?.data)
      ? `data[${req.body.data.length}] (LEGACY SHAPE)`
      : "no items/data";
  console.log(`[ingest/serp] HIT — keys=[${bodyKeys.join(",")}] ${itemsPreview} from=${req.ip}`);

  // 1) Validate body
  const parsed = IngestPayloadSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid payload", details: parsed.error.issues });
  }
  const { projectId, items } = parsed.data;

  // 2) Project + domain
  const projRes = await pool.query("SELECT id, domain FROM projects WHERE id = $1", [projectId]);
  if (projRes.rows.length === 0) {
    return res.status(404).json({ error: `Project ${projectId} not found` });
  }
  const projectDomain = extractDomain(projRes.rows[0].domain) ?? (projRes.rows[0].domain ?? "").toLowerCase() ?? null;

  // 3) Maintain master keywords list (idempotent insert)
  await upsertKeywords(projectId, items.map((i) => ({ keyword: i.search_parameters.q })));

  // 4) Build rows + collect item-level errors so one bad item doesn't kill the batch
  const rows: any[] = [];
  const errors: { keyword?: string; error: string }[] = [];

  for (const item of items) {
    try {
      const sp = item.search_parameters;
      const keyword = sp.q;
      const date    = normalizeDate(item.search_metadata?.created_at || new Date().toISOString());
      const device  = (sp.device || "desktop").toLowerCase();
      const engine  = sp.engine || "google";

      const organicTransformed = transformOrganic(item.organic_results);
      const paaTransformed     = transformPaa(item.related_questions);
      const relatedTransformed = transformRelatedSearches(item.related_searches);
      const aio                = transformAiOverview(item.ai_overview, projectDomain);
      const yours              = findYourPosition(organicTransformed, projectDomain);

      const has_ai_overview     = !!item.ai_overview;
      const has_paa             = paaTransformed.length > 0;
      const has_knowledge_graph = !!item.knowledge_graph;
      const has_inline_videos   = Array.isArray(item.inline_videos) && item.inline_videos.length > 0
                                || Array.isArray(item.short_videos) && item.short_videos.length > 0;
      const has_inline_images   = Array.isArray(item.inline_images) && item.inline_images.length > 0;
      const has_sitelinks       = organicTransformed.some((r: any) => Array.isArray(r.sitelinks) && r.sitelinks.length > 0);
      const has_rich_snippets   = organicTransformed.some((r: any) => r.rich_snippet);

      rows.push({
        projectid: projectId,
        keyword,
        date,
        device,
        gl: sp.gl ?? null,
        hl: sp.hl ?? null,
        engine,
        your_position: yours.position,
        your_url:      yours.url,
        your_title:    yours.title,
        your_snippet:  yours.snippet,
        your_in_aio:   aio.cited,
        has_ai_overview,
        has_paa,
        has_knowledge_graph,
        has_inline_videos,
        has_inline_images,
        has_sitelinks,
        has_rich_snippets,
        total_results: item.search_information?.total_results ?? null,
        organic_count: organicTransformed.length,
        paa_count:     paaTransformed.length,
        organic_results:  JSON.stringify(organicTransformed),
        paa_questions:    JSON.stringify(paaTransformed),
        related_searches: JSON.stringify(relatedTransformed),
        ai_overview:      aio.json ? JSON.stringify(aio.json) : null,
        knowledge_graph:  item.knowledge_graph ? JSON.stringify(item.knowledge_graph) : null,
        raw_response:     JSON.stringify(item),
        error:            item.error ?? null,
        scraped_at:       item.search_metadata?.created_at ?? null,
      });
    } catch (e: any) {
      errors.push({ keyword: item?.search_parameters?.q, error: e?.message || "transform failed" });
    }
  }

  if (rows.length === 0) {
    return res.status(200).json({
      success: true,
      inserted: 0,
      errors,
      project_domain: projectDomain,
    });
  }

  // 5) Bulk UPSERT inside a transaction
  const COLS = [
    "projectid","keyword","date","device","gl","hl","engine",
    "your_position","your_url","your_title","your_snippet","your_in_aio",
    "has_ai_overview","has_paa","has_knowledge_graph","has_inline_videos",
    "has_inline_images","has_sitelinks","has_rich_snippets",
    "total_results","organic_count","paa_count",
    "organic_results","paa_questions","related_searches","ai_overview","knowledge_graph",
    "raw_response","error","scraped_at",
  ];
  const N = COLS.length;
  const values: any[] = [];
  const placeholders = rows.map((row, i) => {
    const ph = COLS.map((_c, j) => `$${i * N + j + 1}`).join(",");
    for (const c of COLS) values.push((row as any)[c]);
    return `(${ph})`;
  }).join(",");

  // jsonb columns: cast in the INSERT
  const colsList = COLS.map((c) => {
    if (["organic_results","paa_questions","related_searches","ai_overview","knowledge_graph","raw_response"].includes(c)) {
      return c;
    }
    return c;
  }).join(",");

  // Build a SELECT … FROM (VALUES …) approach via casts on the placeholders
  // Simpler: use ::jsonb in the column list of UPDATE; for the INSERT itself rely
  // on text→jsonb implicit cast by passing JSON.stringify above and using ::jsonb on conflict.
  const insertSql = `
    INSERT INTO serp_daily (${colsList})
    VALUES ${placeholders}
    ON CONFLICT (projectid, (LOWER(immutable_unaccent(keyword))), date, device) DO UPDATE SET
      keyword             = EXCLUDED.keyword,
      gl                  = EXCLUDED.gl,
      hl                  = EXCLUDED.hl,
      engine              = EXCLUDED.engine,
      your_position       = EXCLUDED.your_position,
      your_url            = EXCLUDED.your_url,
      your_title          = EXCLUDED.your_title,
      your_snippet        = EXCLUDED.your_snippet,
      your_in_aio         = EXCLUDED.your_in_aio,
      has_ai_overview     = EXCLUDED.has_ai_overview,
      has_paa             = EXCLUDED.has_paa,
      has_knowledge_graph = EXCLUDED.has_knowledge_graph,
      has_inline_videos   = EXCLUDED.has_inline_videos,
      has_inline_images   = EXCLUDED.has_inline_images,
      has_sitelinks       = EXCLUDED.has_sitelinks,
      has_rich_snippets   = EXCLUDED.has_rich_snippets,
      total_results       = EXCLUDED.total_results,
      organic_count       = EXCLUDED.organic_count,
      paa_count           = EXCLUDED.paa_count,
      organic_results     = EXCLUDED.organic_results,
      paa_questions       = EXCLUDED.paa_questions,
      related_searches    = EXCLUDED.related_searches,
      ai_overview         = EXCLUDED.ai_overview,
      knowledge_graph     = EXCLUDED.knowledge_graph,
      raw_response        = EXCLUDED.raw_response,
      error               = EXCLUDED.error,
      scraped_at          = EXCLUDED.scraped_at
  `;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(insertSql, values);
    await client.query("COMMIT");
  } catch (err: any) {
    await client.query("ROLLBACK");
    console.error("[ingest/serp] insert failed, rolled back:", err);
    return res.status(500).json({ error: "Insert failed", details: err?.message });
  } finally {
    client.release();
  }

  return res.json({
    success: true,
    inserted: rows.length,
    errors,
    project_domain: projectDomain,
  });
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

// Courbes CTR de référence (Advanced Web Ranking / Sistrix) — source: Référentiel KPIs SEO v1.0
const EXPECTED_CTR_BY_POSITION: Record<number, number> = {
  1: 0.28, 2: 0.15, 3: 0.11, 4: 0.08, 5: 0.07,
  6: 0.05, 7: 0.04, 8: 0.03, 9: 0.03, 10: 0.03,
};

function getExpectedCtr(position: number): number {
  const pos = Math.round(Number(position) || 20);
  if (pos >= 1 && pos <= 10) return EXPECTED_CTR_BY_POSITION[pos];
  if (pos <= 15) return 0.02;
  if (pos <= 30) return 0.01;
  return 0.005;
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

  // Bonus SERP si disponible (optionnel) — schéma serp_daily v2.
  // L'ancienne colonne `competition` n'existe plus ; on s'appuie sur les SERP features.
  if (serpRow) {
    if (serpRow.has_ai_overview === true) score = Math.min(1, score + 0.10);
    const paa = Number(serpRow.paa_count ?? 0);
    if (paa >= 4) score = Math.min(1, score + 0.08);
    else if (paa >= 2) score = Math.min(1, score + 0.04);
    if (serpRow.has_knowledge_graph === true) score = Math.min(1, score + 0.05);
  }

  return Math.round(score * 1000) / 1000;
}

// CTR_gap = CTR_observé − CTR_attendu(position)
// Négatif = sous-performance du snippet, positif = sur-performance
function computeCtrGap(position: number, realCtr: number): number {
  const expected = getExpectedCtr(Number(position) || 20);
  const real = Number(realCtr) || 0;
  return Math.round((real - expected) * 10000) / 10000;
}

// Opportunity Score = impressions × (CTR_top3 − CTR_actuel)
// Exprimé en clics potentiels gagnés si la page atteint le top 3 (P3 ≈ 11 %)
// Source : Référentiel KPIs SEO v1.0 §4.2
const CTR_TOP3 = 0.11;

function computeOpportunityScore(impressions: number, actualCtr: number): number {
  const imp = Number(impressions) || 0;
  const ctr = Number(actualCtr) || 0;
  const gain = CTR_TOP3 - ctr;
  if (gain <= 0 || imp === 0) return 0;
  return Math.round(imp * gain * 10) / 10;
}

// Quick Win Score = impressions × (1/position) × (16 − position) pour P5–P15
// "Striking distance keywords" — meilleur ROI à court terme
// Source : Référentiel KPIs SEO v1.0 §7.1
function computeQuickWinScore(position: number, impressions: number): number {
  const pos = Number(position) || 100;
  const imp = Number(impressions) || 0;
  if (pos < 5 || pos > 15) return 0;
  return Math.round(imp * (1 / pos) * (16 - pos) * 10) / 10;
}

// Score composite de priorisation = log(impressions) × max(0, CTR_top3 − CTR_actuel) × proximity_factor
// proximity_factor : 1 si pos ≤ 15, 0.3 si 16–30, 0 au-delà
// Source : Référentiel KPIs SEO v1.0 §7.5
function computePriorityScore(impressions: number, actualCtr: number, position: number): number {
  const pos = Number(position) || 100;
  const imp = Number(impressions) || 0;
  const ctr = Number(actualCtr) || 0;
  const ctrGain = Math.max(0, CTR_TOP3 - ctr);
  const proximityFactor = pos <= 15 ? 1 : pos <= 30 ? 0.3 : 0;
  if (imp <= 0 || proximityFactor === 0) return 0;
  return Math.round(Math.log10(imp) * ctrGain * proximityFactor * 10000) / 10000;
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
    // Vélocité de position = différentiel de position pondérée sur 2 fenêtres de 28 jours
    const [gscRes, serpRes, recentWindowRes, prevWindowRes] = await Promise.all([
      pool.query(
        `SELECT * FROM gsc_daily WHERE projectid=$1 AND LEFT(date::text,10)=$2`,
        [projectId, nd]
      ),
      pool.query(
        `SELECT keyword, paa_count, has_ai_overview, has_knowledge_graph,
                organic_results, your_position
         FROM serp_daily WHERE projectid=$1 AND date=$2::date`,
        [projectId, nd]
      ),
      // Fenêtre récente : 28 jours se terminant à la date de calcul
      pool.query(
        `SELECT keyword,
           SUM(position * impressions) / NULLIF(SUM(impressions), 0) AS weighted_pos
         FROM gsc_daily
         WHERE projectid=$1
           AND date::date >= ($2::date - interval '27 days')
           AND date::date <= $2::date
         GROUP BY keyword`,
        [projectId, nd]
      ),
      // Fenêtre précédente : 28 jours avant la fenêtre récente
      pool.query(
        `SELECT keyword,
           SUM(position * impressions) / NULLIF(SUM(impressions), 0) AS weighted_pos
         FROM gsc_daily
         WHERE projectid=$1
           AND date::date >= ($2::date - interval '55 days')
           AND date::date < ($2::date - interval '27 days')
         GROUP BY keyword`,
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
    const serpMap      = new Map<string, any>(serpData.map((s: any) => [s.keyword, s]));
    const recentPosMap = new Map<string, any>(recentWindowRes.rows.map((r: any) => [r.keyword, r]));
    const prevPosMap   = new Map<string, any>(prevWindowRes.rows.map((r: any) => [r.keyword, r]));

    const results: any[] = [];
    let serpMatchCount = 0;

    for (const g of gscData) {
      const s = serpMap.get(g.keyword) || null;
      if (s) serpMatchCount++;

      const position    = Number(g.position)    || 50;
      const realCtr     = Number(g.ctr)         || 0;
      const impressions = Number(g.impressions) || 0;
      const long_tail   = g.keyword.trim().split(/\s+/).length >= 4 ? 1 : 0;

      const competition_score = computeCompetitionScore(g, s);
      const ctr_gap           = computeCtrGap(position, realCtr);
      const opportunity_score = computeOpportunityScore(impressions, realCtr);
      const quick_win_score   = computeQuickWinScore(position, impressions);
      const priority_score    = computePriorityScore(impressions, realCtr, position);

      // Vélocité de position sur 28 jours (position_pondérée_récente − position_pondérée_précédente)
      // Positif = perte de rang, négatif = gain de rang
      const recentPos = recentPosMap.get(g.keyword);
      const prevPos   = prevPosMap.get(g.keyword);
      const performance_drift = (recentPos?.weighted_pos != null && prevPos?.weighted_pos != null)
        ? Math.round((Number(recentPos.weighted_pos) - Number(prevPos.weighted_pos)) * 100) / 100
        : 0;

      results.push({
        projectId, keyword: g.keyword, date: nd,
        competition_score, opportunity_score,
        ctr_gap, performance_drift, long_tail_indicator: long_tail,
        quick_win_score, priority_score,
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
      item.quick_win_score, item.priority_score,
    ]);
    const placeholders = results
      .map((_, i) => `($${i*10+1},$${i*10+2},$${i*10+3},$${i*10+4},$${i*10+5},$${i*10+6},$${i*10+7},$${i*10+8},$${i*10+9},$${i*10+10})`)
      .join(",");

    await pool.query(
      `INSERT INTO scores_daily
         (projectid,keyword,date,competition_score,opportunity_score,ctr_gap,performance_drift,long_tail_indicator,quick_win_score,priority_score)
       VALUES ${placeholders}
       ON CONFLICT (projectid, (LOWER(immutable_unaccent(keyword))), date) DO UPDATE SET
         keyword             = EXCLUDED.keyword,
         competition_score   = EXCLUDED.competition_score,
         opportunity_score   = EXCLUDED.opportunity_score,
         ctr_gap             = EXCLUDED.ctr_gap,
         performance_drift   = EXCLUDED.performance_drift,
         long_tail_indicator = EXCLUDED.long_tail_indicator,
         quick_win_score     = EXCLUDED.quick_win_score,
         priority_score      = EXCLUDED.priority_score`,
      values
    );

    console.log(`[KPI] ✓ Upserted ${results.length} rows into scores_daily\n`);

    // Refresh keywords.position/ctr/impressions snapshot to today's value,
    // and prev_position/prev_ctr to the value 7 days ago (used by the Tracking page evolution column).
    await pool.query(
      `
      WITH latest AS (
        SELECT keyword, position, ctr, impressions
        FROM gsc_daily
        WHERE projectid = $1 AND LEFT(date::text, 10) = $2
      ),
      prev AS (
        SELECT DISTINCT ON (keyword) keyword, position, ctr
        FROM gsc_daily
        WHERE projectid = $1
          AND LEFT(date::text, 10)::date <= ($2::date - interval '7 days')
        ORDER BY keyword, date DESC
      )
      UPDATE keywords k
      SET position      = COALESCE(l.position, k.position),
          ctr           = COALESCE(l.ctr, k.ctr),
          impressions   = COALESCE(l.impressions, k.impressions),
          prev_position = COALESCE(p.position, k.prev_position),
          prev_ctr      = COALESCE(p.ctr, k.prev_ctr)
      FROM latest l
      LEFT JOIN prev p ON p.keyword = l.keyword
      WHERE k.projectid = $1 AND k.keyword = l.keyword
      `,
      [projectId, nd]
    );

    // Auto-qualify NLP + auto-cluster — best effort, never fails the KPI compute
    let qualifySummary: string | null = null;
    let clusterCount: number | null = null;
    try {
      const scoreByKw = new Map<string, any>(results.map((r) => [r.keyword, r]));
      const qualifyInput = gscData.map((g: any) => {
        const sc = scoreByKw.get(g.keyword);
        return {
          keyword: g.keyword,
          position: Number(g.position) || 0,
          ctr: Number(g.ctr) || 0,
          impressions: Number(g.impressions) || 0,
          opportunity_score: sc?.opportunity_score ?? 0,
        };
      });

      const qualifyOut = await qualifyKeywordsCore(Number(projectId), qualifyInput, nd);
      qualifySummary = `${qualifyOut.cachedCount} cached / ${qualifyOut.newCount} new / ${qualifyOut.llmCount} via LLM`;

      if (qualifyOut.newCount > 0) {
        try {
          const clusterOut = await clusterProjectKeywordsCore(Number(projectId));
          clusterCount = clusterOut.clusters.length;
        } catch (clusterErr) {
          console.error("[KPI] auto-cluster failed:", clusterErr);
        }
      }
    } catch (qualifyErr) {
      console.error("[KPI] auto-qualify failed:", qualifyErr);
    }

    res.json({
      success: true,
      count: results.length,
      serpEnrichment: `${serpMatchCount}/${gscData.length}`,
      nonZeroOpportunity: nonZeroOpp,
      qualify: qualifySummary,
      clusters: clusterCount,
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

        s.your_position    AS serp_position,
        s.your_url,
        s.your_title,
        s.your_snippet,
        s.your_in_aio,
        s.organic_count    AS serp_result_count,
        s.organic_results  -> 0 ->> 'title' AS serp_top1_title,
        s.organic_results  -> 0 ->> 'link'  AS serp_top1_link,
        s.paa_count,
        s.has_ai_overview  AS ai_overview_present,
        s.has_paa,
        s.has_knowledge_graph,
        s.has_sitelinks,

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
      s.your_position    AS serp_position,
      s.your_url,
      s.your_title,
      s.your_snippet,
      s.your_in_aio,
      s.organic_count    AS serp_result_count,
      s.organic_results  -> 0 ->> 'title' AS serp_top1_title,
      s.organic_results  -> 0 ->> 'link'  AS serp_top1_link,
      s.paa_count,
      s.has_ai_overview  AS ai_overview_present,
      s.has_paa,
      s.has_knowledge_graph,
      s.has_sitelinks,
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
        COALESCE(ROUND((SUM(g.clicks)::numeric / NULLIF(SUM(g.impressions), 0)) * 100, 2), 0) AS avg_ctr,
        COALESCE(ROUND((SUM(g.position * g.impressions)::numeric / NULLIF(SUM(g.impressions), 0)), 2), 0) AS avg_position
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
          WHEN LOWER(COALESCE(n.branded_status, 'non-branded')) IN ('branded', 'brand') THEN 'Branded'
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
        COUNT(*) FILTER (WHERE performance_drift >= 5) AS strong_drop,
        COUNT(*) FILTER (WHERE performance_drift >= 2 AND performance_drift < 5) AS to_watch,
        COUNT(*) FILTER (WHERE opportunity_score >= 200) AS opportunities
      FROM latest_scores
    `;

    const keywordsQuery = `
      SELECT
        k.id,
        k.projectid AS "projectId",
        k.keyword,
        k.position,
        k.prev_position,
        k.impressions,
        k.ctr,
        k.prev_ctr,
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
          s.your_position    AS serp_position,
          s.your_in_aio,
          s.has_ai_overview,
          s.has_paa,
          s.has_knowledge_graph,
          s.paa_count
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
          sc.quick_win_score,
          sc.priority_score,
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
        COALESCE(lg.position, k.position, 0) AS position,
        0 AS trend,
        COALESCE(lg.impressions, k.impressions, 0) AS impressions,
        COALESCE(lg.ctr, k.ctr, 0) AS ctr,
        COALESCE(sc.competition_score, 0) AS competition_score,
        COALESCE(sc.opportunity_score, 0) AS opportunity_score,
        COALESCE(sc.quick_win_score, 0) AS quick_win_score,
        COALESCE(sc.priority_score, 0) AS priority_score,
        COALESCE(sc.ctr_gap, 0) AS ctr_gap,
        COALESCE(sc.performance_drift, 0) AS performance_drift,
        COALESCE(
          sc.long_tail_indicator,
          CASE WHEN array_length(string_to_array(k.keyword, ' '), 1) > 3 THEN 1 ELSE 0 END
        ) AS long_tail_indicator,
        COALESCE(ln.branded_status, 'non-branded') AS branded_status,
        COALESCE(ln.stability_status, 'opportunity') AS stability_status,
        COALESCE(ln.tail_type, 'generic') AS tail_type,
        COALESCE(ln.search_intent, 'informationnelle') AS search_intent,
        COALESCE(ln.exclude_from_opportunity, false) AS exclude_from_opportunity,
        ln.qualification_label,
        ln.priority_level,
        ln.action_hint,
        ln.reasoning,
        COALESCE(ls.has_ai_overview, false) AS has_ai_overview,
        COALESCE(ls.your_in_aio, false)     AS your_in_aio,
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
        COALESCE(lg.impressions, k.impressions, 0) DESC,
        COALESCE(lg.position, k.position, 50) ASC
      LIMIT 100
    `;

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error("Opportunities error:", err);
    res.status(500).json({ error: "Failed to fetch opportunities" });
  }
});

// Cache-aware NLP qualification core. Skips keywords already enriched for the
// given (projectId, keyword, date), so re-calling for the same day is free.
// Used by both POST /api/nlp/qualify (modal) and POST /api/compute/kpis (auto).
async function qualifyKeywordsCore(
  projectId: number,
  keywords: any[],
  date: string,
): Promise<{ results: any[]; cachedCount: number; newCount: number; llmCount: number }> {
  if (!Array.isArray(keywords) || keywords.length === 0) {
    return { results: [], cachedCount: 0, newCount: 0, llmCount: 0 };
  }

  const today = normalizeDate(date || new Date().toISOString());

  // 0) Cache lookup \u2014 what's already in DB for this (project, date)?
  const kwList = keywords.map((k: any) => k.keyword).filter(Boolean);
  const cachedRes = await pool.query(
    `SELECT keyword, branded_status, stability_status, tail_type, search_intent,
            exclude_from_opportunity, qualification_label, priority_level,
            action_hint, reasoning
     FROM nlp_keyword_enrichment
     WHERE projectid = $1 AND date = $2 AND keyword = ANY($3)`,
    [projectId, today, kwList]
  );
  const cachedMap = new Map<string, any>(cachedRes.rows.map((r: any) => [r.keyword, r]));

  const pendingKeywords = keywords.filter((k: any) => !cachedMap.has(k.keyword));
  const cachedKeywords  = keywords.filter((k: any) => cachedMap.has(k.keyword));

  // Branded keywords du projet (only needed if anything is pending)
  let brandedKeywords: string[] = [];
  if (pendingKeywords.length > 0) {
    try {
      const projRes = await pool.query("SELECT branded_keywords FROM projects WHERE id=$1", [projectId]);
      if (projRes.rows[0]?.branded_keywords) {
        brandedKeywords = String(projRes.rows[0].branded_keywords)
          .split(/[,\n]/).map((k: string) => k.trim()).filter(Boolean);
      }
    } catch (_) {}
  }

  // 1) Rules-based classification on PENDING only
  const ruleResults = pendingKeywords.map((item: any) => ({
    ...item,
    ...classifyByRules(item.keyword || "", brandedKeywords),
  }));

  const lowConf = ruleResults.filter((r: any) => r.confidence === "low");
  let llmCount = 0;
  const llmMap = new Map<string, any>();

  if (lowConf.length > 0) {
    try {
      const prompt = `Tu es un expert NLP SEO. Analyse ces mots-cl\u00e9s et retourne leur classification.

Donn\u00e9es (JSON): ${JSON.stringify(lowConf.map((r: any) => ({
        keyword: r.keyword,
        position: r.position || 0,
        ctr: r.ctr || 0,
        opportunity_score: r.opportunity_score || 0,
      })))}

R\u00c8GLES :
search_intent \u2014 UN seul parmi :
  "transactionnelle" \u2192 acheter, prix, devis, commander, tarif, promo, pas cher, livraison, abonnement
  "navigationnelle"  \u2192 acc\u00e8s direct \u00e0 un site/marque, connexion, login, espace client
  "informationnelle" \u2192 apprendre, comprendre, guide, comment, pourquoi, d\u00e9finition

branded_status : "branded" si nom de marque, sinon "non_branded"
stability_status : "stable" si position<=10 ET ctr>0.05, sinon "opportunity"
priority_level : "high" si opp_score>0.5 ou (pos 4-15 et vol>500), "medium" si 0.1-0.5, "low" sinon
qualification_label : phrase courte (ex: "Opportunit\u00e9 long-tail commerciale")
action_hint : action SEO concr\u00e8te (ex: "Optimiser le titre avec le mot prix")
reasoning : 1-2 phrases max

RETOURNE UNIQUEMENT un objet JSON valide de la forme :
{"results": [{"keyword","search_intent","branded_status","stability_status","priority_level","qualification_label","action_hint","reasoning"}]}`;

      const nlpResp = await zhipu.chat.completions.create({
        model: "glm-4.5",
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
      });

      let rawText = (nlpResp.choices[0].message.content || "{}").trim()
        .replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/i, "").trim();

      const parsed = JSON.parse(rawText);
      const arr: any[] = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed?.results)
          ? parsed.results
          : Object.values(parsed || {}).find((v: any) => Array.isArray(v)) as any[] || [];
      arr.forEach((item: any) => { if (item?.keyword) llmMap.set(item.keyword, item); });
      llmCount = llmMap.size;
    } catch (llmErr) {
      console.error("[NLP] LLM failed, using rules only:", llmErr);
    }
  }

  // 2) Merge rules + LLM
  const VALID_INTENTS   = ["informationnelle","transactionnelle","navigationnelle"];
  const VALID_BRANDED   = ["branded","non_branded"];
  const VALID_STABILITY = ["stable","opportunity"];
  const VALID_PRIORITY  = ["low","medium","high"];

  const newResults = ruleResults.map((ruleItem: any) => {
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

    return {
      keyword: ruleItem.keyword,
      search_intent, branded_status,
      stability_status: stability,
      tail_type, exclude_from_opportunity,
      priority_level: priority,
      qualification_label: llm?.qualification_label || `${search_intent} / ${tail_type}`,
      action_hint: llm?.action_hint || "Analyser et optimiser le contenu existant",
      reasoning: llm?.reasoning || `Classifi\u00e9 par r\u00e8gles (confidence: ${ruleItem.confidence})`,
      kpi_interpretation: {
        search_intent: `Intent: ${search_intent}${llm ? " (LLM)" : " (r\u00e8gles)"}`,
        branded: `Branded: ${branded_status}`,
        tail: `Type: ${tail_type} (${words} mots)`,
      },
    };
  });

  // 3) Upsert new results
  for (const item of newResults) {
    try {
      await pool.query(
        `INSERT INTO nlp_keyword_enrichment
           (projectid,keyword,date,branded_status,stability_status,tail_type,
            search_intent,exclude_from_opportunity,qualification_label,priority_level,
            action_hint,reasoning)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT(projectid, (LOWER(immutable_unaccent(keyword))), date) DO UPDATE SET
           keyword=EXCLUDED.keyword,
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
    } catch (dbErr) {
      console.error(`[NLP] DB error for "${item.keyword}":`, dbErr);
    }
  }

  // 4) Build final results in original input order
  const newByKw = new Map<string, any>(newResults.map((r) => [r.keyword, r]));
  const results = keywords.map((k: any) => {
    const fresh = newByKw.get(k.keyword);
    if (fresh) return fresh;
    const c = cachedMap.get(k.keyword);
    const words = (c.keyword || "").trim().split(/\s+/).length;
    return {
      keyword: c.keyword,
      search_intent: c.search_intent,
      branded_status: c.branded_status,
      stability_status: c.stability_status,
      tail_type: c.tail_type,
      exclude_from_opportunity: c.exclude_from_opportunity,
      priority_level: c.priority_level,
      qualification_label: c.qualification_label,
      action_hint: c.action_hint,
      reasoning: c.reasoning,
      kpi_interpretation: {
        search_intent: `Intent: ${c.search_intent} (cache)`,
        branded: `Branded: ${c.branded_status}`,
        tail: `Type: ${c.tail_type} (${words} mots)`,
      },
    };
  });

  console.log(
    `[NLP] cached ${cachedKeywords.length} / new ${newResults.length} / LLM ${llmCount} (project ${projectId})`
  );

  return {
    results,
    cachedCount: cachedKeywords.length,
    newCount: newResults.length,
    llmCount,
  };
}

app.post("/api/nlp/qualify", authenticate, async (req: any, res) => {
  const { projectId, keywords, date } = req.body;
  if (!projectId || !keywords || !Array.isArray(keywords)) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  console.log(`\n[NLP] \u25b6 qualify ${keywords.length} keywords for project ${projectId}`);

  try {
    const out = await qualifyKeywordsCore(Number(projectId), keywords, date);
    const intentDist = out.results.reduce((acc: any, r) => {
      acc[r.search_intent] = (acc[r.search_intent] || 0) + 1;
      return acc;
    }, {});
    return res.json({ success: true, results: out.results, intentDistribution: intentDist });
  } catch (err) {
    console.error("[NLP] qualify error:", err);
    return res.status(500).json({ error: "Failed to qualify keywords" });
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
        ON CONFLICT(projectid, (LOWER(immutable_unaccent(keyword))), date)
        DO UPDATE SET
          keyword = EXCLUDED.keyword,
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
          item.projectId ?? item.project_id,
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

// Regenerate semantic clusters for a project. Used by both POST
// /api/projects/:id/cluster (manual refresh) and the auto-cluster step in
// /api/compute/kpis (after new keywords were qualified).
async function clusterProjectKeywordsCore(projectId: number): Promise<{ clusters: any[] }> {
  const keywordsRes = await pool.query(
    "SELECT keyword FROM keywords WHERE projectid = $1",
    [projectId]
  );
  const keywords = keywordsRes.rows;
  if (keywords.length === 0) {
    console.log(`[CLUSTER] project ${projectId}: 0 keywords, skipped`);
    return { clusters: [] };
  }

  const keywordList = keywords.map((k: any) => k.keyword).join(", ");
  const prompt = `Tu es un expert SEO. Regroupe les mots-clés suivants en clusters sémantiques logiques.
Pour chaque cluster, donne un nom, une brève description, la liste des mots-clés et un niveau de priorité (High, Medium, Low).
Mots-clés: ${keywordList}
RETOURNE UNIQUEMENT un objet JSON valide de la forme:
{"clusters": [{"cluster_name": "...", "description": "...", "keywords": ["..."], "priority": "High|Medium|Low"}]}`;

  const clusterResp = await zhipu.chat.completions.create({
    model: "glm-4.5",
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" },
  });

  const parsed = JSON.parse(clusterResp.choices[0].message.content || "{}");
  const clusters: any[] = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.clusters)
      ? parsed.clusters
      : Object.values(parsed || {}).find((v: any) => Array.isArray(v)) as any[] || [];

  await pool.query("DELETE FROM keyword_clusters WHERE projectid = $1", [projectId]);

  for (const c of clusters) {
    if (!c?.cluster_name) continue;
    await pool.query(
      `INSERT INTO keyword_clusters
       (projectid, cluster_name, keywords, description, priority)
       VALUES ($1, $2, $3, $4, $5)`,
      [projectId, c.cluster_name, JSON.stringify(c.keywords || []), c.description || "", c.priority || "Medium"]
    );
  }

  console.log(`[CLUSTER] project ${projectId}: regenerated ${clusters.length} clusters`);
  return { clusters };
}

app.post("/api/projects/:projectId/cluster", authenticate, async (req: any, res) => {
  const { projectId } = req.params;
  try {
    const out = await clusterProjectKeywordsCore(Number(projectId));
    res.json({ success: true, clusters: out.clusters });
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
      clustersRes.rows.map((c: any) => {
        let kw: any[] = [];
        try {
          kw = c.keywords ? JSON.parse(c.keywords) : [];
          if (!Array.isArray(kw)) kw = [];
        } catch {
          kw = [];
        }
        return { ...c, keywords: kw };
      })
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
        g.impressions,
        sc.opportunity_score,
        n.action_hint
      FROM keywords k
      LEFT JOIN gsc_daily g
        ON k.projectid = g.projectid
       AND k.keyword = g.keyword
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
RETOURNE UNIQUEMENT un objet JSON valide de la forme:
{"plan": [{"title": "...", "description": "...", "priority": "High|Medium|Low", "impact": "High|Medium|Low"}]}`;

    const planResp = await zhipu.chat.completions.create({
      model: "glm-4.5",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
    });

    const parsed = JSON.parse(planResp.choices[0].message.content || "{}");
    const plan: any[] = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed?.plan)
        ? parsed.plan
        : Object.values(parsed || {}).find((v: any) => Array.isArray(v)) as any[] || [];
    res.json(plan);
  } catch (err) {
    console.error("Action Plan error:", err);
    res.status(500).json({ error: "Failed to generate action plan" });
  }
});

// ── AI: Dashboard interpretation ─────────────────────────────────────────────
app.post("/api/ai/dashboard-interpretation", authenticate, async (req: any, res) => {
  const { stats, keywords } = req.body;
  try {
    const resp = await zhipu.chat.completions.create({
      model: "glm-4.5",
      messages: [
        {
          role: "system",
          content: "Tu es un expert en SEO et Business Intelligence. Tu fournis des analyses précises et exploitables en français.",
        },
        {
          role: "user",
          content: `Analyse les données SEO suivantes et fournis une interprétation concise et professionnelle en français.
Stats: ${JSON.stringify(stats)}
Top mots-clés: ${JSON.stringify((keywords || []).slice(0, 5))}

Focus sur :
1. La tendance globale de performance.
2. Les points de vigilance spécifiques (ex: CTR faible, forte concurrence).
3. Une recommandation actionnable.

Format : un court paragraphe suivi de 3 points clés en bullet points.`,
        },
      ],
    });
    res.json({ text: resp.choices[0].message.content });
  } catch (err: any) {
    console.error("Dashboard interpretation error:", err);
    const status = err?.status || 500;
    const isQuota = status === 429 || /insufficient balance|recharge/i.test(err?.message || "");
    res.status(status).json({
      error: isQuota
        ? "Crédit IA épuisé sur le compte Z.AI. Rechargez le compte pour réactiver les analyses."
        : "AI interpretation unavailable",
    });
  }
});

// ── AI: Conversational seasonal assistant (SSE streaming) ────────────────────
// Replaces the old one-shot /api/ai/seasonal-suggestions. Streams Z.AI chunks
// via Server-Sent Events so the UI can render tokens progressively. When the
// caller opts in with useProjectContext + projectId, we enrich the system
// prompt with the project's domain, branded keywords, top opportunities and
// average SERP position so suggestions are grounded in real data.
app.post("/api/ai/assistant", authenticate, async (req: any, res) => {
  const {
    messages = [],
    useProjectContext = false,
    projectId = null,
  } = req.body || {};

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "messages array required" });
  }
  // Hard cap matches the 10-turn UI limit (user+assistant pairs = 20 msgs max)
  if (messages.length > 20) {
    return res.status(400).json({ error: "Conversation trop longue (max 10 tours)." });
  }

  let systemPrompt =
    "Tu es un assistant SEO stratégique spécialisé en planification saisonnière. " +
    "Tu réponds en français, de manière claire, structurée et actionnable. " +
    "Pour chaque opportunité saisonnière que tu identifies, précise : la période concernée, " +
    "le pic de recherche estimé, et une recommandation SEO concrète (contenu à publier, " +
    "balises à optimiser, landing à créer, etc.). " +
    "Adapte-toi aux spécificités culturelles, commerciales et linguistiques de la zone géographique. " +
    "Utilise le format markdown (titres, listes) pour structurer tes réponses.";

  if (useProjectContext && projectId) {
    try {
      const ctxRes = await pool.query(
        `SELECT p.name, p.domain, p.country, p.language, p.branded_keywords
         FROM projects p
         WHERE p.id = $1 AND p.userid = $2`,
        [projectId, req.user.id]
      );
      const project = ctxRes.rows[0];
      if (project) {
        const kwRes = await pool.query(
          `SELECT k.keyword,
                  COALESCE(lg.position, 0) AS position,
                  COALESCE(sc.opportunity_score, 0) AS opportunity_score
           FROM keywords k
           LEFT JOIN LATERAL (
             SELECT g.position
             FROM gsc_daily g
             WHERE g.projectid = k.projectid AND g.keyword = k.keyword
             ORDER BY g.date DESC LIMIT 1
           ) lg ON true
           LEFT JOIN LATERAL (
             SELECT s.opportunity_score
             FROM scores_daily s
             WHERE s.projectid = k.projectid AND s.keyword = k.keyword
             ORDER BY s.date DESC LIMIT 1
           ) sc ON true
           WHERE k.projectid = $1
           ORDER BY COALESCE(sc.opportunity_score, 0) DESC NULLS LAST
           LIMIT 10`,
          [projectId]
        );
        const topKws = kwRes.rows
          .filter((r: any) => r.keyword)
          .map((r: any) => `"${r.keyword}" (pos ${Number(r.position || 0).toFixed(0)})`)
          .join(", ");
        const withPos = kwRes.rows.filter((r: any) => Number(r.position || 0) > 0);
        const avgPos = withPos.length
          ? withPos.reduce((s: number, r: any) => s + Number(r.position), 0) / withPos.length
          : 0;

        systemPrompt += `\n\n[Contexte du projet "${project.name}"]
Domaine : ${project.domain || "non renseigné"}
Pays : ${project.country || "non renseigné"} · Langue : ${project.language || "fr"}
Mots-clés de marque : ${project.branded_keywords || "aucun"}
Top opportunités : ${topKws || "aucun mot-clé connu"}
Position moyenne actuelle : ${avgPos > 0 ? avgPos.toFixed(1) : "non disponible"}

Appuie-toi sur ce contexte pour personnaliser tes recommandations.`;
      }
    } catch (ctxErr) {
      // Don't fail the whole request if context lookup breaks — fall back to
      // a generic prompt and log for diagnosis.
      console.error("Project context fetch error:", ctxErr);
    }
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  try {
    const stream = await zhipu.chat.completions.create({
      model: "glm-4.5",
      stream: true,
      messages: [
        { role: "system" as const, content: systemPrompt },
        ...messages.map((m: any) => ({
          role: (m.role === "assistant" ? "assistant" : "user") as "assistant" | "user",
          content: String(m.content ?? ""),
        })),
      ],
    });

    for await (const chunk of stream as any) {
      const delta = chunk?.choices?.[0]?.delta?.content || "";
      if (delta) {
        res.write(`data: ${JSON.stringify({ delta })}\n\n`);
      }
    }
    res.write("data: [DONE]\n\n");
    res.end();
  } catch (err: any) {
    console.error("Assistant stream error:", err);
    const isQuota = err?.status === 429 || /insufficient balance|recharge/i.test(err?.message || "");
    const msg = isQuota
      ? "Crédit IA épuisé sur le compte Z.AI. Rechargez le compte pour réactiver l'assistant."
      : "Assistant IA indisponible.";
    if (res.headersSent) {
      res.write(`data: ${JSON.stringify({ error: msg })}\n\n`);
      res.end();
    } else {
      res.status(err?.status || 500).json({ error: msg });
    }
  }
});

// ── Admin: backfill NLP enrichment for every keyword ─────────────────────────
// Walks the master keywords list (all projects owned by the caller) and runs
// qualifyKeywordsCore for each project. The core is cache-aware, so re-running
// is free. Useful after adding the auto-qualify pipeline to backfill keywords
// that never appeared in a recent GSC ingest.
app.post("/api/admin/backfill-nlp", authenticate, async (req: any, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT k.projectid, k.keyword,
              COALESCE(k.position, 0)    AS position,
              COALESCE(k.ctr, 0)         AS ctr,
              COALESCE(k.impressions, 0) AS impressions
       FROM keywords k
       JOIN projects p ON p.id = k.projectid
       WHERE p.userid = $1`,
      [req.user.id]
    );

    const byProject = new Map<number, any[]>();
    for (const r of rows) {
      const list = byProject.get(r.projectid) || [];
      list.push(r);
      byProject.set(r.projectid, list);
    }

    const today = normalizeDate(new Date().toISOString());
    const summary: Record<string, any> = {};

    for (const [projectId, keywords] of byProject) {
      const out = await qualifyKeywordsCore(projectId, keywords, today);
      summary[String(projectId)] = {
        total: keywords.length,
        cached: out.cachedCount,
        new: out.newCount,
        llm: out.llmCount,
      };
    }

    res.json({ success: true, projects: summary });
  } catch (err: any) {
    console.error("Backfill NLP error:", err);
    res.status(500).json({ error: err?.message || "Backfill failed" });
  }
});

// ── Keyword Track / Untrack ───────────────────────────────────────────────
// IMPORTANT: literal routes (/api/keywords/tracked) must be registered BEFORE
// parameterized ones (/api/keywords/:keywordId/...) to avoid future shadowing.

// Requête commune utilisée par GET /api/keywords/tracked et PATCH
// optimization-start-date. Si keywordId est fourni, ne renvoie que ce mot-clé.
// position_evolution / impressions_evolution / has_sufficient_history sont
// calculés à la volée depuis gsc_daily : ils représentent l'écart entre la
// première ligne GSC ≥ optimization_start_date (baseline) et la dernière ligne
// GSC disponible (état actuel). Aucune dépendance à scores_daily pour ce calcul.
async function queryTrackedKeywords(
  userId: number,
  projectId: number | null,
  keywordId: number | null
) {
  return pool.query(
    `
    WITH latest_gsc AS (
      SELECT DISTINCT ON (g.projectid, g.keyword)
        g.projectid, g.keyword, g.date,
        g.impressions, g.clicks, g.position, g.ctr
      FROM gsc_daily g
      ORDER BY g.projectid, g.keyword, g.date DESC
    ),
    prev_gsc AS (
      SELECT DISTINCT ON (g.projectid, g.keyword)
        g.projectid, g.keyword,
        g.position AS prev_position,
        g.ctr     AS prev_ctr
      FROM gsc_daily g
      WHERE LEFT(g.date::text, 10)::date <= CURRENT_DATE - INTERVAL '7 days'
      ORDER BY g.projectid, g.keyword, g.date DESC
    ),
    -- Baseline depuis la date manuelle d'optimisation : première ligne GSC
    -- ≥ optimization_start_date. Spec : si pas de donnée exactement à la date,
    -- prendre la première disponible après. NULL si la date n'est pas définie.
    optimization_baseline AS (
      SELECT DISTINCT ON (g.projectid, g.keyword)
        g.projectid, g.keyword,
        -- Cast en texte pour éviter le décalage TZ que le driver pg applique
        -- lors de la sérialisation JSON des colonnes DATE.
        to_char(g.date::date, 'YYYY-MM-DD') AS baseline_date,
        g.position     AS baseline_position,
        g.ctr          AS baseline_ctr,
        g.impressions  AS baseline_impressions,
        g.clicks       AS baseline_clicks
      FROM gsc_daily g
      JOIN keywords k2
        ON k2.projectid = g.projectid AND k2.keyword = g.keyword
      WHERE k2.optimization_start_date IS NOT NULL
        AND g.date::date >= k2.optimization_start_date
      ORDER BY g.projectid, g.keyword, g.date ASC
    ),
    latest_scores AS (
      SELECT DISTINCT ON (sc.projectid, sc.keyword)
        sc.projectid, sc.keyword,
        sc.opportunity_score, sc.ctr_gap, sc.performance_drift
      FROM scores_daily sc
      ORDER BY sc.projectid, sc.keyword, sc.date DESC
    ),
    latest_nlp AS (
      SELECT DISTINCT ON (n.projectid, n.keyword)
        n.projectid, n.keyword,
        n.search_intent, n.branded_status, n.action_hint, n.priority_level
      FROM nlp_keyword_enrichment n
      ORDER BY n.projectid, n.keyword, n.date DESC
    )
    SELECT
      k.id,
      k.projectid AS "projectId",
      k.keyword,
      COALESCE(lg.position,     k.position, 0)      AS position,
      -- Quand optimization_start_date est défini, le baseline remplace le
      -- prev (semaine glissante) pour position/ctr. Sinon comportement actuel.
      COALESCE(ob.baseline_position, pg.prev_position, k.prev_position, 0) AS prev_position,
      COALESCE(lg.ctr,          k.ctr, 0)           AS ctr,
      COALESCE(ob.baseline_ctr, pg.prev_ctr, k.prev_ctr, 0) AS prev_ctr,
      COALESCE(lg.impressions,  k.impressions, 0)   AS impressions,
      COALESCE(lg.clicks, 0)                        AS clicks,
      -- Baselines exposés uniquement quand la date manuelle est définie
      ob.baseline_date,
      ob.baseline_position,
      ob.baseline_ctr,
      ob.baseline_impressions,
      ob.baseline_clicks,
      -- Cast en texte pour éviter le décalage TZ côté JSON (voir baseline_date).
      to_char(k.optimization_start_date, 'YYYY-MM-DD') AS optimization_start_date,
      -- Évolutions calculées depuis l'historique GSC (sans n8n).
      -- position_evolution > 0 = position dégradée (rang plus loin),
      -- position_evolution < 0 = amélioration. NULL si pas de baseline.
      CASE
        WHEN ob.baseline_position IS NOT NULL AND lg.position IS NOT NULL
        THEN ROUND((lg.position::numeric - ob.baseline_position::numeric)::numeric, 2)
        ELSE NULL
      END AS position_evolution,
      CASE
        WHEN ob.baseline_impressions IS NOT NULL AND lg.impressions IS NOT NULL
        THEN (lg.impressions - ob.baseline_impressions)
        ELSE NULL
      END AS impressions_evolution,
      -- TRUE quand on dispose à la fois d'une baseline ≥ opt_date ET d'une
      -- ligne courante : la comparaison avant/après est possible.
      (k.optimization_start_date IS NOT NULL
        AND ob.baseline_position IS NOT NULL
        AND lg.position IS NOT NULL)         AS has_sufficient_history,
      COALESCE(sc.opportunity_score, 0)             AS opportunity_score,
      COALESCE(sc.ctr_gap, 0)                       AS ctr_gap,
      COALESCE(sc.performance_drift, 0)             AS performance_drift,
      COALESCE(ln.search_intent, 'informationnelle') AS search_intent,
      COALESCE(ln.branded_status, 'non-branded')    AS branded_status,
      ln.action_hint,
      ln.priority_level,
      k.is_tracked
    FROM keywords k
    JOIN projects p ON p.id = k.projectid
    LEFT JOIN latest_gsc           lg ON lg.projectid = k.projectid AND lg.keyword = k.keyword
    LEFT JOIN prev_gsc             pg ON pg.projectid = k.projectid AND pg.keyword = k.keyword
    LEFT JOIN optimization_baseline ob ON ob.projectid = k.projectid AND ob.keyword = k.keyword
    LEFT JOIN latest_scores        sc ON sc.projectid = k.projectid AND sc.keyword = k.keyword
    LEFT JOIN latest_nlp           ln ON ln.projectid = k.projectid AND ln.keyword = k.keyword
    WHERE k.is_tracked = TRUE
      AND p.userid = $1
      AND ($2::int IS NULL OR k.projectid = $2)
      AND ($3::int IS NULL OR k.id = $3)
    ORDER BY COALESCE(sc.opportunity_score, 0) DESC
    `,
    [userId, projectId, keywordId]
  );
}

app.get("/api/keywords/tracked", authenticate, async (req: any, res) => {
  try {
    const { projectId } = req.query;
    const result = await queryTrackedKeywords(
      req.user.id,
      projectId ? Number(projectId) : null,
      null
    );
    res.json(result.rows);
  } catch (err) {
    console.error("Fetch tracked keywords error:", err);
    res.status(500).json({ error: "Failed to fetch tracked keywords" });
  }
});

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

// Date manuelle de début d'optimisation pour un mot-clé suivi.
// Body: { date: "YYYY-MM-DD" } pour définir, { date: null } pour effacer.
// L'évolution (position/CTR/impressions/clics) sera ensuite calculée depuis
// la première ligne gsc_daily ≥ cette date (cf. GET /api/keywords/tracked).
app.patch("/api/keywords/:keywordId/optimization-start-date", authenticate, async (req: any, res) => {
  const { keywordId } = req.params;
  const { date } = req.body || {};

  if (date !== null && date !== undefined) {
    if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: "date doit être au format YYYY-MM-DD ou null" });
    }
    // Pas de restriction de date future : l'analyste peut saisir la date du
    // jour ou une date à venir. Si aucune ligne gsc_daily ≥ cette date n'existe
    // encore, has_sufficient_history sera false et l'UI affichera un message
    // "comparaison sous 1-2 jours" jusqu'à l'arrivée des données.
  }

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
      "UPDATE keywords SET optimization_start_date = $1 WHERE id = $2",
      [date || null, keywordId]
    );

    // Recompute the row from gsc_daily history and return it directly. Le
    // frontend remplace la ligne dans son state sans avoir à refetch toute
    // la liste — l'évolution avant/après est visible immédiatement.
    const recomputed = await queryTrackedKeywords(
      req.user.id,
      null,
      Number(keywordId)
    );
    const row = recomputed.rows[0] ?? null;

    res.json({
      success: true,
      optimization_start_date: date || null,
      row,
    });
  } catch (err) {
    console.error("Set optimization_start_date error:", err);
    res.status(500).json({ error: "Failed to set optimization start date" });
  }
});

// Refresh ciblé GSC pour UN mot-clé suivi (sans relancer la collecte globale).
// Déclenche le workflow n8n "refresh-gsc-keyword" qui interroge GSC pour ce
// mot-clé uniquement, puis ingère les rows dans gsc_daily via /api/ingest/gsc.
// Une fois le webhook terminé, on relit les valeurs fraîches via
// queryTrackedKeywords pour renvoyer le row recomputé au frontend.
app.post("/api/keywords/:keywordId/refresh-gsc", authenticate, async (req: any, res) => {
  const { keywordId } = req.params;
  const days = Number(req.body?.days) > 0 ? Number(req.body.days) : 14;

  try {
    // 1. Ownership + lecture des paramètres à transmettre à n8n
    const lookup = await pool.query(
      `SELECT k.id, k.projectid AS "projectId", k.keyword, p.domain
         FROM keywords k
         JOIN projects p ON p.id = k.projectid
        WHERE k.id = $1 AND p.userid = $2`,
      [keywordId, req.user.id]
    );
    if (lookup.rows.length === 0) {
      return res.status(404).json({ error: "Keyword not found" });
    }
    const { projectId, keyword, domain } = lookup.rows[0];

    // 2. Appel synchrone du webhook n8n (Respond to Webhook côté workflow).
    //    On privilégie la variable dédiée N8N_REFRESH_GSC_WEBHOOK_URL (même
    //    pattern que N8N_RESET_WEBHOOK_URL) pour pouvoir cibler une URL
    //    précise. Fallback : construction depuis N8N_BASE_URL.
    const webhookUrl =
      process.env.N8N_REFRESH_GSC_WEBHOOK_URL ||
      `${process.env.N8N_BASE_URL || "https://n8n.srv770401.hstgr.cloud"}/webhook/refresh-gsc-keyword`;

    let n8nResp: Response;
    try {
      n8nResp = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, domain, keyword, days }),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (err: any) {
      console.error("n8n refresh-gsc-keyword network error:", err);
      return res.status(502).json({
        error:
          "Impossible de contacter n8n. Vérifie que le workflow refresh-gsc-keyword est ACTIF et que N8N_BASE_URL est correct.",
      });
    }

    const responseText = await n8nResp.text();
    if (!n8nResp.ok) {
      console.error(`n8n refresh-gsc-keyword HTTP ${n8nResp.status}:`, responseText);
      const userMessage =
        n8nResp.status === 404
          ? "Workflow refresh-gsc-keyword introuvable. Vérifie qu'il est ACTIF (toggle vert) et que le path du Webhook est exactement \"refresh-gsc-keyword\"."
          : `n8n a retourné une erreur (HTTP ${n8nResp.status}).`;
      return res.status(502).json({
        error: userMessage,
        details: responseText.slice(0, 500),
      });
    }

    let n8nPayload: any = {};
    try { n8nPayload = JSON.parse(responseText); } catch { /* réponse non-JSON acceptée */ }

    // 3. n8n a terminé → gsc_daily est à jour pour ce mot-clé.
    //    On relit immédiatement via le helper partagé pour récupérer
    //    position_evolution / impressions_evolution / has_sufficient_history
    //    recalculés depuis la baseline d'optimisation.
    const recomputed = await queryTrackedKeywords(
      req.user.id,
      null,
      Number(keywordId)
    );
    const row = recomputed.rows[0] ?? null;

    res.json({ success: true, row, n8n: n8nPayload });
  } catch (err: any) {
    console.error("Refresh GSC keyword error:", err);
    res.status(500).json({ error: err?.message || "Refresh GSC failed" });
  }
});

// Suppression définitive d'un mot-clé (sans blacklist).
// Le mot-clé pourra réapparaître lors d'une future collecte n8n/GSC/SERP —
// c'est volontaire : la pertinence évolue dans le temps.
//
// Supprime en transaction :
//   1. gsc_daily, serp_daily, scores_daily, nlp_keyword_enrichment
//      (filtre projectid + keyword pour ne pas toucher les autres projets)
//   2. keyword_clusters : on supprime les clusters qui contiennent ce mot-clé.
//      C'est défendable car les clusters sont régénérés à la demande via
//      /api/projects/:id/cluster.
//   3. keywords : la ligne maître (avec is_tracked et optimization_start_date).
app.delete("/api/keywords/:keywordId", authenticate, async (req: any, res) => {
  const { keywordId } = req.params;
  const client = await pool.connect();
  try {
    // 1) Auth + ownership : on charge keyword + projectid en vérifiant que le
    //    projet appartient à l'utilisateur courant. Si rien ne match → 404.
    const check = await client.query(
      `SELECT k.id, k.projectid, k.keyword, k.is_tracked
       FROM keywords k
       JOIN projects p ON p.id = k.projectid
       WHERE k.id = $1 AND p.userid = $2`,
      [keywordId, req.user.id]
    );
    if (check.rows.length === 0) {
      return res.status(404).json({ error: "Keyword not found" });
    }
    const { projectid, keyword, is_tracked } = check.rows[0];

    // 2) Suppression transactionnelle. Tout ou rien.
    await client.query("BEGIN");

    const delGsc    = await client.query("DELETE FROM gsc_daily              WHERE projectid=$1 AND keyword=$2", [projectid, keyword]);
    const delSerp   = await client.query("DELETE FROM serp_daily             WHERE projectid=$1 AND keyword=$2", [projectid, keyword]);
    const delScores = await client.query("DELETE FROM scores_daily           WHERE projectid=$1 AND keyword=$2", [projectid, keyword]);
    const delNlp    = await client.query("DELETE FROM nlp_keyword_enrichment WHERE projectid=$1 AND keyword=$2", [projectid, keyword]);

    // keyword_clusters.keywords est un JSON array stringifié (cf. cluster route).
    // Match sur la forme entre quotes pour éviter les faux positifs sur les substrings.
    const delClusters = await client.query(
      `DELETE FROM keyword_clusters
       WHERE projectid=$1 AND keywords LIKE '%"' || $2 || '"%'`,
      [projectid, keyword]
    );

    const delKw = await client.query("DELETE FROM keywords WHERE id=$1", [keywordId]);

    await client.query("COMMIT");

    res.json({
      success: true,
      message: "Mot-clé supprimé. Il pourra réapparaître lors d'une prochaine collecte.",
      deleted: {
        keyword_id: Number(keywordId),
        keyword,
        was_tracked: !!is_tracked,
        rows: {
          keywords:               delKw.rowCount ?? 0,
          gsc_daily:              delGsc.rowCount ?? 0,
          serp_daily:             delSerp.rowCount ?? 0,
          scores_daily:           delScores.rowCount ?? 0,
          nlp_keyword_enrichment: delNlp.rowCount ?? 0,
          keyword_clusters:       delClusters.rowCount ?? 0,
        },
      },
    });
  } catch (err: any) {
    try { await client.query("ROLLBACK"); } catch (_) {}
    console.error("Delete keyword error:", err);
    res.status(500).json({ error: "Failed to delete keyword", details: err?.message });
  } finally {
    client.release();
  }
});

// ── Opportunities Reset (triggers n8n workflow) ────────────────────────────
// Was called by resetFilters() in Opportunities.tsx but didn't exist.
// Delegates to the generic n8n trigger route internally.

app.post("/api/opportunities/reset", authenticate, async (req: any, res) => {
  const N8N_BASE_URL = process.env.N8N_BASE_URL || "https://n8n.srv770401.hstgr.cloud";
  const webhookUrl = `${N8N_BASE_URL}/webhook/reset-collecte`;

  // projectId obligatoire : on doit lire le domaine pour construire siteUrl côté n8n.
  const rawProjectId = req.body?.projectId;
  const projectId = Number(rawProjectId);
  if (!rawProjectId || !Number.isFinite(projectId) || !Number.isInteger(projectId) || projectId <= 0) {
    return res.status(400).json({ error: "projectId est requis (sélectionnez un projet)." });
  }
  console.log(`[reset] projectId reçu: ${projectId}`);

  // Date-range filter from the Opportunities page. Forwarded to n8n so the
  // GSC node can pick the right window. Spec:
  //   dateRange:  "last7Days" | "last28Days" | "last3Months" | "last12Months" | "custom"
  //   startDate:  YYYY-MM-DD   (only when dateRange === "custom")
  //   endDate:    YYYY-MM-DD   (only when dateRange === "custom")
  const VALID_RANGES = ["last7Days","last28Days","last3Months","last12Months","custom"] as const;
  const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  const dateRange = String(req.body?.dateRange || "last3Months");
  if (!VALID_RANGES.includes(dateRange as any)) {
    return res.status(400).json({ error: `dateRange invalide (attendu: ${VALID_RANGES.join(", ")})` });
  }

  // Plafond du nombre de lignes pulled par le GSC node de n8n.
  // 25000 = max hard de l'API GSC (cf. https://developers.google.com/webmaster-tools).
  // Default 1000 = équilibre entre couverture et coût SerpAPI.
  const ROW_LIMIT_DEFAULT = 1000;
  const ROW_LIMIT_MAX = 25000;
  const rawRowLimit = req.body?.rowLimit;
  let rowLimit = ROW_LIMIT_DEFAULT;
  if (rawRowLimit !== undefined && rawRowLimit !== null) {
    const n = Number(rawRowLimit);
    if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1 || n > ROW_LIMIT_MAX) {
      return res.status(400).json({
        error: `rowLimit invalide (attendu: entier entre 1 et ${ROW_LIMIT_MAX})`,
      });
    }
    rowLimit = n;
  }
  let startDate: string | null = null;
  let endDate:   string | null = null;
  if (dateRange === "custom") {
    startDate = String(req.body?.startDate || "").trim();
    endDate   = String(req.body?.endDate   || "").trim();
    if (!startDate || !ISO_DATE_RE.test(startDate)) {
      return res.status(400).json({ error: "startDate requis au format YYYY-MM-DD pour dateRange=custom" });
    }
    if (!endDate || !ISO_DATE_RE.test(endDate)) {
      return res.status(400).json({ error: "endDate requis au format YYYY-MM-DD pour dateRange=custom" });
    }
    if (startDate > endDate) {
      return res.status(400).json({ error: "startDate doit être ≤ endDate" });
    }
    const today = new Date().toISOString().slice(0, 10);
    if (endDate > today) {
      return res.status(400).json({ error: "endDate ne peut pas être dans le futur" });
    }
  }

  try {
    // Vérifie l'appartenance + lit le domaine du projet sélectionné.
    const projRes = await pool.query(
      "SELECT id, name, domain FROM projects WHERE id = $1 AND userid = $2",
      [projectId, req.user.id]
    );
    if (projRes.rowCount === 0) {
      return res.status(404).json({ error: "Projet introuvable ou non autorisé." });
    }
    const project = projRes.rows[0];
    console.log(`[reset] projet trouvé: name=${project.name} domain=${project.domain}`);

    const cleanedDomain = cleanProjectDomain(project.domain);
    if (!cleanedDomain) {
      return res.status(400).json({
        error: "Ce projet n'a pas de domaine renseigné. Complétez-le dans la page Projets.",
      });
    }
    const siteUrl = `https://www.${cleanedDomain}/`;
    console.log(`[reset] siteUrl généré: ${siteUrl}`);

    // n8n's GSC node expects the human label ("Last 7 Days", "Last 3 Months", …),
    // not our symbolic value. We forward both so the workflow can pick whichever.
    const N8N_DATE_RANGE_LABEL: Record<string, string> = {
      last7Days:    "Last 7 Days",
      last28Days:   "Last 28 Days",
      last3Months:  "Last 3 Months",
      last12Months: "Last 12 Months",
      custom:       "Custom",
    };
    const dateRangeLabel = N8N_DATE_RANGE_LABEL[dateRange] || dateRange;

    const n8nResponse = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        triggeredBy: req.user?.email || "unknown",
        projectId,
        projectName: project.name,
        siteUrl,
        dateRange,
        dateRangeLabel,
        startDate: dateRange === "custom" ? startDate : null,
        endDate:   dateRange === "custom" ? endDate   : null,
        rowLimit,
        timestamp: new Date().toISOString(),
      }),
    });

    const responseText = await n8nResponse.text();
    console.log(`[reset] réponse n8n: status=${n8nResponse.status}, body=${responseText.slice(0, 300)}`);

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
                         COUNT(CASE WHEN your_position IS NOT NULL THEN 1 END) AS with_your_position,
                         COUNT(CASE WHEN has_ai_overview = TRUE THEN 1 END) AS with_aio
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
                COUNT(CASE WHEN s.your_position IS NOT NULL THEN 1 END) AS with_your_position,
                COUNT(CASE WHEN s.has_ai_overview = TRUE THEN 1 END) AS with_aio
         FROM gsc_daily g
         LEFT JOIN serp_daily s ON g.projectid=s.projectid AND g.keyword=s.keyword
           AND LEFT(g.date::text,10)=LEFT(s.date::text,10)
         WHERE g.projectid=$1 AND LEFT(g.date::text,10)=$2`,
        [projectId, targetDate]
      );
      joinCheck = jRes.rows[0];
      const sRes = await pool.query(
        `SELECT g.keyword, g.position, g.ctr, g.impressions,
                s.your_position, s.has_ai_overview, s.has_paa, s.has_knowledge_graph, s.paa_count,
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
    if (Number(serpCount.rows[0]?.with_your_position) === 0 && Number(serpCount.rows[0]?.n) > 0)
      issues.push("⚠ serp_daily: notre domaine n'apparaît dans aucune SERP — vérifier projects.domain");
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
                        withYourPosition: Number(serpCount.rows[0]?.with_your_position),
                        withAio: Number(serpCount.rows[0]?.with_aio) },
        scores_daily: { total: Number(scoresCount.rows[0]?.n),
                        nonZeroOpportunity: Number(scoresCount.rows[0]?.non_zero_opp),
                        avgOpportunityScore: Number(scoresCount.rows[0]?.avg_opp),
                        avgCompetitionScore: Number(scoresCount.rows[0]?.avg_comp) },
        nlp_enrichment: { intentDistribution: nlpCount.rows },
      },
      joinCheck: joinCheck ? {
        gscKeywords: Number(joinCheck.gsc_keywords), serpMatched: Number(joinCheck.serp_matched),
        matchRate: Number(joinCheck.gsc_keywords) > 0 ? `${Math.round((joinCheck.serp_matched/joinCheck.gsc_keywords)*100)}%` : "0%",
        withYourPosition: Number(joinCheck.with_your_position), withAio: Number(joinCheck.with_aio),
      } : null,
      sample, issues,
    });
  } catch (err) {
    console.error("[DEBUG] data-check error:", err);
    res.status(500).json({ error: "Debug check failed", details: String(err) });
  }
});

async function startServer() {
  const PORT = Number(process.env.PORT) || 3000;

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
