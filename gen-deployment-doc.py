"""
Generate a Word document with the deployment specs to send to PlanetHoster.
Run: python gen-deployment-doc.py
Output: Fiche_Technique_Deploiement_PlanetHoster.docx
"""

from docx import Document
from docx.shared import Pt, RGBColor, Cm, Inches
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_ALIGN_VERTICAL
from docx.oxml.ns import qn
from docx.oxml import OxmlElement

doc = Document()

# ── Page setup ──────────────────────────────────────────────────────────────
for section in doc.sections:
    section.top_margin = Cm(2)
    section.bottom_margin = Cm(2)
    section.left_margin = Cm(2.2)
    section.right_margin = Cm(2.2)

# ── Default style ───────────────────────────────────────────────────────────
style = doc.styles["Normal"]
style.font.name = "Calibri"
style.font.size = Pt(11)


def add_title(text, level=1):
    h = doc.add_heading(text, level=level)
    for run in h.runs:
        run.font.color.rgb = RGBColor(0x1D, 0x4E, 0xD8)  # indigo
    return h


def add_para(text, bold=False, italic=False, size=11):
    p = doc.add_paragraph()
    run = p.add_run(text)
    run.font.size = Pt(size)
    run.bold = bold
    run.italic = italic
    return p


def add_bullet(text):
    p = doc.add_paragraph(text, style="List Bullet")
    return p


def add_code(text):
    p = doc.add_paragraph()
    run = p.add_run(text)
    run.font.name = "Consolas"
    run.font.size = Pt(9.5)
    p.paragraph_format.left_indent = Cm(0.5)
    # Light grey shading
    pPr = p._p.get_or_add_pPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:color"), "auto")
    shd.set(qn("w:fill"), "F1F5F9")
    pPr.append(shd)
    return p


def add_table(headers, rows, col_widths=None):
    table = doc.add_table(rows=1, cols=len(headers))
    table.style = "Light Grid Accent 1"
    hdr = table.rows[0].cells
    for i, h in enumerate(headers):
        hdr[i].text = h
        for para in hdr[i].paragraphs:
            for run in para.runs:
                run.bold = True
                run.font.size = Pt(10.5)
    for row_data in rows:
        row = table.add_row().cells
        for i, val in enumerate(row_data):
            row[i].text = val
            for para in row[i].paragraphs:
                for run in para.runs:
                    run.font.size = Pt(10.5)
    if col_widths:
        for row in table.rows:
            for i, w in enumerate(col_widths):
                row.cells[i].width = w
    return table


# ─────────────────────────────────────────────────────────────────────────────
#  COVER
# ─────────────────────────────────────────────────────────────────────────────
title = doc.add_paragraph()
title.alignment = WD_ALIGN_PARAGRAPH.CENTER
run = title.add_run("Fiche Technique de Déploiement")
run.bold = True
run.font.size = Pt(22)
run.font.color.rgb = RGBColor(0x1D, 0x4E, 0xD8)

subtitle = doc.add_paragraph()
subtitle.alignment = WD_ALIGN_PARAGRAPH.CENTER
run = subtitle.add_run("Application SEO BI — Projet de Fin d'Études")
run.font.size = Pt(14)
run.font.color.rgb = RGBColor(0x64, 0x74, 0x8B)

meta = doc.add_paragraph()
meta.alignment = WD_ALIGN_PARAGRAPH.CENTER
run = meta.add_run("Document destiné à PlanetHoster pour validation de la compatibilité de l'offre d'hébergement")
run.italic = True
run.font.size = Pt(11)
run.font.color.rgb = RGBColor(0x94, 0xA3, 0xB8)

doc.add_paragraph()

# ─────────────────────────────────────────────────────────────────────────────
#  1. RÉSUMÉ
# ─────────────────────────────────────────────────────────────────────────────
add_title("1. Résumé de l'application", level=1)
add_para(
    "Application web SaaS d'intelligence business SEO. Architecture monolithique : "
    "une Single Page Application (SPA) React + une API REST Node.js / Express, "
    "servies par un seul processus. En développement, Express embarque Vite en "
    "middleware ; en production, Express sert les fichiers statiques générés par "
    "Vite (dossier dist/). La base de données est PostgreSQL, et l'application "
    "appelle plusieurs services externes (LLM, automatisation de workflows, SMTP)."
)

# ─────────────────────────────────────────────────────────────────────────────
#  2. STACK TECHNIQUE
# ─────────────────────────────────────────────────────────────────────────────
add_title("2. Stack technique", level=1)

add_title("2.1 Runtime serveur", level=2)
add_bullet("Node.js  ≥ 20.x (testé sur 22.x)")
add_bullet("Express  4.21")
add_bullet("TypeScript exécuté à la volée via tsx (pas de build backend nécessaire)")

add_title("2.2 Frontend", level=2)
add_bullet("React 19")
add_bullet("Vite 6 (build → dossier dist/)")
add_bullet("Tailwind CSS v4")
add_bullet("React Router 7")
add_bullet("Recharts (graphiques)")

add_title("2.3 Base de données", level=2)
add_bullet("PostgreSQL ≥ 14")
add_bullet("Extension requise : unaccent (utilisée pour les index "
           "insensibles aux accents sur les tables gsc_daily, serp_daily, scores_daily, etc.)")
add_bullet("SSL requis en production")
add_bullet("Actuellement hébergée sur Neon (Postgres managé) — l'application "
           "peut pointer vers n'importe quel Postgres compatible via la variable DATABASE_URL")

add_title("2.4 Stockage de fichiers", level=2)
add_bullet("Avatars utilisateurs stockés en local dans public/uploads/")
add_bullet("Nécessite un disque persistant accessible en lecture/écriture par "
           "le processus Node (volumétrie estimée : quelques Mo)")

add_title("2.5 Ports", level=2)
add_bullet("Un seul port HTTP en interne : 3000 (configurable via variable d'env)")
add_bullet("Le reverse proxy de l'hébergeur doit forwarder HTTPS (443) → 3000")

# ─────────────────────────────────────────────────────────────────────────────
#  3. VARIABLES D'ENVIRONNEMENT
# ─────────────────────────────────────────────────────────────────────────────
add_title("3. Variables d'environnement requises (.env)", level=1)
env_rows = [
    ("DATABASE_URL", "Chaîne de connexion PostgreSQL (avec SSL)"),
    ("JWT_SECRET", "Secret pour la signature des tokens JWT"),
    ("ZHIPU_API_KEY", "Clé API Z.AI (modèle LLM glm-5.1)"),
    ("API_KEY_N8N", "Clé partagée entre l'app et les workflows n8n"),
    ("N8N_RESET_WEBHOOK_URL", "Webhook n8n — reset des opportunités"),
    ("N8N_REFRESH_GSC_WEBHOOK_URL", "Webhook n8n — refresh GSC ciblé"),
    ("APP_URL", "URL publique de l'application (utilisée dans les liens email)"),
    ("SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM", "Configuration SMTP pour l'envoi d'emails (reset password)"),
    ("BOOTSTRAP_ADMIN_EMAIL", "Email du premier compte administrateur"),
    ("SWAGGER_ENABLED, SWAGGER_TITLE, …", "Configuration de la documentation API Swagger"),
]
add_table(
    ["Variable", "Description"],
    env_rows,
    col_widths=[Cm(7), Cm(10)],
)

# ─────────────────────────────────────────────────────────────────────────────
#  4. RÉSEAU
# ─────────────────────────────────────────────────────────────────────────────
add_title("4. Connexions réseau", level=1)

add_title("4.1 Connexions sortantes nécessaires", level=2)
add_para(
    "Le serveur doit pouvoir établir des connexions HTTPS sortantes vers les "
    "domaines suivants — vérifier qu'aucun pare-feu de l'hébergeur ne les bloque :"
)
net_rows = [
    ("api.z.ai", "443", "Appels au LLM Z.AI (interprétations IA, classification NLP)"),
    ("*.neon.tech", "5432", "Base de données PostgreSQL (si conservée sur Neon)"),
    ("n8n.srv770401.hstgr.cloud", "443", "Déclenchement des workflows n8n"),
    ("smtp.gmail.com", "587", "Envoi des emails de reset de mot de passe"),
]
add_table(
    ["Domaine", "Port", "Usage"],
    net_rows,
    col_widths=[Cm(5.5), Cm(2), Cm(9.5)],
)

add_title("4.2 Connexions entrantes", level=2)
add_bullet("HTTPS port 443 (reverse proxy → Node port 3000)")
add_bullet("Webhooks entrants depuis n8n vers /api/ingest/* (authentification par header x-api-key)")

# ─────────────────────────────────────────────────────────────────────────────
#  5. COMMANDES
# ─────────────────────────────────────────────────────────────────────────────
add_title("5. Commandes de build et de lancement", level=1)

add_para("Installation des dépendances :", bold=True)
add_code("npm install")

add_para("Build de production (génère le dossier dist/) :", bold=True)
add_code("npm run build")

add_para("Lancement de l'application en production :", bold=True)
add_code("npm start    # équivalent à : tsx server.ts")

add_para(
    "Aucun build backend n'est requis : TypeScript est exécuté à la volée par tsx. "
    "Aucune image Docker n'est nécessaire — l'application tourne directement avec Node."
)

# ─────────────────────────────────────────────────────────────────────────────
#  6. RESSOURCES
# ─────────────────────────────────────────────────────────────────────────────
add_title("6. Ressources système estimées", level=1)
res_rows = [
    ("RAM", "256–512 Mo (Node + Vite middleware)"),
    ("CPU", "1 vCPU suffisant pour la phase PFE"),
    ("Disque", "~ 500 Mo (node_modules + dist + uploads)"),
    ("Bande passante", "Faible — usage interne pendant la soutenance"),
]
add_table(
    ["Ressource", "Estimation"],
    res_rows,
    col_widths=[Cm(4.5), Cm(12.5)],
)

# ─────────────────────────────────────────────────────────────────────────────
#  7. PARTICULARITÉS
# ─────────────────────────────────────────────────────────────────────────────
add_title("7. Particularités techniques à signaler", level=1)
add_bullet("Aucun service systemd ou cron côté app — les cron de collecte vivent "
           "sur l'instance n8n externe.")
add_bullet("L'application initialise et migre son schéma SQL automatiquement au "
           "démarrage (fonction initDb() idempotente — peut être relancée sans risque).")
add_bullet("Aucune dépendance native compilée — uniquement du JavaScript / TypeScript "
           "pur, donc pas de problème de toolchain C++ côté hébergeur.")
add_bullet("Pas de WebSocket en production (Vite-only en dev).")

# ─────────────────────────────────────────────────────────────────────────────
#  8. QUESTIONS À POSER À PLANETHOSTER
# ─────────────────────────────────────────────────────────────────────────────
add_title("8. Questions précises à poser à PlanetHoster", level=1)

q_rows = [
    ("Node.js", "Quelles versions sont supportées sur l'offre proposée ? La version 20 minimum est requise (idéalement 22)."),
    ("PostgreSQL", "Est-ce inclus dans l'offre ? Quelle version ? L'extension unaccent est-elle installée et activable ?"),
    ("Persistance du disque", "Le disque est-il persistant entre redémarrages ? Nécessaire pour le dossier public/uploads/ (avatars utilisateurs)."),
    ("Connexions sortantes", "Le serveur peut-il appeler des APIs HTTPS externes (api.z.ai, smtp.gmail.com, webhooks n8n) sans blocage par pare-feu ?"),
    ("Reverse proxy / HTTPS", "Fournissez-vous un reverse proxy avec certificat SSL automatique (Let's Encrypt) redirigeant vers le port Node interne ?"),
    ("Variables d'environnement", "Comment configure-t-on les variables .env côté plateforme ? (Panel admin, fichier .env, variables système…)"),
]
add_table(
    ["Domaine", "Question"],
    q_rows,
    col_widths=[Cm(4.5), Cm(12.5)],
)

# ─────────────────────────────────────────────────────────────────────────────
#  9. RECOMMANDATION D'OFFRE
# ─────────────────────────────────────────────────────────────────────────────
add_title("9. Offres PlanetHoster — analyse de compatibilité", level=1)

offer_rows = [
    ("Mutualisé (entrée de gamme)", "Souvent pas de support Node.js", "Non recommandé"),
    ("N0C (plateforme phare)", "Support Node.js natif via Application Manager, PostgreSQL disponible en option", "Recommandé"),
    ("VPS / Cloud Hybrid", "Contrôle total du serveur, plus de configuration à faire", "Compatible — flexible"),
    ("Performance Cloud", "Environnement managé premium, tout inclus", "Compatible — premium"),
]
add_table(
    ["Offre", "Compatibilité Node + PostgreSQL", "Recommandation"],
    offer_rows,
    col_widths=[Cm(4.5), Cm(8), Cm(4.5)],
)

add_para(
    "Recommandation : opter pour une instance N0C avec support Node.js 22 + "
    "accès PostgreSQL. Si PostgreSQL n'est pas pratique côté PlanetHoster, la "
    "base de données peut rester sur Neon (gratuit, déjà configuré) — il suffit "
    "de pointer la variable DATABASE_URL vers Neon depuis le serveur PlanetHoster.",
    italic=True,
)

# ─────────────────────────────────────────────────────────────────────────────
#  10. ANNEXE — DÉPENDANCES NPM PRINCIPALES
# ─────────────────────────────────────────────────────────────────────────────
add_title("10. Annexe — Dépendances NPM principales", level=1)
deps_rows = [
    ("express", "^4.21.2", "Framework web backend"),
    ("react", "^19.0.0", "Framework UI"),
    ("vite", "^6.2.0", "Build tool frontend"),
    ("pg", "^8.19.0", "Driver PostgreSQL"),
    ("jsonwebtoken", "^9.0.3", "Authentification JWT"),
    ("bcryptjs", "^3.0.3", "Hashage des mots de passe"),
    ("openai", "^6.37.0", "SDK OpenAI-compat. (pointé vers Z.AI)"),
    ("nodemailer", "^8.0.7", "Envoi emails SMTP"),
    ("tailwindcss", "^4.1.14", "CSS utilitaire"),
    ("tsx", "^4.21.0", "Exécution TypeScript runtime"),
    ("zod", "^4.4.3", "Validation de schémas"),
    ("swagger-jsdoc + swagger-ui-express", "—", "Documentation API"),
]
add_table(
    ["Package", "Version", "Rôle"],
    deps_rows,
    col_widths=[Cm(6.5), Cm(3), Cm(7.5)],
)

# ─────────────────────────────────────────────────────────────────────────────
#  Save
# ─────────────────────────────────────────────────────────────────────────────
output = "Fiche_Technique_Deploiement_PlanetHoster.docx"
doc.save(output)
print(f"OK - Document genere : {output}")
