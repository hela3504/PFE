# SEO Business Intelligence — Application Web

Plateforme SaaS d'analyse SEO : suivi des mots-clés, calcul automatique des
KPIs (opportunités, quick wins, dérive), classification NLP des intentions,
assistance IA. Front React + back Node/Express sur un seul process, base
PostgreSQL, collecte de données via n8n.

## Stack technique

| Couche | Technologie |
|---|---|
| Frontend | React 19, Vite 6, Tailwind v4, React Router 7, Recharts, Motion |
| Backend | Node.js ≥ 20, Express 4, TypeScript (exécuté par `tsx`) |
| Base de données | PostgreSQL ≥ 14 (extension `unaccent` requise) |
| Authentification | JWT (utilisateurs) + API key partagée (workflows n8n) |
| IA / NLP | Z.AI (SDK OpenAI-compatible) — modèle `glm-5.1` |
| Collecte de données | Workflows n8n externes (Google Search Console + scrape SERP) |
| Emails | SMTP nodemailer (reset password) |
| Documentation API | OpenAPI 3.0 via swagger-jsdoc + swagger-ui-express |

## Architecture en bref

```
┌──────────────────────────────┐
│  Navigateur — React SPA      │
│  (auth JWT en localStorage)  │
└──────────────┬───────────────┘
               │ HTTPS
┌──────────────▼───────────────┐
│  Node.js — server.ts         │
│  • Express + Vite middleware │
│  • Routes API REST           │
│  • Middlewares JWT / API key │
│  • Pipeline NLP (règles+LLM) │
│  • Calcul des KPIs SEO       │
└──────┬─────────────┬─────────┘
       │             │
   ┌───▼────┐   ┌────▼─────┐    ┌──────────────┐
   │Postgres│   │  Z.AI    │    │ n8n cron     │
   │        │   │  (LLM)   │    │ (collecte)   │
   └────────┘   └──────────┘    └──────┬───────┘
                                       │ x-api-key
                                       ▼
                              POST /api/ingest/*
                              POST /api/compute/kpis
```

Un seul processus Node sert :
- L'API REST sur les routes `/api/*`
- En **dev** : Vite middleware pour le HMR React
- En **prod** : les fichiers statiques compilés (`dist/`)

## Démarrage rapide

### 1. Pré-requis

- **Node.js** ≥ 20 (idéalement 22)
- **PostgreSQL** ≥ 14 (avec extension `unaccent` activable)
- Compte **Z.AI** pour la clé LLM (ou désactiver les fonctionnalités IA)

### 2. Installation

```bash
npm install
```

### 3. Configuration

```bash
cp .env.example .env
```

Puis remplir les valeurs dans `.env`. Variables critiques :
- `DATABASE_URL` — chaîne de connexion PostgreSQL
- `JWT_SECRET` — secret aléatoire de signature des tokens
- `ZHIPU_API_KEY` — clé API Z.AI
- `API_KEY_N8N` — secret partagé avec les workflows n8n

Voir `.env.example` pour la liste complète et les commentaires.

### 4. Lancement (développement)

```bash
npm run dev
```

L'application est accessible sur **http://localhost:3000**.

Le schéma PostgreSQL est créé/migré automatiquement au démarrage par la
fonction `initDb()` dans `server.ts` (idempotente — relancer le serveur
n'a aucun effet de bord).

### 5. Build de production

```bash
npm run build          # génère dist/
npm start              # lance le serveur en mode prod
```

## Documentation de l'API

Une fois le serveur lancé, l'API REST est documentée et testable en direct
sur **http://localhost:3000/api-docs** (Swagger UI 3.0).

Le spec JSON brut est disponible sur `/api-docs.json` — utile pour
l'import dans Postman, Insomnia, ou pour générer des SDK clients.

## Structure du projet

```
.
├── server.ts                 Backend Express (point d'entrée unique)
├── swagger-docs.ts           Annotations OpenAPI 3.0
├── migrations/               Migrations SQL idempotentes
├── src/
│   ├── App.tsx               Routing + état d'authentification
│   ├── components/           Layout, composants partagés
│   ├── pages/                Une page par route
│   ├── hooks/                Hooks React custom
│   └── services/             Proxy frontend → routes IA backend
├── public/                   Assets statiques (logo, uploads runtime)
├── scripts/                  Pipeline Python parallèle (hors-runtime)
│   ├── main.py               Outil offline équivalent (SQLAlchemy)
│   └── requirements.txt      Dépendances Python
├── test/                     Tests HTTP manuels
├── .env.example              Modèle de configuration
├── package.json
├── tsconfig.json
└── vite.config.ts
```

## Bootstrap administrateur

Aucun compte n'est créé automatiquement. Pour disposer du premier admin :

1. Créer un compte via l'interface d'inscription (mode signup)
2. Dans `.env`, mettre `BOOTSTRAP_ADMIN_EMAIL=votre@email.com`
3. Redémarrer le serveur — `initDb()` promeut le compte en admin

Le bootstrap ne crée jamais le compte ; il ne fait que basculer
`is_admin = TRUE` sur un compte existant.

## Authentification — deux schémas

| Schéma | Utilisateurs | Header |
|---|---|---|
| **JWT** (24h) | Humains via le SPA | `Authorization: Bearer <token>` |
| **API key** | Workflows n8n | `x-api-key: <API_KEY_N8N>` |

## Calcul des KPIs SEO

Sept KPIs sont calculés et persistés dans la table `scores_daily` à chaque
appel de `POST /api/compute/kpis` (généralement déclenché par n8n après
ingestion GSC) :

- `opportunity_score` = `impressions × max(0, 0,11 − CTR_actuel)`
- `quick_win_score`, `priority_score`, `competition_score`
- `ctr_gap`, `performance_drift`, `long_tail_indicator`

Les formules détaillées sont dans les fonctions `computeXxxScore` de
`server.ts` (lignes 1600-1700).

## Pipeline Python parallèle (scripts/)

Le dossier `scripts/` contient un pipeline Python (`main.py`) qui partage
**le même schéma PostgreSQL** que l'application Node, mais fonctionne en
mode batch offline (SQLAlchemy ORM). Il sert à :

- Re-traiter en masse des données historiques
- Tester des variantes de classification NLP hors serveur
- Faire des imports batch ad-hoc

**Ce n'est pas le backend de production** — le backend live est exclusivement
`server.ts`. Le pipeline Python est un outil d'analyse complémentaire.

## Licence

Projet propriétaire — usage interne.
