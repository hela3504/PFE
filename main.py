import os
import json
import jwt
from datetime import datetime, timedelta
from typing import List, Optional
from sqlalchemy import BigInteger, Date, DateTime, create_engine, Column, Integer, String, Float, Boolean, ForeignKey, UniqueConstraint, and_, select, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, Session
from sqlalchemy.dialects.postgresql import insert as pg_insert
from google import genai
from google.genai import types
from passlib.context import CryptContext
 
# Configuration
DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    # Fallback for local dev if needed, but the user wants PostgreSQL
    DATABASE_URL = "postgresql://user:password@localhost:5432/seo_bi"

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

# Database Setup
Base = declarative_base()
# PostgreSQL engine
engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True, nullable=False)
    password = Column(String, nullable=False)

class Project(Base):
    __tablename__ = "projects"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String)
    domain = Column(String)
    site_url = Column(String)        # url du site
    gsc_property = Column(String)    # propriété GSC (sc-domain:example.com)
    country = Column(String)
    language = Column(String)
    branded_keywords = Column(String)   # mots clés de marque
    default_days_back = Column(Integer, default=7)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow)
    userId = Column(Integer, ForeignKey("users.id"), index=True)

class GSCDaily(Base):
    __tablename__ = "gsc_daily"
    id = Column(Integer, primary_key=True, index=True)
    projectId = Column(Integer, ForeignKey("projects.id"), index=True)
    keyword = Column(String, index=True)
    page = Column(String)  # <-- important
    date = Column(Date, index=True)
    impressions = Column(Integer)
    clicks = Column(Integer)
    position = Column(Float)
    ctr = Column(Float)
    __table_args__ = (
        UniqueConstraint('projectId', 'keyword', 'page', 'date', name='_gsc_project_keyword_page_date_uc'),
    )

class SERPDaily(Base):
    """serp_daily v2 — voir migrations/serp_daily_v2.sql.

    SerpAPI ne renvoie pas volume/cpc/competition, donc on les a sortis du schéma.
    Les listes (organic_results, paa, related_searches, ai_overview, knowledge_graph)
    sont stockées en JSONB. raw_response conserve le payload SerpAPI brut.
    """
    __tablename__ = "serp_daily"
    __table_args__ = (
        UniqueConstraint("projectid", "keyword", "date", "device", name="serp_daily_unique"),
    )

    id = Column(Integer, primary_key=True, index=True)
    projectid = Column(Integer, ForeignKey("projects.id"), index=True)
    keyword = Column(String, index=True)
    date = Column(Date, index=True)

    # Search context (depuis SerpAPI search_parameters)
    device = Column(String, nullable=False, default="desktop")
    gl = Column(String)
    hl = Column(String)
    engine = Column(String, nullable=False, default="google")

    # Notre position dans la SERP
    your_position = Column(Integer)
    your_url = Column(String)
    your_title = Column(String)
    your_snippet = Column(String)
    your_in_aio = Column(Boolean, nullable=False, default=False)

    # SERP features
    has_ai_overview = Column(Boolean, nullable=False, default=False)
    has_paa = Column(Boolean, nullable=False, default=False)
    has_knowledge_graph = Column(Boolean, nullable=False, default=False)
    has_inline_videos = Column(Boolean, nullable=False, default=False)
    has_inline_images = Column(Boolean, nullable=False, default=False)
    has_sitelinks = Column(Boolean, nullable=False, default=False)
    has_rich_snippets = Column(Boolean, nullable=False, default=False)

    # Compteurs rapides
    total_results = Column(BigInteger)
    organic_count = Column(Integer, nullable=False, default=0)
    paa_count = Column(Integer, nullable=False, default=0)

    # Données structurées (JSONB)
    organic_results = Column(JSONB, nullable=False, default=list)
    paa_questions = Column(JSONB, nullable=False, default=list)
    related_searches = Column(JSONB, nullable=False, default=list)
    ai_overview = Column(JSONB)
    knowledge_graph = Column(JSONB)
    raw_response = Column(JSONB)

    error = Column(String)
    scraped_at = Column(DateTime)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow)

class ScoresDaily(Base):
    __tablename__ = "scores_daily"
    id = Column(Integer, primary_key=True, index=True)
    projectId = Column(Integer, ForeignKey("projects.id"))
    keyword = Column(String)
    date = Column(String)
    competition_score = Column(Float)
    opportunity_score = Column(Float)
    ctr_gap = Column(Float)
    performance_drift = Column(Float)
    long_tail_indicator = Column(Float)
    __table_args__ = (UniqueConstraint('projectId', 'keyword', 'date', name='_project_keyword_date_uc'),)

class NLPEnrichment(Base):
    __tablename__ = "nlp_keyword_enrichment"
    id = Column(Integer, primary_key=True, index=True)
    projectId = Column(Integer, ForeignKey("projects.id"))
    keyword = Column(String)
    date = Column(String)
    branded_status = Column(String)
    stability_status = Column(String)
    tail_type = Column(String)
    search_intent = Column(String)
    exclude_from_opportunity = Column(Boolean)
    qualification_label = Column(String)
    priority_level = Column(String)
    action_hint = Column(String)
    reasoning = Column(String)
    __table_args__ = (UniqueConstraint('projectId', 'keyword', 'date', name='_nlp_project_keyword_date_uc'),)

class KeywordCluster(Base):
    __tablename__ = "keyword_clusters"
    id = Column(Integer, primary_key=True, index=True)
    projectId = Column(Integer, ForeignKey("projects.id"))
    cluster_name = Column(String)
    keywords = Column(String)  # JSON string
    description = Column(String)
    priority = Column(String)
    created_at = Column(String, default=lambda: datetime.now().isoformat())

class CalendarEvent(Base):
    __tablename__ = "events"
    id = Column(Integer, primary_key=True, index=True)
    projectId = Column(Integer, ForeignKey("projects.id"))
    title = Column(String)
    description = Column(String)
    start_date = Column(String)
    end_date = Column(String)
    type = Column(String)  # 'Publication', 'Saison', 'Audit', 'Urgent'

# Auth Setup
JWT_SECRET = os.getenv("JWT_SECRET", "seo-bi-secret-key-12345")
ALGORITHM = "HS256"
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

def init_db():
    Base.metadata.create_all(bind=engine)
    seed_user()
    print("Database initialized successfully")

def seed_user():  # Crée un utilisateur admin par défaut s'il n'existe pas
    db = SessionLocal()
    try:
        user = db.query(User).filter(User.email == "admin@example.com").first()
        if not user:
            hashed_pw = pwd_context.hash("password123")
            new_user = User(email="admin@example.com", password=hashed_pw)
            db.add(new_user)
            db.commit()
    finally:
        db.close()

# Utility Functions (formerly API endpoints)
def ingest_gsc(project_id: int, data: List[dict]):
    db = SessionLocal()
    try:
        for item in data:
            stmt = pg_insert(GSCDaily).values(
                projectId=project_id,
                keyword=item['keyword'],
                date=item['date'],
                impressions=item['impressions'],
                clicks=item['clicks'],
                position=item['position'],
                ctr=item['ctr']
            )
            stmt = stmt.on_conflict_do_update(
                constraint='_gsc_project_keyword_page_date_uc',
                set_={
                    "impressions": stmt.excluded.impressions,
                    "clicks": stmt.excluded.clicks,
                    "position": stmt.excluded.position,
                    "ctr": stmt.excluded.ctr
                }
            )
            db.execute(stmt)
        db.commit()
        return {"success": True, "count": len(data)}
    finally:
        db.close()

def _extract_domain(url):
    if not url:
        return None
    try:
        from urllib.parse import urlparse
        host = urlparse(url).hostname or ""
        return host.lower().lstrip("www.") if host else None
    except Exception:
        return None


def _transform_organic(arr):
    out = []
    for r in (arr or []):
        sl = r.get("sitelinks") or {}
        sitelinks = sl.get("inline") if isinstance(sl, dict) else (sl if isinstance(sl, list) else [])
        out.append({
            "position": r.get("position"),
            "title": r.get("title"),
            "link": r.get("link"),
            "displayed_link": r.get("displayed_link"),
            "domain": _extract_domain(r.get("link")),
            "snippet": r.get("snippet"),
            "sitelinks": sitelinks or [],
            "rich_snippet": r.get("rich_snippet"),
        })
    return out


def _find_your_position(organic, project_domain):
    if not project_domain:
        return {"position": None, "url": None, "title": None, "snippet": None}
    for r in organic:
        d = r.get("domain") or _extract_domain(r.get("link"))
        if d and (d == project_domain or d.endswith("." + project_domain)):
            return {"position": r.get("position"), "url": r.get("link"), "title": r.get("title"), "snippet": r.get("snippet")}
    return {"position": None, "url": None, "title": None, "snippet": None}


def ingest_serp(project_id: int, items: List[dict]):
    """Ingest raw SerpAPI items (v2 shape).

    Chaque item doit avoir au minimum search_parameters.q. Le payload SerpAPI
    brut est conservé dans raw_response. Aligné avec /api/ingest/serp dans
    server.ts (cf. migrations/serp_daily_v2.sql).
    """
    db = SessionLocal()
    try:
        proj = db.query(Project).filter(Project.id == project_id).first()
        project_domain = _extract_domain(proj.domain) if proj and proj.domain else None

        for item in items:
            sp = item.get("search_parameters") or {}
            keyword = sp.get("q")
            if not keyword:
                continue

            created_at = (item.get("search_metadata") or {}).get("created_at")
            d = datetime.utcnow().date()
            if created_at:
                try:
                    d = datetime.strptime(created_at[:10], "%Y-%m-%d").date()
                except ValueError:
                    pass

            organic = _transform_organic(item.get("organic_results"))
            paa = [
                {"question": q.get("question"), "snippet": q.get("snippet"),
                 "title": q.get("title"), "link": q.get("link")}
                for q in (item.get("related_questions") or [])
            ]
            related = [
                {"query": r.get("query") or r.get("text"), "link": r.get("link")}
                for r in (item.get("related_searches") or [])
            ]
            aio = item.get("ai_overview")
            yours = _find_your_position(organic, project_domain)

            has_inline_videos = bool(item.get("inline_videos")) or bool(item.get("short_videos"))
            has_sitelinks = any(isinstance(r.get("sitelinks"), list) and r["sitelinks"] for r in organic)
            has_rich_snippets = any(r.get("rich_snippet") for r in organic)

            stmt = pg_insert(SERPDaily).values(
                projectid=project_id,
                keyword=keyword,
                date=d,
                device=(sp.get("device") or "desktop").lower(),
                gl=sp.get("gl"),
                hl=sp.get("hl"),
                engine=sp.get("engine") or "google",
                your_position=yours["position"],
                your_url=yours["url"],
                your_title=yours["title"],
                your_snippet=yours["snippet"],
                your_in_aio=False,
                has_ai_overview=bool(aio),
                has_paa=len(paa) > 0,
                has_knowledge_graph=bool(item.get("knowledge_graph")),
                has_inline_videos=has_inline_videos,
                has_inline_images=bool(item.get("inline_images")),
                has_sitelinks=has_sitelinks,
                has_rich_snippets=has_rich_snippets,
                total_results=(item.get("search_information") or {}).get("total_results"),
                organic_count=len(organic),
                paa_count=len(paa),
                organic_results=organic,
                paa_questions=paa,
                related_searches=related,
                ai_overview=aio,
                knowledge_graph=item.get("knowledge_graph"),
                raw_response=item,
                error=item.get("error"),
                scraped_at=datetime.strptime(created_at[:19], "%Y-%m-%d %H:%M:%S") if created_at else None,
            )
            stmt = stmt.on_conflict_do_update(
                constraint="serp_daily_unique",
                set_={
                    "gl": stmt.excluded.gl,
                    "hl": stmt.excluded.hl,
                    "engine": stmt.excluded.engine,
                    "your_position": stmt.excluded.your_position,
                    "your_url": stmt.excluded.your_url,
                    "your_title": stmt.excluded.your_title,
                    "your_snippet": stmt.excluded.your_snippet,
                    "your_in_aio": stmt.excluded.your_in_aio,
                    "has_ai_overview": stmt.excluded.has_ai_overview,
                    "has_paa": stmt.excluded.has_paa,
                    "has_knowledge_graph": stmt.excluded.has_knowledge_graph,
                    "has_inline_videos": stmt.excluded.has_inline_videos,
                    "has_inline_images": stmt.excluded.has_inline_images,
                    "has_sitelinks": stmt.excluded.has_sitelinks,
                    "has_rich_snippets": stmt.excluded.has_rich_snippets,
                    "total_results": stmt.excluded.total_results,
                    "organic_count": stmt.excluded.organic_count,
                    "paa_count": stmt.excluded.paa_count,
                    "organic_results": stmt.excluded.organic_results,
                    "paa_questions": stmt.excluded.paa_questions,
                    "related_searches": stmt.excluded.related_searches,
                    "ai_overview": stmt.excluded.ai_overview,
                    "knowledge_graph": stmt.excluded.knowledge_graph,
                    "raw_response": stmt.excluded.raw_response,
                    "error": stmt.excluded.error,
                    "scraped_at": stmt.excluded.scraped_at,
                },
            )
            db.execute(stmt)
        db.commit()
        return {"success": True, "count": len(items)}
    finally:
        db.close()

def compute_kpis(project_id: int, date: str):
    db = SessionLocal()
    try:
        gsc_data = db.query(GSCDaily).filter(GSCDaily.projectId == project_id, GSCDaily.date == date).all()
        serp_data = db.query(SERPDaily).filter(SERPDaily.projectId == project_id, SERPDaily.date == date).all()
        
        # Fetch yesterday's data for drift
        yesterday_date = (datetime.strptime(date, "%Y-%m-%d") - timedelta(days=1)).strftime("%Y-%m-%d")
        yesterday_gsc = db.query(GSCDaily).filter(GSCDaily.projectId == project_id, GSCDaily.date == yesterday_date).all()
        yesterday_map = {y.keyword: y.position for y in yesterday_gsc}
        
        serp_map = {s.keyword: s for s in serp_data}
        
        for g in gsc_data:
            s = serp_map.get(g.keyword)

            # competition_score : estimé depuis la position GSC, enrichi par
            # les SERP features (PAA, AI Overview, knowledge graph) — schéma v2,
            # cf. computeCompetitionScore() dans server.ts.
            pos = g.position or 50
            base = max(0.0, min(1.0, 1 - (pos - 1) / 49))
            if s:
                if s.has_ai_overview:
                    base = min(1.0, base + 0.10)
                if (s.paa_count or 0) >= 4:
                    base = min(1.0, base + 0.08)
                elif (s.paa_count or 0) >= 2:
                    base = min(1.0, base + 0.04)
                if s.has_knowledge_graph:
                    base = min(1.0, base + 0.05)
            comp_score = round(base, 3)

            # opportunity_score : impressions × gap CTR vers le top 3 (~11%),
            # cf. computeOpportunityScore() dans server.ts.
            imp = g.impressions or 0
            ctr_gap = (0.3 if g.position < 3 else 0.1) - (g.ctr or 0)
            gain = 0.11 - (g.ctr or 0)
            opp_score = round(imp * gain, 1) if gain > 0 and imp > 0 else 0.0
            
            # Drift calculation
            prev_pos = yesterday_map.get(g.keyword)
            drift = g.position - prev_pos if prev_pos is not None else 0.0
            
            tail = 1.0 if len(g.keyword.split()) > 3 else 0.0
            
            stmt = pg_insert(ScoresDaily).values(
                projectId=project_id, keyword=g.keyword, date=date,
                competition_score=comp_score, opportunity_score=opp_score,
                ctr_gap=ctr_gap, performance_drift=drift, long_tail_indicator=tail
            )
            stmt = stmt.on_conflict_do_update(
                constraint='_project_keyword_date_uc',
                set_={
                    "competition_score": stmt.excluded.competition_score,
                    "opportunity_score": stmt.excluded.opportunity_score,
                    "ctr_gap": stmt.excluded.ctr_gap,
                    "performance_drift": stmt.excluded.performance_drift,
                    "long_tail_indicator": stmt.excluded.long_tail_indicator
                }
            )
            db.execute(stmt)
        
        db.commit()
        return {"success": True}
    finally:
        db.close()

import json
from typing import Optional, List
from sqlalchemy.dialects.postgresql import insert as pg_insert


def nlp_qualify(
    project_id: int,
    date: str,
    keywords_to_process: Optional[List[dict]] = None,
    project_brands: Optional[List[str]] = None,
):
    db = SessionLocal()
    try:
        if project_brands is None:
            project_brands = []

        # Si aucun mot-clé n'est fourni, on lit depuis ScoresDaily
        if not keywords_to_process:
            scores = (
                db.query(ScoresDaily)
                .filter(
                    ScoresDaily.projectId == project_id,
                    ScoresDaily.date == date
                )
                .all()
            )

            keywords_to_process = []
            for s in scores:
                keywords_to_process.append({
                    "keyword": s.keyword,
                    "opportunity_score": getattr(s, "opportunity_score", None),
                    "competition_score": getattr(s, "competition_score", None),
                    "ctr_gap": getattr(s, "ctr_gap", None),
                    "performance_drift": getattr(s, "performance_drift", None),
                    "long_tail_indicator": getattr(s, "long_tail_indicator", None),
                })

        if not keywords_to_process:
            return {"success": True, "message": "No keywords to qualify"}

        # Enrichissement simple côté backend avant envoi à Gemini
        def heuristic_tail_type(keyword: str) -> str:
            return "long_tail" if len(keyword.strip().split()) >= 3 else "generic"

        def heuristic_branded(keyword: str, brands: List[str]) -> bool:
            kw = keyword.lower()
            return any(brand.lower() in kw for brand in brands if brand)

        def heuristic_intent(keyword: str) -> str:
            kw = keyword.lower()
            transactional_terms = [
                "prix", "acheter", "commande", "promo", "promotions",
                "livraison", "devis", "réserver", "reservation", "buy",
                "shop", "order", "discount"
            ]
            navigational_terms = [
                "login", "connexion", "contact", "adresse", "site officiel",
                "official site", "facebook", "instagram"
            ]

            if any(term in kw for term in transactional_terms):
                return "transactionnelle"
            if any(term in kw for term in navigational_terms):
                return "navigationnelle"
            return "informationnelle"

        enriched_keywords = []
        for item in keywords_to_process:
            keyword = str(item.get("keyword", "")).strip()
            if not keyword:
                continue

            enriched_keywords.append({
                "keyword": keyword,
                "opportunity_score": item.get("opportunity_score"),
                "competition_score": item.get("competition_score"),
                "ctr_gap": item.get("ctr_gap"),
                "performance_drift": item.get("performance_drift"),
                "long_tail_indicator": item.get("long_tail_indicator"),
                "heuristic_tail_type": heuristic_tail_type(keyword),
                "heuristic_branded": heuristic_branded(keyword, project_brands),
                "heuristic_intent": heuristic_intent(keyword),
            })

        if not enriched_keywords:
            return {"success": True, "message": "No valid keywords to qualify"}

        client = genai.Client(api_key=GEMINI_API_KEY)

        prompt = f"""
Tu es un expert SEO senior chargé de la qualification automatique de mots-clés pour une plateforme SaaS SEO.

OBJECTIF :
Classifier chaque mot-clé avec précision pour aider à la priorisation SEO.
Évite les réponses génériques ou répétitives.
Tous les mots-clés ne sont PAS informationnels.
Tous les mots-clés ne sont PAS non_branded.

MARQUES DU PROJET :
{json.dumps(project_brands, ensure_ascii=False)}

DONNÉES À ANALYSER :
{json.dumps(enriched_keywords, ensure_ascii=False)}

RÈGLES :

1. branded_status
- "branded" si le mot-clé contient une marque du projet, un nom de domaine, ou une variante très proche.
- sinon "non_branded"
- utilise aussi le champ heuristic_branded comme signal fort

2. search_intent
- "informationnelle" : recherche d'explication, définition, guide, avis, symptôme, bienfait
- "transactionnelle" : achat, prix, promo, commande, livraison, devis, réserver
- "navigationnelle" : recherche d'une marque, d'un site, d'une page ou d'un contact précis
- utilise aussi le champ heuristic_intent comme indice, pas comme vérité absolue

3. tail_type
- "long_tail" si le mot-clé contient 3 mots ou plus et exprime une recherche spécifique
- sinon "generic"
- utilise aussi heuristic_tail_type comme signal fort

4. stability_status
- "stable" seulement si le mot-clé semble déjà bien performer ou déjà protégé
- sinon "opportunity"
- si doute, préférer "opportunity"

5. exclude_from_opportunity
- true seulement si branded_status = branded ET stability_status = stable
- sinon false

6. qualification_label
Choisir parmi :
- "Quick Win"
- "High Potential"
- "Brand Protection"
- "To Monitor"
- "Low Priority"

7. priority_level
Choisir parmi :
- "low"
- "medium"
- "high"

8. action_hint
Une seule action principale, courte et concrète.

9. reasoning
Une explication courte, spécifique, et liée au mot-clé.

IMPORTANT :
- Retourne UNIQUEMENT un tableau JSON valide.
- N'utilise pas systématiquement les mêmes classes.
- Si un mot-clé contient une marque évidente, il doit être branded.
- Si un mot-clé semble commercial, local ou orienté achat, évite de le mettre automatiquement en informationnelle.
- Respecte strictement les valeurs autorisées.

FORMAT OBLIGATOIRE :
[
  {{
    "keyword": "...",
    "branded_status": "branded|non_branded",
    "stability_status": "stable|opportunity",
    "tail_type": "long_tail|generic",
    "search_intent": "informationnelle|transactionnelle|navigationnelle",
    "exclude_from_opportunity": true,
    "qualification_label": "Quick Win|High Potential|Brand Protection|To Monitor|Low Priority",
    "priority_level": "low|medium|high",
    "action_hint": "...",
    "reasoning": "..."
  }}
]
"""

        response = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=prompt,
            config=types.GenerateContentConfig(
                response_mime_type="application/json"
            )
        )

        raw_text = response.text or "[]"
        results = json.loads(raw_text)

        if not isinstance(results, list):
            raise ValueError("Gemini response is not a list")

        allowed_branded = {"branded", "non_branded"}
        allowed_stability = {"stable", "opportunity"}
        allowed_tail = {"long_tail", "generic"}
        allowed_intent = {"informationnelle", "transactionnelle", "navigationnelle"}
        allowed_priority = {"low", "medium", "high"}
        allowed_labels = {
            "Quick Win",
            "High Potential",
            "Brand Protection",
            "To Monitor",
            "Low Priority",
        }

        saved_results = []

        for res in results:
            keyword = str(res.get("keyword", "")).strip()
            if not keyword:
                continue

            branded_status = str(res.get("branded_status", "non_branded")).strip()
            stability_status = str(res.get("stability_status", "opportunity")).strip()
            tail_type = str(res.get("tail_type", heuristic_tail_type(keyword))).strip()
            search_intent = str(res.get("search_intent", heuristic_intent(keyword))).strip()
            exclude_from_opportunity = bool(res.get("exclude_from_opportunity", False))
            qualification_label = str(res.get("qualification_label", "To Monitor")).strip()
            priority_level = str(res.get("priority_level", "medium")).strip()
            action_hint = str(res.get("action_hint", "Analyser et prioriser ce mot-clé")).strip()
            reasoning = str(res.get("reasoning", "")).strip()

            # Garde-fous
            if branded_status not in allowed_branded:
                branded_status = "branded" if heuristic_branded(keyword, project_brands) else "non_branded"

            if stability_status not in allowed_stability:
                stability_status = "opportunity"

            if tail_type not in allowed_tail:
                tail_type = heuristic_tail_type(keyword)

            if search_intent not in allowed_intent:
                search_intent = heuristic_intent(keyword)

            if priority_level not in allowed_priority:
                priority_level = "medium"

            if qualification_label not in allowed_labels:
                qualification_label = "To Monitor"

            # Recalcul de sécurité
            exclude_from_opportunity = (branded_status == "branded" and stability_status == "stable")

            stmt = pg_insert(NLPEnrichment).values(
                projectId=project_id,
                date=date,
                keyword=keyword,
                branded_status=branded_status,
                stability_status=stability_status,
                tail_type=tail_type,
                search_intent=search_intent,
                exclude_from_opportunity=exclude_from_opportunity,
                qualification_label=qualification_label,
                priority_level=priority_level,
                action_hint=action_hint,
                reasoning=reasoning,
            )

            stmt = stmt.on_conflict_do_update(
                constraint="_nlp_project_keyword_date_uc",
                set_={
                    "branded_status": stmt.excluded.branded_status,
                    "stability_status": stmt.excluded.stability_status,
                    "tail_type": stmt.excluded.tail_type,
                    "search_intent": stmt.excluded.search_intent,
                    "exclude_from_opportunity": stmt.excluded.exclude_from_opportunity,
                    "qualification_label": stmt.excluded.qualification_label,
                    "priority_level": stmt.excluded.priority_level,
                    "action_hint": stmt.excluded.action_hint,
                    "reasoning": stmt.excluded.reasoning,
                }
            )

            db.execute(stmt)

            saved_results.append({
                "keyword": keyword,
                "branded_status": branded_status,
                "stability_status": stability_status,
                "tail_type": tail_type,
                "search_intent": search_intent,
                "exclude_from_opportunity": exclude_from_opportunity,
                "qualification_label": qualification_label,
                "priority_level": priority_level,
                "action_hint": action_hint,
                "reasoning": reasoning,
            })

        db.commit()
        return {"success": True, "results": saved_results}

    except Exception as e:
        db.rollback()
        return {
            "success": False,
            "error": str(e),
        }
    finally:
        db.close()

def cluster_keywords(project_id: int):
    db = SessionLocal()
    try:
        keywords = (
            db.query(GSCDaily.keyword)
            .filter(GSCDaily.projectId == project_id)
            .distinct()
            .all()
        )

        if not keywords:
            return {"success": True, "clusters": []}

        keyword_list = [k.keyword.strip() for k in keywords if k.keyword and k.keyword.strip()]

        if not keyword_list:
            return {"success": True, "clusters": []}

        client = genai.Client(api_key=GEMINI_API_KEY)

        prompt = f"""
Tu es un expert SEO senior spécialisé en clustering sémantique.

MISSION :
Regrouper les mots-clés suivants en clusters thématiques SEO cohérents, utiles et exploitables pour une stratégie de contenu.

MOTS-CLÉS :
{json.dumps(keyword_list, ensure_ascii=False)}

RÈGLES :
1. Un cluster doit regrouper des mots-clés proches par sujet, intention ou univers sémantique.
2. Les clusters doivent être utiles pour piloter une stratégie SEO ou éditoriale.
3. Évite les clusters trop larges ou vagues.
4. Évite les clusters d’un seul mot-clé sauf si le sujet est vraiment isolé.
5. Le nom du cluster doit être clair, court et exploitable.
6. La description doit être courte, concrète et compréhensible.
7. La priorité doit être l’une de ces valeurs uniquement :
   - "High"
   - "Medium"
   - "Low"

IMPORTANT :
- Retourne UNIQUEMENT un tableau JSON valide.
- Ne retourne aucun texte hors JSON.
- Chaque mot-clé doit apparaître dans un seul cluster principal.
- Si certains mots-clés sont très proches, regroupe-les ensemble.

FORMAT DE SORTIE OBLIGATOIRE :
[
  {{
    "cluster_name": "...",
    "description": "...",
    "keywords": ["...", "..."],
    "priority": "High|Medium|Low"
  }}
]
"""

        response = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=prompt,
            config=types.GenerateContentConfig(
                response_mime_type="application/json"
            )
        )

        raw_text = response.text or "[]"
        clusters = json.loads(raw_text)

        if not isinstance(clusters, list):
            raise ValueError("Gemini response is not a list")

        allowed_priorities = {"High", "Medium", "Low"}
        used_keywords = set()
        cleaned_clusters = []

        for c in clusters:
            cluster_name = str(c.get("cluster_name", "")).strip()
            description = str(c.get("description", "")).strip()
            priority = str(c.get("priority", "Medium")).strip()
            cluster_keywords_raw = c.get("keywords", [])

            if not isinstance(cluster_keywords_raw, list):
                cluster_keywords_raw = []

            cleaned_keywords = []
            for kw in cluster_keywords_raw:
                kw_str = str(kw).strip()
                if kw_str and kw_str in keyword_list and kw_str not in used_keywords:
                    cleaned_keywords.append(kw_str)
                    used_keywords.add(kw_str)

            if not cluster_name:
                cluster_name = "Cluster SEO"

            if not description:
                description = f"Groupe de mots-clés liés à {cluster_name.lower()}."

            if priority not in allowed_priorities:
                priority = "Medium"

            if cleaned_keywords:
                cleaned_clusters.append({
                    "cluster_name": cluster_name,
                    "description": description,
                    "keywords": cleaned_keywords,
                    "priority": priority,
                })

        # Ajouter les mots-clés oubliés par Gemini
        remaining_keywords = [kw for kw in keyword_list if kw not in used_keywords]
        if remaining_keywords:
            cleaned_clusters.append({
                "cluster_name": "Autres opportunités",
                "description": "Mots-clés restants non regroupés automatiquement.",
                "keywords": remaining_keywords,
                "priority": "Low",
            })

        # Supprimer les anciens clusters
        db.query(KeywordCluster).filter(KeywordCluster.projectId == project_id).delete()

        # Insérer les nouveaux
        for c in cleaned_clusters:
            new_cluster = KeywordCluster(
                projectId=project_id,
                cluster_name=c["cluster_name"],
                description=c["description"],
                keywords=json.dumps(c["keywords"], ensure_ascii=False),
                priority=c["priority"],
            )
            db.add(new_cluster)

        db.commit()
        return {"success": True, "clusters": cleaned_clusters}

    except Exception as e:
        db.rollback()
        return {
            "success": False,
            "error": str(e),
        }
    finally:
        db.close()


if __name__ == "__main__":
    # Example usage when running as a script
    init_db()
    print("SEO Intelligence Utility Script Ready")
 