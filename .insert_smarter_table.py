"""Replace the 7 SMARTER bullet paragraphs with a single 8-column table."""
import re
from copy import deepcopy
from docx import Document
from docx.shared import Pt, Cm
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.oxml.ns import qn
from docx.oxml import OxmlElement

SRC = r"C:\Users\USER\Desktop\PFE\rapport pfe.docx"

# (Title, [Specifique, Mesurable, Atteignable, Realiste, Temporel, Evaluable, Reajustable])
OBJECTIVES = [
    ("Centralisation des donnees SEO", [
        "Une table PostgreSQL dediee par type de donnee",
        "Nombre de mots-cles et de lignes GSC ingeres par jour",
        "n8n et PostgreSQL sont des outils matures",
        "Volumes typiques d'une agence comme WAOO Digital",
        "Livre des la phase d'ingestion en debut de projet",
        "Taux de coherence des jointures entre tables",
        "Ajout de nouvelles sources de donnees sans refonte du modele",
    ]),
    ("Qualification automatique des mots-cles", [
        "Dimensions intention, marque, stabilite, type de traine",
        "Taux d'enrichissement de la table nlp_keyword_enrichment",
        "Pipeline regles + Z.AI eprouve",
        "Couverture progressive selon les besoins",
        "Integre au pipeline quotidien",
        "Correspondance avec un echantillon verifie manuellement par l'analyste",
        "Ajout de nouvelles dimensions de classification possible",
    ]),
    ("Calcul des indicateurs decisionnels", [
        "Sept KPIs formalises",
        "Valeur numerique par mot-cle et par date",
        "Formules issues d'un referentiel public",
        "Calculs deterministes a partir des donnees ingerees",
        "Recalcul a chaque ingestion",
        "Comparaison avec calcul manuel sur un echantillon de controle",
        "Seuils et coefficients configurables",
    ]),
    ("Identification des opportunites SEO", [
        "Tri par opportunity_score decroissant",
        "Gain de clics potentiel chiffre pour chaque opportunite",
        "Page Opportunites fonctionnelle",
        "Basee sur des donnees reelles GSC",
        "Rafraichie a chaque collecte",
        "Correspondance avec les recommandations de l'analyste",
        "Filtres par intention, marque, periode",
    ]),
    ("Suivi des mots-cles travailles", [
        "Indicateur is_tracked et baseline d'optimisation par mot-cle",
        "Evolution de la position et du CTR",
        "Table keywords etendue",
        "Volumes maitrises",
        "Suivi quotidien",
        "Variation positive observee par rapport a la baseline",
        "Date de debut d'optimisation modifiable a tout moment",
    ]),
    ("Visualisation via tableaux de bord", [
        "Page Tableau de bord",
        "KPIs lisibles en un coup d'oeil",
        "Recharts et React",
        "Composants graphiques eprouves",
        "Mise a jour quasi temps reel apres ingestion",
        "Lisibilite validee aupres de l'analyste",
        "Filtres par projet et par periode",
    ]),
    ("Assistance a la decision", [
        "Assistant conversationnel saisonnier",
        "Nombre d'opportunites identifiees par session",
        "Integration Z.AI en streaming SSE",
        "Latence maitrisee par le streaming progressif",
        "Disponible dans la page Calendrier",
        "Qualite percue par l'utilisateur",
        "Contexte projet activable, prompts personnalisables, chips dynamiques",
    ]),
]

# Replace plain-ASCII placeholders with proper accented French for output
ACCENT_MAP = {
    "Centralisation des donnees SEO": "Centralisation des donnees SEO".replace("donnees", "donnees"),
}

# We will write the table using accented strings directly:
OBJECTIVES_FR = [
    ("Centralisation des données SEO", [
        "Une table PostgreSQL dédiée par type de donnée",
        "Nombre de mots-clés et de lignes GSC ingérés par jour",
        "n8n et PostgreSQL sont des outils matures",
        "Volumes typiques d'une agence comme WAOO Digital",
        "Livré dès la phase d'ingestion en début de projet",
        "Taux de cohérence des jointures entre tables",
        "Ajout de nouvelles sources de données sans refonte du modèle",
    ]),
    ("Qualification automatique des mots-clés", [
        "Dimensions intention, marque, stabilité, type de traîne",
        "Taux d'enrichissement de la table nlp_keyword_enrichment",
        "Pipeline règles + Z.AI éprouvé",
        "Couverture progressive selon les besoins",
        "Intégré au pipeline quotidien",
        "Correspondance avec un échantillon vérifié manuellement par l'analyste",
        "Ajout de nouvelles dimensions de classification possible",
    ]),
    ("Calcul des indicateurs décisionnels", [
        "Sept KPIs formalisés",
        "Valeur numérique par mot-clé et par date",
        "Formules issues d'un référentiel public",
        "Calculs déterministes à partir des données ingérées",
        "Recalcul à chaque ingestion",
        "Comparaison avec calcul manuel sur un échantillon de contrôle",
        "Seuils et coefficients configurables",
    ]),
    ("Identification des opportunités SEO", [
        "Tri par opportunity_score décroissant",
        "Gain de clics potentiel chiffré pour chaque opportunité",
        "Page Opportunités fonctionnelle",
        "Basée sur des données réelles GSC",
        "Rafraîchie à chaque collecte",
        "Correspondance avec les recommandations de l'analyste",
        "Filtres par intention, marque, période",
    ]),
    ("Suivi des mots-clés travaillés", [
        "Indicateur is_tracked et baseline d'optimisation par mot-clé",
        "Évolution de la position et du CTR",
        "Table keywords étendue",
        "Volumes maîtrisés",
        "Suivi quotidien",
        "Variation positive observée par rapport à la baseline",
        "Date de début d'optimisation modifiable à tout moment",
    ]),
    ("Visualisation via tableaux de bord", [
        "Page Tableau de bord",
        "KPIs lisibles en un coup d'œil",
        "Recharts et React",
        "Composants graphiques éprouvés",
        "Mise à jour quasi temps réel après ingestion",
        "Lisibilité validée auprès de l'analyste",
        "Filtres par projet et par période",
    ]),
    ("Assistance à la décision", [
        "Assistant conversationnel saisonnier",
        "Nombre d'opportunités identifiées par session",
        "Intégration Z.AI en streaming SSE",
        "Latence maîtrisée par le streaming progressif",
        "Disponible dans la page Calendrier",
        "Qualité perçue par l'utilisateur",
        "Contexte projet activable, prompts personnalisables, chips dynamiques",
    ]),
]

HEADERS = ["Objectif", "Spécifique", "Mesurable", "Atteignable",
           "Réaliste", "Temporel", "Évaluable", "Réajustable"]


def set_cell_border(cell):
    tcPr = cell._tc.get_or_add_tcPr()
    tcBorders = OxmlElement('w:tcBorders')
    for edge in ('top', 'left', 'bottom', 'right'):
        b = OxmlElement(f'w:{edge}')
        b.set(qn('w:val'), 'single')
        b.set(qn('w:sz'), '4')
        b.set(qn('w:color'), '000000')
        tcBorders.append(b)
    tcPr.append(tcBorders)


def shade_cell(cell, fill="D9E1F2"):
    tcPr = cell._tc.get_or_add_tcPr()
    shd = OxmlElement('w:shd')
    shd.set(qn('w:val'), 'clear')
    shd.set(qn('w:color'), 'auto')
    shd.set(qn('w:fill'), fill)
    tcPr.append(shd)


doc = Document(SRC)

# Find the SMARTER section paragraphs (213..219 based on earlier inspection).
# We re-find by content to be robust.
paragraphs = list(doc.paragraphs)
start_idx = None
end_idx = None
for i, p in enumerate(paragraphs):
    txt = p.text.strip()
    if start_idx is None and txt.startswith("Centralisation des donn") and "SEO" in txt and "Spécifique" in txt:
        start_idx = i
    if txt.startswith("Assistance") and "décision" in txt and "Spécifique" in txt:
        end_idx = i

if start_idx is None or end_idx is None:
    raise SystemExit(f"Could not locate SMARTER bullets (start={start_idx}, end={end_idx})")

print(f"Found SMARTER bullets paragraphs {start_idx}..{end_idx}")

target_paragraphs = paragraphs[start_idx:end_idx + 1]
anchor = target_paragraphs[0]  # we'll insert the table just before this paragraph

from docx.shared import RGBColor

# Build the table
table = doc.add_table(rows=1 + len(OBJECTIVES_FR), cols=len(HEADERS))
table.alignment = WD_TABLE_ALIGNMENT.CENTER
table.autofit = True

# Header
hdr_cells = table.rows[0].cells
for i, h in enumerate(HEADERS):
    hdr_cells[i].text = ""
    p = hdr_cells[i].paragraphs[0]
    r = p.add_run(h)
    r.bold = True
    r.font.size = Pt(9)
    r.font.color.rgb = RGBColor(0xFF, 0xFF, 0xFF)
    shade_cell(hdr_cells[i], "4472C4")
    set_cell_border(hdr_cells[i])

# Rows
for ri, (title, crits) in enumerate(OBJECTIVES_FR, start=1):
    cells = table.rows[ri].cells
    cells[0].text = ""
    p0 = cells[0].paragraphs[0]
    r0 = p0.add_run(title)
    r0.bold = True
    r0.font.size = Pt(9)
    shade_cell(cells[0], "D9E1F2")
    set_cell_border(cells[0])
    for ci, val in enumerate(crits, start=1):
        cells[ci].text = ""
        pp = cells[ci].paragraphs[0]
        rr = pp.add_run(val)
        rr.font.size = Pt(9)
        if ri % 2 == 0:
            shade_cell(cells[ci], "F2F2F2")
        set_cell_border(cells[ci])

# Move the freshly-appended table to BEFORE the first target paragraph
table_el = table._element
table_el.getparent().remove(table_el)
anchor._element.addprevious(table_el)

# Now delete the 7 bullet paragraphs
for p in target_paragraphs:
    p._element.getparent().remove(p._element)

doc.save(SRC)
print("Saved.")
