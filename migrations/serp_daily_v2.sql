-- ============================================================================
-- serp_daily v2 — refacto schéma SerpAPI brut + JSONB + tracking de notre position
-- ============================================================================
-- Contexte : on stockait avant volume/cpc/competition + colonnes TEXT concaténées
-- (paa_questions_newline, serp_top3_links, …). On passe à un schéma propre :
--   - listes en JSONB (organic_results, paa_questions, related_searches, ai_overview, knowledge_graph)
--   - SERP features détectées (booléens has_*)
--   - your_position / your_url / your_title / your_snippet → notre position dans la SERP
--   - raw_response : payload SerpAPI brut conservé en backup
-- ============================================================================
-- En dev : pas d'historique à conserver, on drop puis on recrée.
-- À exécuter manuellement sur Neon.
-- ============================================================================

DROP TABLE IF EXISTS serp_daily CASCADE;

CREATE TABLE serp_daily (
  id                  SERIAL PRIMARY KEY,
  projectid           INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  keyword             TEXT    NOT NULL,
  date                DATE    NOT NULL,

  -- Search context (depuis SerpAPI search_parameters)
  device              TEXT    NOT NULL DEFAULT 'desktop',
  gl                  TEXT,
  hl                  TEXT,
  engine              TEXT    NOT NULL DEFAULT 'google',

  -- Notre position dans la SERP
  your_position       INTEGER,          -- NULL si on n'apparaît pas dans le top
  your_url            TEXT,
  your_title          TEXT,
  your_snippet        TEXT,
  your_in_aio         BOOLEAN NOT NULL DEFAULT FALSE,  -- domaine cité dans l'AI Overview

  -- SERP features
  has_ai_overview     BOOLEAN NOT NULL DEFAULT FALSE,
  has_paa             BOOLEAN NOT NULL DEFAULT FALSE,
  has_knowledge_graph BOOLEAN NOT NULL DEFAULT FALSE,
  has_inline_videos   BOOLEAN NOT NULL DEFAULT FALSE,
  has_inline_images   BOOLEAN NOT NULL DEFAULT FALSE,
  has_sitelinks       BOOLEAN NOT NULL DEFAULT FALSE,
  has_rich_snippets   BOOLEAN NOT NULL DEFAULT FALSE,

  -- Compteurs rapides
  total_results       BIGINT,
  organic_count       INTEGER NOT NULL DEFAULT 0,
  paa_count           INTEGER NOT NULL DEFAULT 0,

  -- Données structurées (JSONB pour les listes)
  organic_results     JSONB   NOT NULL DEFAULT '[]'::jsonb,
  paa_questions       JSONB   NOT NULL DEFAULT '[]'::jsonb,
  related_searches    JSONB   NOT NULL DEFAULT '[]'::jsonb,
  ai_overview         JSONB,
  knowledge_graph     JSONB,

  -- Backup payload SerpAPI brut
  raw_response        JSONB,

  -- Erreur SerpAPI éventuelle (item-level)
  error               TEXT,

  -- Timestamps
  scraped_at          TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT serp_daily_unique UNIQUE (projectid, keyword, date, device)
);

-- Index principaux pour les requêtes dashboard / opportunities
CREATE INDEX serp_daily_project_date_idx
  ON serp_daily (projectid, date DESC);

CREATE INDEX serp_daily_keyword_idx
  ON serp_daily (keyword);

-- Index partiels pour les filtres fréquents
CREATE INDEX serp_daily_your_position_idx
  ON serp_daily (your_position)
  WHERE your_position IS NOT NULL;

CREATE INDEX serp_daily_has_ai_overview_idx
  ON serp_daily (has_ai_overview)
  WHERE has_ai_overview = TRUE;

-- Index GIN pour les recherches dans le JSONB
CREATE INDEX serp_daily_organic_results_gin
  ON serp_daily USING GIN (organic_results);

CREATE INDEX serp_daily_ai_overview_gin
  ON serp_daily USING GIN (ai_overview);

-- Trigger updated_at
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
  FOR EACH ROW
  EXECUTE FUNCTION serp_daily_set_updated_at();
