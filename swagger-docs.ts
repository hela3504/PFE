/**
 * OpenAPI 3.0 documentation for SEO BI API.
 *
 * Ce fichier est lu par `swagger-jsdoc` (référencé dans `apis` du config
 * Swagger dans server.ts). Chaque bloc `@swagger` ci-dessous documente
 * une route exposée par le backend.
 *
 * Convention :
 *   - Routes utilisateur protégées      → security: bearerAuth (JWT)
 *   - Routes ingest / compute (n8n)     → security: apiKeyAuth (x-api-key)
 *   - Routes publiques (auth, health)   → pas de security
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     Error:
 *       type: object
 *       properties:
 *         error:
 *           type: string
 *           example: "Message d'erreur lisible"
 *     User:
 *       type: object
 *       properties:
 *         id: { type: integer, example: 13 }
 *         email: { type: string, example: "user@example.com" }
 *         avatar_url: { type: string, nullable: true }
 *         is_admin: { type: boolean, example: false }
 *     Project:
 *       type: object
 *       properties:
 *         id: { type: integer }
 *         name: { type: string }
 *         domain: { type: string }
 *         country: { type: string }
 *         language: { type: string }
 *         branded_keywords: { type: array, items: { type: string } }
 *         created_at: { type: string, format: date-time }
 *     TrackedKeyword:
 *       type: object
 *       properties:
 *         id: { type: integer }
 *         keyword: { type: string }
 *         position: { type: number, nullable: true }
 *         prev_position: { type: number, nullable: true }
 *         impressions: { type: integer }
 *         clicks: { type: integer }
 *         ctr: { type: number }
 *         opportunity_score: { type: number }
 *         performance_drift: { type: number }
 *         optimization_start_date: { type: string, format: date, nullable: true }
 *         has_sufficient_history: { type: boolean }
 *         is_tracked: { type: boolean }
 *
 * tags:
 *   - name: Auth
 *     description: Authentification — JWT 24h
 *   - name: Users
 *     description: Gestion des utilisateurs (admin uniquement)
 *   - name: Projects
 *     description: CRUD des projets SEO
 *   - name: Keywords
 *     description: Suivi des mots-clés
 *   - name: Dashboard
 *     description: KPIs agrégés
 *   - name: Opportunities
 *     description: Mots-clés à fort potentiel
 *   - name: Calendar
 *     description: Événements et planning de contenu
 *   - name: AI
 *     description: Routes IA (Z.AI) — clusters, plan d'action, assistant
 *   - name: NLP
 *     description: Classification de mots-clés (rule-based + LLM)
 *   - name: Ingest
 *     description: Ingestion de données depuis n8n (auth x-api-key)
 *   - name: KPI
 *     description: Calcul des scores SEO (auth x-api-key)
 *   - name: Settings
 *     description: Paramètres utilisateur (profil, branded keywords)
 *   - name: Health
 *     description: Statut du service
 */

// ──────────────────────────────────────────────────────────────────────────────
//  AUTH
// ──────────────────────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/auth/login:
 *   post:
 *     summary: Connecte un utilisateur existant
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email: { type: string, example: "user@example.com" }
 *               password: { type: string, example: "motdepasse" }
 *     responses:
 *       200:
 *         description: Authentifié — renvoie un token JWT 24h + l'objet user
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 token: { type: string }
 *                 user: { $ref: '#/components/schemas/User' }
 *       401: { description: Credentials invalides, content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 */

/**
 * @swagger
 * /api/auth/signup:
 *   post:
 *     summary: Crée un nouveau compte utilisateur (non-admin)
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email: { type: string }
 *               password: { type: string, minLength: 6 }
 *               avatar: { type: string, description: "Data URL d'image (optionnel, max 2 Mo)" }
 *     responses:
 *       201: { description: Compte créé — renvoie token + user }
 *       400: { description: Email ou mot de passe invalide }
 *       409: { description: Un compte avec cet email existe déjà }
 */

/**
 * @swagger
 * /api/auth/forgot-password:
 *   post:
 *     summary: Envoie un email de réinitialisation de mot de passe
 *     description: |
 *       Renvoie toujours 200 — y compris si l'email n'est pas en base — pour
 *       éviter de révéler quels comptes existent. Le lien envoyé contient un
 *       token valide 1 heure stocké dans la table `password_resets`.
 *     tags: [Auth]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               email: { type: string }
 *     responses:
 *       200: { description: Réponse opaque (success true) }
 */

/**
 * @swagger
 * /api/auth/reset-password:
 *   post:
 *     summary: Réinitialise le mot de passe avec un token reçu par email
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [token, password]
 *             properties:
 *               token: { type: string, description: "Token reçu par email" }
 *               password: { type: string, minLength: 6 }
 *     responses:
 *       200: { description: Mot de passe mis à jour }
 *       400: { description: Token invalide ou expiré }
 */

// ──────────────────────────────────────────────────────────────────────────────
//  USERS (admin only)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/users:
 *   get:
 *     summary: Liste tous les utilisateurs
 *     tags: [Users]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: Liste des utilisateurs
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items: { $ref: '#/components/schemas/User' }
 *       403: { description: Accès réservé aux administrateurs }
 *   post:
 *     summary: Crée un compte utilisateur (admin ou non)
 *     tags: [Users]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email: { type: string }
 *               password: { type: string, minLength: 6 }
 *               is_admin: { type: boolean, default: false }
 *               avatar: { type: string, nullable: true }
 *     responses:
 *       201: { description: Utilisateur créé }
 *       403: { description: Accès réservé aux administrateurs }
 *       409: { description: Email déjà utilisé }
 */

/**
 * @swagger
 * /api/users/{id}:
 *   put:
 *     summary: Modifie un utilisateur (email, mot de passe, avatar, rôle admin)
 *     description: Refuse de retirer le rôle admin du dernier administrateur.
 *     tags: [Users]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               email: { type: string }
 *               password: { type: string }
 *               is_admin: { type: boolean }
 *               avatar: { type: string }
 *     responses:
 *       200: { description: Utilisateur mis à jour }
 *       404: { description: Utilisateur introuvable }
 *       409: { description: "Refus : dernier admin ou email déjà utilisé" }
 *   delete:
 *     summary: Supprime un utilisateur
 *     description: Refuse l'auto-suppression et la suppression d'un utilisateur possédant des projets.
 *     tags: [Users]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200: { description: Utilisateur supprimé }
 *       400: { description: Vous ne pouvez pas supprimer votre propre compte }
 *       409: { description: Cet utilisateur possède des projets }
 */

// ──────────────────────────────────────────────────────────────────────────────
//  PROJECTS
// ──────────────────────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/projects:
 *   get:
 *     summary: Liste les projets de l'utilisateur connecté
 *     tags: [Projects]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: Tableau de projets
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items: { $ref: '#/components/schemas/Project' }
 *   post:
 *     summary: Crée un nouveau projet SEO
 *     tags: [Projects]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, domain]
 *             properties:
 *               name: { type: string }
 *               domain: { type: string }
 *               country: { type: string, default: "FR" }
 *               language: { type: string, default: "fr" }
 *               branded_keywords: { type: array, items: { type: string } }
 *     responses:
 *       201: { description: Projet créé }
 */

/**
 * @swagger
 * /api/projects/{projectId}:
 *   put:
 *     summary: Modifie un projet
 *     tags: [Projects]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200: { description: Projet mis à jour }
 *   delete:
 *     summary: Supprime un projet (cascade sur ses keywords, gsc_daily, etc.)
 *     tags: [Projects]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200: { description: Projet supprimé }
 */

// ──────────────────────────────────────────────────────────────────────────────
//  DASHBOARD & OPPORTUNITIES
// ──────────────────────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/dashboard:
 *   get:
 *     summary: Agrégat des KPIs pour le tableau de bord
 *     description: |
 *       Renvoie KPIs pondérés (CTR, position), évolution du trafic 30j,
 *       répartition par marque, et alertes (drift, opportunités).
 *     tags: [Dashboard]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: projectId
 *         schema: { type: integer }
 *         description: Si omis, agrège tous les projets de l'utilisateur
 *     responses:
 *       200:
 *         description: Données du dashboard
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 kpis: { type: object, properties: { totalKeywords: { type: integer }, organicTraffic: { type: integer }, avgCtr: { type: number }, avgPosition: { type: number } } }
 *                 charts: { type: object }
 *                 alerts: { type: object }
 *                 keywords: { type: array }
 */

/**
 * @swagger
 * /api/opportunities:
 *   get:
 *     summary: Liste les opportunités SEO (mots-clés à fort potentiel)
 *     description: |
 *       Trié par opportunity_score décroissant. Le score représente le nombre
 *       de clics gagnés si le mot-clé atteignait le top 3.
 *     tags: [Opportunities]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: projectId
 *         schema: { type: integer }
 *     responses:
 *       200: { description: Liste d'opportunités }
 */

// ──────────────────────────────────────────────────────────────────────────────
//  KEYWORDS — TRACKING
// ──────────────────────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/keywords/tracked:
 *   get:
 *     summary: Liste les mots-clés suivis (is_tracked = true)
 *     description: |
 *       Joint gsc_daily, scores_daily et nlp_keyword_enrichment pour renvoyer
 *       les valeurs courantes (pas les snapshots stales sur la table keywords).
 *       Calcule l'évolution avant/après la date d'optimisation si renseignée.
 *     tags: [Keywords]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: projectId
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Liste de mots-clés suivis avec leurs métriques fraîches
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items: { $ref: '#/components/schemas/TrackedKeyword' }
 */

/**
 * @swagger
 * /api/keywords/{keywordId}/track:
 *   post:
 *     summary: Ajoute un mot-clé au suivi (is_tracked = TRUE)
 *     tags: [Keywords]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: keywordId
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200: { description: Mot-clé marqué comme suivi }
 *       404: { description: Mot-clé introuvable }
 */

/**
 * @swagger
 * /api/keywords/{keywordId}/untrack:
 *   post:
 *     summary: Retire un mot-clé du suivi
 *     tags: [Keywords]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: keywordId
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200: { description: Suivi arrêté }
 */

/**
 * @swagger
 * /api/keywords/{keywordId}/optimization-start-date:
 *   patch:
 *     summary: Définit la date de début d'intervention SEO pour un mot-clé
 *     description: |
 *       Sert de baseline pour calculer l'évolution avant/après optimisation.
 *       L'évolution est ensuite calculée à partir de la première ligne GSC ≥
 *       cette date.
 *     tags: [Keywords]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: keywordId
 *         required: true
 *         schema: { type: integer }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               date: { type: string, format: date, nullable: true, description: "null pour effacer" }
 *     responses:
 *       200: { description: Date enregistrée, row recomputé renvoyé }
 *       400: { description: Format de date invalide (YYYY-MM-DD attendu) }
 */

/**
 * @swagger
 * /api/keywords/{keywordId}/refresh-gsc:
 *   post:
 *     summary: Rafraîchit les données GSC pour un mot-clé spécifique
 *     description: |
 *       Déclenche le workflow n8n dédié (refresh-gsc-keyword) pour ré-ingérer
 *       les rows GSC du mot-clé, puis renvoie le row mis à jour.
 *     tags: [Keywords]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: keywordId
 *         required: true
 *         schema: { type: integer }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               days: { type: integer, default: 14 }
 *     responses:
 *       200: { description: Données rafraîchies, row mis à jour }
 *       500: { description: Échec du webhook n8n }
 */

// ──────────────────────────────────────────────────────────────────────────────
//  CALENDAR
// ──────────────────────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/calendar:
 *   get:
 *     summary: Liste les événements du calendrier
 *     tags: [Calendar]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Liste des événements }
 *   post:
 *     summary: Crée un événement de calendrier
 *     tags: [Calendar]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [title, start_date, end_date, type]
 *             properties:
 *               projectId: { type: integer }
 *               title: { type: string }
 *               description: { type: string }
 *               start_date: { type: string, format: date }
 *               end_date: { type: string, format: date }
 *               type: { type: string, enum: [Publication, Saison, Audit, Urgent] }
 *     responses:
 *       201: { description: Événement créé }
 */

// ──────────────────────────────────────────────────────────────────────────────
//  AI — Z.AI
// ──────────────────────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/projects/{projectId}/cluster:
 *   post:
 *     summary: Génère des clusters sémantiques de mots-clés (via Z.AI)
 *     tags: [AI]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200: { description: Clusters générés et sauvés en base }
 */

/**
 * @swagger
 * /api/projects/{projectId}/action-plan:
 *   get:
 *     summary: Plan d'action SEO en 5 points généré par l'IA
 *     tags: [AI]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Liste de 5 actions priorisées
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   title: { type: string }
 *                   description: { type: string }
 *                   priority: { type: string, enum: [High, Medium, Low] }
 */

/**
 * @swagger
 * /api/ai/dashboard-interpretation:
 *   post:
 *     summary: Interprétation textuelle des KPIs par l'IA
 *     description: Renvoie un paragraphe d'analyse stratégique en français Markdown.
 *     tags: [AI]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               stats: { type: array }
 *               keywords: { type: array }
 *     responses:
 *       200: { description: Markdown généré }
 */

/**
 * @swagger
 * /api/ai/assistant:
 *   post:
 *     summary: Assistant SEO conversationnel streamé (Server-Sent Events)
 *     description: |
 *       Stream conversationnel avec contexte projet optionnel.
 *       Renvoie un flux SSE — chaque delta arrive en temps réel côté client.
 *     tags: [AI]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               messages: { type: array }
 *               useProjectContext: { type: boolean }
 *               projectId: { type: integer, nullable: true }
 *     responses:
 *       200: { description: "Flux SSE (text/event-stream)" }
 */

// ──────────────────────────────────────────────────────────────────────────────
//  NLP
// ──────────────────────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/nlp/qualify:
 *   post:
 *     summary: Classifie un lot de mots-clés (intent, branded, tail type)
 *     description: |
 *       Pipeline hybride : classification rule-based d'abord (instant),
 *       puis enrichissement Z.AI uniquement pour les keywords classés "low confidence".
 *     tags: [NLP]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               keywords: { type: array, items: { type: string } }
 *               projectId: { type: integer }
 *     responses:
 *       200: { description: Résultats de classification }
 */

// ──────────────────────────────────────────────────────────────────────────────
//  INGEST — n8n (auth x-api-key)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/ingest/gsc:
 *   post:
 *     summary: Ingère un lot de lignes Google Search Console
 *     description: Appelé par les workflows n8n cron. Auth par header x-api-key.
 *     tags: [Ingest]
 *     security: [{ apiKeyAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               projectId: { type: integer }
 *               data:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     keyword: { type: string }
 *                     date: { type: string, format: date }
 *                     clicks: { type: integer }
 *                     impressions: { type: integer }
 *                     position: { type: number }
 *                     ctr: { type: number }
 *     responses:
 *       200: { description: Rows upsertés }
 *       401: { description: API Key invalide }
 */

/**
 * @swagger
 * /api/ingest/serp:
 *   post:
 *     summary: Ingère un lot de lignes SERP (scrape)
 *     description: Auth par header x-api-key. Données optionnelles (enrichissement).
 *     tags: [Ingest]
 *     security: [{ apiKeyAuth: [] }]
 *     responses:
 *       200: { description: Rows upsertés }
 *       401: { description: API Key invalide }
 */

// ──────────────────────────────────────────────────────────────────────────────
//  KPI COMPUTATION
// ──────────────────────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/compute/kpis:
 *   post:
 *     summary: Calcule et persiste les 7 KPIs SEO dans scores_daily
 *     description: |
 *       Recalcule pour un projet et une date donnés :
 *       opportunity_score, quick_win_score, priority_score, competition_score,
 *       ctr_gap, performance_drift, long_tail_indicator.
 *       Auth par header x-api-key (déclenché par n8n).
 *     tags: [KPI]
 *     security: [{ apiKeyAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [projectId, date]
 *             properties:
 *               projectId: { type: integer }
 *               date: { type: string, format: date }
 *     responses:
 *       200: { description: KPIs calculés et upsertés en base }
 *       400: { description: projectId ou date manquant }
 *       404: { description: Projet introuvable }
 */

// ──────────────────────────────────────────────────────────────────────────────
//  SETTINGS & PROFILE
// ──────────────────────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/settings:
 *   get:
 *     summary: Récupère les paramètres utilisateur
 *     tags: [Settings]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Paramètres }
 *   put:
 *     summary: Met à jour les paramètres utilisateur
 *     tags: [Settings]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Paramètres mis à jour }
 */

/**
 * @swagger
 * /api/profile:
 *   put:
 *     summary: Met à jour le profil (email, mot de passe, avatar)
 *     tags: [Settings]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               email: { type: string }
 *               password: { type: string }
 *               avatar: { type: string }
 *     responses:
 *       200: { description: Profil mis à jour }
 */

// ──────────────────────────────────────────────────────────────────────────────
//  HEALTH
// ──────────────────────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/health:
 *   get:
 *     summary: Vérifie que le serveur tourne
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: Service vivant
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: string, example: "ok" }
 */

export {}; // marqueur module ESM
