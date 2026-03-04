import os
import json
import jwt
from datetime import datetime, timedelta
from typing import List, Optional
from sqlalchemy import create_engine, Column, Integer, String, Float, Boolean, ForeignKey, UniqueConstraint, and_, select
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
    country = Column(String)
    language = Column(String)
    userId = Column(Integer, ForeignKey("users.id"), index=True)

class GSCDaily(Base):
    __tablename__ = "gsc_daily"
    id = Column(Integer, primary_key=True, index=True)
    projectId = Column(Integer, ForeignKey("projects.id"))
    keyword = Column(String)
    date = Column(String)
    impressions = Column(Integer)
    clicks = Column(Integer)
    position = Column(Float)
    ctr = Column(Float)
    __table_args__ = (UniqueConstraint('projectId', 'keyword', 'date', name='_gsc_project_keyword_date_uc'),)

class SERPDaily(Base):
    __tablename__ = "serp_daily"
    id = Column(Integer, primary_key=True, index=True)
    projectId = Column(Integer, ForeignKey("projects.id"))
    keyword = Column(String)
    date = Column(String)
    position = Column(Integer)
    competition = Column(Float)
    volume = Column(Integer)
    cpc = Column(Float)
    __table_args__ = (UniqueConstraint('projectId', 'keyword', 'date', name='_serp_project_keyword_date_uc'),)

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

class Connector(Base):
    __tablename__ = "connectors"
    id = Column(Integer, primary_key=True, index=True)
    projectId = Column(Integer, ForeignKey("projects.id"))
    type = Column(String)  # 'GSC', 'SEMrush', 'GoogleSheets'
    config = Column(String)  # JSON string
    status = Column(String)
    last_sync = Column(String)

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

def seed_user():
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
                constraint='_gsc_project_keyword_date_uc',
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

def ingest_serp(project_id: int, data: List[dict]):
    db = SessionLocal()
    try:
        for item in data:
            stmt = pg_insert(SERPDaily).values(
                projectId=project_id,
                keyword=item['keyword'],
                date=item['date'],
                position=item['position'],
                competition=item['competition'],
                volume=item.get('volume', 0),
                cpc=item.get('cpc', 0.0)
            )
            stmt = stmt.on_conflict_do_update(
                constraint='_serp_project_keyword_date_uc',
                set_={
                    "position": stmt.excluded.position,
                    "competition": stmt.excluded.competition,
                    "volume": stmt.excluded.volume,
                    "cpc": stmt.excluded.cpc
                }
            )
            db.execute(stmt)
        db.commit()
        return {"success": True, "count": len(data)}
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
            
            comp_score = s.competition if s else 0.5
            vol = s.volume if s else 0
            ctr_gap = (0.3 if g.position < 3 else 0.1) - g.ctr
            opp_score = (1 - comp_score) * (vol / 1000) * max(0, ctr_gap)
            
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

def nlp_qualify(project_id: int, date: str, keywords_to_process: Optional[List[dict]] = None):
    db = SessionLocal()
    try:
        # If no keywords provided, read from ScoresDaily for that date
        if not keywords_to_process:
            scores = db.query(ScoresDaily).filter(ScoresDaily.projectId == project_id, ScoresDaily.date == date).all()
            keywords_to_process = [{"keyword": s.keyword, "opportunity_score": s.opportunity_score} for s in scores]
        
        if not keywords_to_process:
            return {"success": True, "message": "No keywords to qualify"}

        client = genai.Client(api_key=GEMINI_API_KEY)
        
        prompt = f"""Tu es le module "ML & NLP Intelligence" d’une plateforme SaaS SEO.
Analyse et enrichis les mots-clés suivants pour la "Qualification Automatique".

Données (JSON): {json.dumps(keywords_to_process)}

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
keyword, branded_status, stability_status, tail_type, search_intent, exclude_from_opportunity, qualification_label, priority_level, action_hint, reasoning"""

        response = client.models.generate_content(
            model="gemini-3-flash-preview",
            contents=prompt,
            config=types.GenerateContentConfig(
                response_mime_type="application/json"
            )
        )
        results = json.loads(response.text)
        
        for res in results:
            stmt = pg_insert(NLPEnrichment).values(
                projectId=project_id, date=date, **res
            )
            stmt = stmt.on_conflict_do_update(
                constraint='_nlp_project_keyword_date_uc',
                set_={
                    "branded_status": stmt.excluded.branded_status,
                    "stability_status": stmt.excluded.stability_status,
                    "tail_type": stmt.excluded.tail_type,
                    "search_intent": stmt.excluded.search_intent,
                    "exclude_from_opportunity": stmt.excluded.exclude_from_opportunity,
                    "qualification_label": stmt.excluded.qualification_label,
                    "priority_level": stmt.excluded.priority_level,
                    "action_hint": stmt.excluded.action_hint,
                    "reasoning": stmt.excluded.reasoning
                }
            )
            db.execute(stmt)
        
        db.commit()
        return {"success": True, "results": results}
    finally:
        db.close()

def cluster_keywords(project_id: int):
    db = SessionLocal()
    try:
        keywords = db.query(GSCDaily.keyword).filter(GSCDaily.projectId == project_id).distinct().all()
        if not keywords:
            return {"success": True, "clusters": []}
        
        keyword_list = ", ".join([k.keyword for k in keywords])
        prompt = f"""Tu es un expert SEO. Regroupe les mots-clés suivants en clusters sémantiques logiques. 
        Pour chaque cluster, donne un nom, une brève description, la liste des mots-clés et un niveau de priorité (High, Medium, Low).
        Mots-clés: {keyword_list}
        RETOURNE UNIQUEMENT UN TABLEAU JSON d'objets avec ces clés: cluster_name, description, keywords (array), priority"""

        client = genai.Client(api_key=GEMINI_API_KEY)
        response = client.models.generate_content(
            model="gemini-3-flash-preview",
            contents=prompt,
            config=types.GenerateContentConfig(response_mime_type="application/json")
        )
        clusters = json.loads(response.text)
        
        # Clear old clusters
        db.query(KeywordCluster).filter(KeywordCluster.projectId == project_id).delete()
        
        for c in clusters:
            new_cluster = KeywordCluster(
                projectId=project_id,
                cluster_name=c['cluster_name'],
                description=c['description'],
                keywords=json.dumps(c['keywords']),
                priority=c['priority']
            )
            db.add(new_cluster)
        db.commit()
        return {"success": True, "clusters": clusters}
    finally:
        db.close()

if __name__ == "__main__":
    # Example usage when running as a script
    init_db()
    print("SEO Intelligence Utility Script Ready")
