import { useState, useEffect, useMemo } from "react";
import {
  Zap,
  Filter,
  Search,
  Info,
  Briefcase,
  ChevronDown,
  Sparkles,
  Loader2,
  X,
  ShieldCheck,
  AlertCircle,
  Activity,
  BarChart,
  Eye,
  EyeOff,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { qualifyKeywords } from "../services/aiService";
import { useSelectedProject } from "../hooks/useSelectedProject";

// ─── Types ────────────────────────────────────────────────────────────────────

type Project = {
  id: number;
  name: string;
};

type OpportunityRow = {
  id: number;
  projectId: number;
  keyword: string;
  position: number;
  trend: number;
  impressions: number;
  ctr: number;
  competition_score: number;
  opportunity_score: number;
  ctr_gap: number;
  performance_drift: number;
  long_tail_indicator: number;
  branded_status?: string;
  stability_status?: string;
  tail_type?: string;
  search_intent?: string;
  exclude_from_opportunity?: boolean;
  qualification_label?: string;
  priority_level?: string;
  action_hint?: string;
  reasoning?: string;
  // SERP signals from serp_daily v2
  has_ai_overview?: boolean;
  your_in_aio?: boolean;
  is_tracked?: boolean;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const getPriorityLabel = (score: number) => {
  if (score >= 200) return { text: "Haute",  cls: "bg-emerald-100 text-emerald-700" };
  if (score >= 50)  return { text: "Moy.",   cls: "bg-amber-100 text-amber-700" };
  return               { text: "Faible", cls: "bg-slate-100 text-slate-500" };
};

const getScoreColor = (score: number) => {
  if (score >= 200) return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (score >= 50)  return "bg-amber-50 text-amber-700 border-amber-200";
  return "bg-slate-50 text-slate-600 border-slate-200";
};

const getPositionColor = (pos: number) => {
  if (pos <= 3)  return "bg-emerald-100 text-emerald-700";
  if (pos <= 10) return "bg-amber-100 text-amber-700";
  return "bg-red-100 text-red-700";
};

const formatImpressions = (n: number) => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}k`;
  return String(Math.round(n));
};

const isBrandedKeyword = (branded_status?: string): boolean =>
  (branded_status ?? "").toLowerCase().trim() === "branded";

const INTENT_STYLES: Record<string, { label: string; cls: string }> = {
  transactionnelle: { label: "Transac.", cls: "bg-emerald-100 text-emerald-700" },
  navigationnelle:  { label: "Nav.",    cls: "bg-amber-100 text-amber-700"   },
  informationnelle: { label: "Info.",   cls: "bg-blue-100 text-blue-700"     },
};

const getIntentStyle = (intent?: string) =>
  INTENT_STYLES[intent?.toLowerCase() ?? ""] ?? { label: "N/A", cls: "bg-slate-100 text-slate-400" };

// Traductions FR pour les énumérations renvoyées par le backend (qualification).
const PRIORITY_FR: Record<string, string> = {
  high: "Haute",
  medium: "Moyenne",
  low: "Faible",
};
const BRANDED_FR: Record<string, string> = {
  branded: "Marque",
  non_branded: "Hors marque",
  "non-branded": "Hors marque",
};
const STABILITY_FR: Record<string, string> = {
  stable: "Stable",
  opportunity: "Opportunité",
};
const TAIL_FR: Record<string, string> = {
  long_tail: "Longue traîne",
  generic: "Générique",
};
const INTENT_FR: Record<string, string> = {
  transactionnelle: "Transactionnelle",
  navigationnelle: "Navigationnelle",
  informationnelle: "Informationnelle",
};
const KPI_KEY_FR: Record<string, string> = {
  search_intent: "Intention",
  branded: "Marque",
  tail: "Traîne",
  intent: "Intention",
};
const trFR = (map: Record<string, string>, v?: string) =>
  v ? map[v.toLowerCase().trim()] ?? v.replace(/_/g, " ") : "";

// Traduit les chaînes d'interprétation KPI produites par le backend
// (ex: "Intent: informationnelle (LLM)", "Branded: branded", "Type: generic (3 mots)").
const translateKpiValue = (raw: string): string => {
  if (!raw) return raw;
  let s = raw;
  s = s.replace(/^Intent:\s*/i, "Intention : ");
  s = s.replace(/^Branded:\s*/i, "Marque : ");
  s = s.replace(/^Type:\s*/i, "Type : ");
  s = s.replace(/\bbranded\b/gi, "marque");
  s = s.replace(/\bnon[_-]branded\b/gi, "hors marque");
  s = s.replace(/\blong_tail\b/gi, "longue traîne");
  s = s.replace(/\bgeneric\b/gi, "générique");
  s = s.replace(/\(rules\)/gi, "(règles)");
  s = s.replace(/\(LLM\)/g, "(IA)");
  s = s.replace(/\(cache\)/gi, "(cache)");
  return s;
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function Opportunities() {
  const [data, setData] = useState<OpportunityRow[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useSelectedProject();
  const [loading, setLoading] = useState(true);

  // FIX: Separate state for each async action to avoid conflating UI states.
  // The original code used a single `resetting` flag for both filter reset
  // and the n8n trigger, which caused the button to stay disabled even when
  // only the filters needed clearing.
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetSuccess, setResetSuccess] = useState(false);

  // Date range filter — sent to the n8n GSC node via /api/opportunities/reset.
  // Spec body shape: { dateRange, startDate?, endDate?, rowLimit }
  // rowLimit pilote le GSC.Row Limit côté n8n pour élargir la couverture.
  type DateRange = "last7Days" | "last28Days" | "last3Months" | "last12Months" | "custom";
  const ROW_LIMIT_OPTIONS = [100, 250, 500, 1000, 2000, 5000] as const;
  type RowLimit = typeof ROW_LIMIT_OPTIONS[number];
  const todayISO = new Date().toISOString().slice(0, 10);
  const [dateRange, setDateRange] = useState<DateRange>("last3Months");
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate]     = useState<string>("");
  // Persisté pour ne pas re-saisir à chaque rechargement.
  const [rowLimit, setRowLimit] = useState<RowLimit>(() => {
    const saved = Number(localStorage.getItem("opp_row_limit"));
    return (ROW_LIMIT_OPTIONS as readonly number[]).includes(saved)
      ? (saved as RowLimit)
      : 1000;
  });

  // FIX: trackingId tracks which keyword row is loading, not a global flag.
  const [trackingId, setTrackingId] = useState<number | null>(null);
  const [trackError, setTrackError] = useState<string | null>(null);
  // Suppression définitive d'un mot-clé (cf. DELETE /api/keywords/:id).
  // Pas de blacklist : ré-ingestion possible si la donnée revient.
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [deleteToast, setDeleteToast] = useState<string | null>(null);

  // Filter state
  const [search, setSearch] = useState("");
  const [intentFilter, setIntentFilter] = useState("");
  const [excludeBranded, setExcludeBranded] = useState(false);

  // Modal / qualification state
  const [selectedKeyword, setSelectedKeyword] = useState<OpportunityRow | null>(null);
  const [qualificationResult, setQualificationResult] = useState<any | null>(null);
  const [isQualifying, setIsQualifying] = useState(false);

  // ─── Data fetching ──────────────────────────────────────────────────────────

  useEffect(() => {
    fetchProjects();
  }, []);

  useEffect(() => {
    fetchData();
  }, [selectedProjectId]);

  const fetchProjects = async () => {
    try {
      const res = await fetch("/api/projects", {
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setProjects(Array.isArray(json) ? json : []);
    } catch (error) {
      console.error("fetchProjects error:", error);
      setProjects([]);
    }
  };

  const fetchData = async () => {
    setLoading(true);
    try {
      const url = selectedProjectId
        ? `/api/opportunities?projectId=${selectedProjectId}`
        : "/api/opportunities";

      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(Array.isArray(json) ? json : []);
    } catch (error) {
      console.error("fetchData error:", error);
      setData([]);
    } finally {
      setLoading(false);
    }
  };

  // ─── Qualification ──────────────────────────────────────────────────────────

  const handleQualify = async (keyword: OpportunityRow) => {
    setSelectedKeyword(keyword);
    setIsQualifying(true);
    setQualificationResult(null);

    const date = new Date().toISOString().split("T")[0];

    const input = {
      keyword: keyword.keyword,
      position: keyword.position || 0,
      ctr: keyword.ctr || 0,
      impressions: keyword.impressions || 0,
      competition_score: keyword.competition_score || 0,
      opportunity_score: keyword.opportunity_score || 0,
      ctr_gap: keyword.ctr_gap || 0,
      performance_drift: keyword.performance_drift || 0,
      long_tail_indicator:
        keyword.long_tail_indicator ||
        (keyword.keyword.trim().split(/\s+/).length > 3 ? 1 : 0),
    };

    try {
      const result = await qualifyKeywords(keyword.projectId, [input], date);
      if (result?.results?.length > 0) {
        setQualificationResult(result.results[0]);
      }
    } catch (error) {
      console.error("Qualification error:", error);
    } finally {
      setIsQualifying(false);
    }
  };

  // ─── Track / Untrack ────────────────────────────────────────────────────────
  //
  // FIX: These functions previously called /api/keywords/:id/track and
  // /api/keywords/:id/untrack which didn't exist in the backend → 404 on every
  // click. The routes have now been added to server.ts. The is_tracked column
  // has also been added to the keywords table via an ALTER TABLE migration.

  const handleTrack = async (keywordId: number) => {
    setTrackingId(keywordId);
    setTrackError(null);
    try {
      const res = await fetch(`/api/keywords/${keywordId}/track`, {
        method: "POST",
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      // Optimistic update — no need to refetch the entire list
      setData((prev) =>
        prev.map((item) =>
          item.id === keywordId ? { ...item, is_tracked: true } : item
        )
      );
    } catch (error: any) {
      console.error("Track error:", error);
      setTrackError(error.message || "Erreur lors de l'ajout au suivi.");
      // Auto-clear error after 4s
      setTimeout(() => setTrackError(null), 4000);
    } finally {
      setTrackingId(null);
    }
  };

  const handleUntrack = async (keywordId: number) => {
    setTrackingId(keywordId);
    setTrackError(null);
    try {
      const res = await fetch(`/api/keywords/${keywordId}/untrack`, {
        method: "POST",
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      setData((prev) =>
        prev.map((item) =>
          item.id === keywordId ? { ...item, is_tracked: false } : item
        )
      );
    } catch (error: any) {
      console.error("Untrack error:", error);
      setTrackError(error.message || "Erreur lors de la suppression du suivi.");
      setTimeout(() => setTrackError(null), 4000);
    } finally {
      setTrackingId(null);
    }
  };

  // ─── Suppression définitive (sans blacklist) ─────────────────────────────
  // Cf. DELETE /api/keywords/:id : supprime keywords + toutes les facts liées.
  // Si la donnée revient via une future collecte n8n/GSC, elle réapparaît.
  // Confirmation renforcée si le mot-clé est actuellement suivi (perte
  // d'historique).
  const handleDelete = async (k: OpportunityRow) => {
    const confirmMsg = k.is_tracked
      ? `« ${k.keyword} » est actuellement suivi. Sa suppression supprimera aussi son historique de suivi. Continuer ?`
      : `Ce mot-clé sera supprimé définitivement de la base actuelle. Il pourra réapparaître lors d'une future collecte si les données SEO le ramènent. Continuer ?`;
    if (!window.confirm(confirmMsg)) return;

    setDeletingId(k.id);
    setTrackError(null);
    try {
      const res = await fetch(`/api/keywords/${k.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      // Retrait immédiat de la ligne pour ne pas attendre un refetch.
      setData((prev) => prev.filter((item) => item.id !== k.id));
      setDeleteToast("Mot-clé supprimé. Il pourra réapparaître lors d'une prochaine collecte.");
      setTimeout(() => setDeleteToast(null), 4000);
    } catch (error: any) {
      console.error("Delete keyword error:", error);
      setTrackError(error.message || "Erreur lors de la suppression du mot-clé.");
      setTimeout(() => setTrackError(null), 4000);
    } finally {
      setDeletingId(null);
    }
  };

  // ─── Reset filters (local only) ─────────────────────────────────────────────
  //
  // FIX: The original resetFilters() was doing TWO things at once:
  //   1. Resetting the filter UI state (instant, no network needed)
  //   2. Triggering the n8n workflow (async, can fail)
  // This was wrong: a filter reset should never block on a network call.
  // These are now split into two separate actions.

  const clearFilters = () => {
    setSearch("");
    setIntentFilter("");
    setExcludeBranded(false);
  };

  // ─── Trigger n8n workflow ───────────────────────────────────────────────────
  //
  // FIX: Separated from filter reset. Now calls /api/opportunities/reset which
  // was missing from the backend and has been added to server.ts.
  // Displays a proper inline error instead of an alert() popup.

  // Custom-date validity (used both to gate "Appliquer" and as a final guard)
  const customDatesValid =
    !!startDate &&
    !!endDate &&
    startDate <= endDate &&
    endDate <= todayISO;

  const handleTriggerWorkflow = async (
    rangeOverride?: DateRange,
    rowLimitOverride?: RowLimit,
  ) => {
    const effectiveRange = rangeOverride ?? dateRange;
    const effectiveRowLimit = rowLimitOverride ?? rowLimit;
    setResetError(null);
    setResetSuccess(false);

    if (!selectedProjectId) {
      setResetError("Sélectionnez un projet avant de relancer la collecte.");
      setTimeout(() => setResetError(null), 5000);
      return;
    }

    if (effectiveRange === "custom" && !customDatesValid) {
      setResetError("Sélectionnez une date de début et de fin valides (fin ≥ début, fin ≤ aujourd'hui).");
      setTimeout(() => setResetError(null), 5000);
      return;
    }

    const body: Record<string, any> = {
      projectId: selectedProjectId || null,
      dateRange: effectiveRange,
      rowLimit: effectiveRowLimit,
    };
    if (effectiveRange === "custom") {
      body.startDate = startDate;
      body.endDate   = endDate;
    }

    setResetting(true);
    try {
      const res = await fetch("/api/opportunities/reset", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("token")}`,
        },
        body: JSON.stringify(body),
      });

      const json = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(json.error || `Erreur HTTP ${res.status}`);
      }

      setResetSuccess(true);
      // Reload data after a delay to let n8n process
      setTimeout(() => {
        fetchData();
        setResetSuccess(false);
      }, 3000);
    } catch (err: any) {
      setResetError(err.message || "Erreur inconnue");
      setTimeout(() => setResetError(null), 8000);
    } finally {
      setResetting(false);
    }
  };

  // ─── Derived data ───────────────────────────────────────────────────────────

  const filteredData = useMemo(() => {
    return data.filter((k) => {
      const matchesSearch = String(k.keyword || "")
        .toLowerCase()
        .includes(search.trim().toLowerCase());

      const matchesIntent =
        intentFilter === "" ||
        (k.search_intent?.toLowerCase() ?? "") === intentFilter;

      const matchesBranded = !excludeBranded || !isBrandedKeyword(k.branded_status);

      return matchesSearch && matchesIntent && matchesBranded;
    });
  }, [data, search, intentFilter, excludeBranded]);

  const trackedCount = useMemo(
    () => data.filter((k) => k.is_tracked).length,
    [data]
  );

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-7xl mx-auto space-y-8">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-6 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight">
            Opportunités
          </h1>
          <p className="text-slate-500 mt-1">
            Priorisation automatique basée sur impressions, position et potentiel CTR.
          </p>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          {/* Project selector */}
          <div className="relative">
            <Briefcase className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <select
              value={selectedProjectId}
              onChange={(e) => setSelectedProjectId(e.target.value)}
              className="pl-10 pr-8 py-2 bg-white border border-slate-200 rounded-xl text-sm font-bold text-slate-700 shadow-sm hover:bg-slate-50 transition-all appearance-none outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="">Tous les projets</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <ChevronDown className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          </div>

          <div className="flex items-center gap-2 px-4 py-2 bg-indigo-50 border border-indigo-100 rounded-xl">
            <Sparkles className="w-4 h-4 text-indigo-600" />
            <span className="text-sm font-bold text-indigo-700">
              Classement basé sur le score d'opportunité
            </span>
          </div>

          {/* Tracked count badge */}
          {trackedCount > 0 && (
            <div className="px-4 py-2 bg-emerald-50 border border-emerald-100 rounded-xl text-sm font-bold text-emerald-700">
              {trackedCount} suivi{trackedCount > 1 ? "s" : ""}
            </div>
          )}

          {/* Manual refresh — uses the date-range filter set below */}
          <div className="flex flex-col items-end gap-1">
            <button
              onClick={() => handleTriggerWorkflow()}
              disabled={resetting || !selectedProjectId || (dateRange === "custom" && !customDatesValid)}
              title={
                !selectedProjectId
                  ? "Sélectionnez un projet pour relancer la collecte"
                  : "Relance le workflow n8n avec la période sélectionnée"
              }
              className="inline-flex items-center gap-2 px-4 py-2 bg-slate-800 text-white text-sm font-bold rounded-xl hover:bg-slate-900 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <RefreshCw className={`w-4 h-4 ${resetting ? "animate-spin" : ""}`} />
              {resetting ? "Relance en cours..." : "Relancer la collecte"}
            </button>
            {resetSuccess && (
              <span className="text-xs text-emerald-600 font-medium">
                ✓ Workflow déclenché — rechargement dans 3s
              </span>
            )}
            {resetError && (
              <span className="text-xs text-red-600 font-medium max-w-xs text-right leading-tight">
                {resetError}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Global track error toast */}
      {trackError && (
        <div className="bg-red-50 border border-red-200 rounded-2xl px-5 py-3 text-sm text-red-700 font-medium">
          {trackError}
        </div>
      )}

      {/* Toast de succès suppression définitive */}
      {deleteToast && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-2xl px-5 py-3 text-sm text-emerald-700 font-medium">
          {deleteToast}
        </div>
      )}

      {/* ── Summary strip ──────────────────────────────────────────────────── */}
      {!loading && filteredData.length > 0 && (() => {
        const high   = filteredData.filter((k) => Number(k.opportunity_score || 0) >= 200).length;
        const medium = filteredData.filter((k) => {
          const s = Number(k.opportunity_score || 0);
          return s >= 50 && s < 200;
        }).length;
        const totalGain = filteredData.reduce((s, k) => s + Number(k.opportunity_score || 0), 0);
        return (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: "Mots-clés analysés", value: filteredData.length, cls: "text-indigo-600 bg-indigo-50" },
              { label: "Priorité haute (≥ 200)",   value: high,   cls: "text-emerald-600 bg-emerald-50" },
              { label: "Priorité moyenne (≥ 50)",  value: medium, cls: "text-amber-600 bg-amber-50" },
              { label: "Gain potentiel total", value: `+${Math.round(totalGain)} clics`, cls: "text-blue-600 bg-blue-50" },
            ].map((s, i) => (
              <motion.div
                key={s.label}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5"
              >
                <div className={`w-9 h-9 ${s.cls.split(" ")[1]} rounded-xl flex items-center justify-center mb-3`}>
                  <Zap className={`w-4 h-4 ${s.cls.split(" ")[0]}`} />
                </div>
                <div className="text-xl font-bold text-slate-900">{s.value}</div>
                <div className="text-xs text-slate-500 font-medium mt-0.5">{s.label}</div>
              </motion.div>
            ))}
          </div>
        );
      })()}

      {/* ── Table card ─────────────────────────────────────────────────────── */}
      <div className="bg-white rounded-[2.5rem] border border-slate-100 shadow-sm overflow-hidden flex flex-col">

          {/* Filter bar */}
          <div className="p-6 border-b border-slate-50 bg-slate-50/50 space-y-4">
            {/*
              FIX: w-full anchor + shrink-0 on the button prevent it from
              escaping the card boundary on intermediate screen widths.
              The original code used bare flex-wrap with no width constraint,
              which let the button drift outside the card when the table's
              overflow-x-auto created a new stacking context.
            */}
            <div className="w-full flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-3 flex-wrap min-w-0">
                <div className="relative">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Rechercher un mot-clé..."
                    className="pl-10 pr-4 py-2 bg-white border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 w-56 outline-none"
                  />
                </div>
                <div className="flex items-center gap-2 px-4 py-2 text-slate-600 bg-white border border-slate-200 rounded-xl text-sm font-medium whitespace-nowrap">
                  <Filter className="w-4 h-4 shrink-0" />
                  Filtres
                </div>
              </div>

              {/* FIX: shrink-0 + whitespace-nowrap keep the button inside the card */}
              <button
                onClick={clearFilters}
                className="shrink-0 whitespace-nowrap text-sm font-medium text-slate-500 hover:text-slate-900 px-3 py-2 hover:bg-white rounded-xl border border-transparent hover:border-slate-200 transition-all"
              >
                Réinitialiser les filtres
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              {/* Période (date range) — sent to n8n GSC node */}
              <select
                value={dateRange}
                onChange={(e) => {
                  const next = e.target.value as DateRange;
                  setDateRange(next);
                  // Auto-trigger n8n on preset change (spec). Custom is staged only.
                  if (next !== "custom" && selectedProjectId) {
                    handleTriggerWorkflow(next);
                  }
                }}
                disabled={resetting || !selectedProjectId}
                title={
                  !selectedProjectId
                    ? "Sélectionnez un projet pour relancer la collecte"
                    : "Période envoyée au workflow n8n pour interroger GSC"
                }
                className="px-4 py-2 bg-white border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500 text-slate-700 disabled:opacity-60"
              >
                <option value="last7Days">7 derniers jours</option>
                <option value="last28Days">28 derniers jours</option>
                <option value="last3Months">3 derniers mois</option>
                <option value="last12Months">12 derniers mois</option>
                <option value="custom">Personnalisée…</option>
              </select>

              {/* Row limit — plafond du GSC node de n8n. Auto-trigger comme dateRange. */}
              <select
                value={rowLimit}
                onChange={(e) => {
                  const next = Number(e.target.value) as RowLimit;
                  setRowLimit(next);
                  localStorage.setItem("opp_row_limit", String(next));
                  // Auto-trigger n8n sauf en mode custom (qui attend "Appliquer")
                  if (dateRange !== "custom" && selectedProjectId) {
                    handleTriggerWorkflow(undefined, next);
                  }
                }}
                disabled={resetting || !selectedProjectId}
                title={
                  !selectedProjectId
                    ? "Sélectionnez un projet pour relancer la collecte"
                    : "Nombre maximum de mots-clés à récupérer depuis Google Search Console"
                }
                className="px-4 py-2 bg-white border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500 text-slate-700 disabled:opacity-60"
              >
                {ROW_LIMIT_OPTIONS.map((n) => (
                  <option key={n} value={n}>
                    {n.toLocaleString("fr-FR")} mots-clés max
                  </option>
                ))}
              </select>
              <select
                value={intentFilter}
                onChange={(e) => setIntentFilter(e.target.value)}
                className="px-4 py-2 bg-white border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500 text-slate-700"
              >
                <option value="">Toutes les intentions</option>
                <option value="informationnelle">Informationnelle</option>
                <option value="transactionnelle">Transactionnelle</option>
                <option value="navigationnelle">Navigationnelle</option>
              </select>
              <label className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-xl text-sm text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={excludeBranded}
                  onChange={(e) => setExcludeBranded(e.target.checked)}
                />
                Exclure les mots-clés de marque
              </label>
            </div>

            {/* Custom date range — visible only when dateRange === "custom" */}
            {dateRange === "custom" && (
              <div className="flex items-end gap-3 flex-wrap pt-2 border-t border-slate-100">
                <div className="flex flex-col">
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider ml-1 mb-1">Date début</label>
                  <input
                    type="date"
                    value={startDate}
                    max={endDate || todayISO}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="px-3 py-2 bg-white border border-slate-200 rounded-xl text-sm text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div className="flex flex-col">
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider ml-1 mb-1">Date fin</label>
                  <input
                    type="date"
                    value={endDate}
                    min={startDate}
                    max={todayISO}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="px-3 py-2 bg-white border border-slate-200 rounded-xl text-sm text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <button
                  onClick={() => handleTriggerWorkflow()}
                  disabled={!customDatesValid || resetting || !selectedProjectId}
                  title={!selectedProjectId ? "Sélectionnez un projet pour relancer la collecte" : undefined}
                  className="inline-flex items-center gap-2 px-5 py-2 bg-indigo-600 text-white text-sm font-bold rounded-xl hover:bg-indigo-700 shadow-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed h-[38px]"
                >
                  {resetting ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                  Appliquer
                </button>
                {!customDatesValid && (startDate || endDate) && (
                  <span className="text-xs text-amber-700 self-center">
                    Renseignez deux dates valides (fin ≥ début, fin ≤ aujourd'hui).
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="text-slate-400 text-[10px] uppercase tracking-wider font-bold border-b border-slate-100">
                  <th className="px-6 py-4">Mot-clé</th>
                  <th className="px-6 py-4">Pos.</th>
                  <th className="px-6 py-4">Impressions</th>
                  <th className="px-6 py-4">CTR</th>
                  <th className="px-6 py-4">Intention</th>
                  <th className="px-6 py-4">Marque</th>
                  <th className="px-6 py-4 text-right">Gain potentiel</th>
                  <th className="px-6 py-4 text-right">Suivi</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-slate-50">
                {loading ? (
                  <tr>
                    <td colSpan={8} className="px-6 py-10 text-center text-slate-400">
                      <div className="inline-flex items-center gap-2">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Chargement...
                      </div>
                    </td>
                  </tr>
                ) : filteredData.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-6 py-16 text-center">
                      <div className="flex flex-col items-center gap-3 text-slate-400">
                        <Search className="w-8 h-8 opacity-40" />
                        <p className="font-medium">Aucune opportunité trouvée.</p>
                        <p className="text-xs">Ajustez vos filtres ou relancez la collecte.</p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  filteredData.map((k) => {
                    const pos = Number(k.position || 0);
                    const imp = Number(k.impressions || 0);
                    const ctr = Number(k.ctr || 0);
                    const score = Number(k.opportunity_score || 0);
                    const priority = getPriorityLabel(score);

                    return (
                      <tr
                        key={k.id}
                        className="hover:bg-slate-50/50 transition-colors group"
                      >
                        {/* Keyword — click opens qualification modal */}
                        <td
                          onClick={() => handleQualify(k)}
                          className="px-6 py-4 cursor-pointer max-w-[220px]"
                        >
                          <div className="flex items-center gap-1.5">
                            <div className="font-bold text-slate-900 group-hover:text-indigo-600 transition-colors truncate">
                              {k.keyword}
                            </div>
                            {k.has_ai_overview && (
                              <span
                                title={
                                  k.your_in_aio
                                    ? "AI Overview présent — votre domaine est cité"
                                    : "AI Overview présent — votre domaine n'est PAS cité"
                                }
                                className={`shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[9px] font-bold uppercase tracking-wider border ${
                                  k.your_in_aio
                                    ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                    : "bg-amber-50 text-amber-700 border-amber-200"
                                }`}
                              >
                                <Sparkles className="w-2.5 h-2.5" />
                                {k.your_in_aio ? "AIO ✓" : "AIO ✗"}
                              </span>
                            )}
                          </div>
                          {k.action_hint && (
                            <div className="text-[10px] text-slate-400 mt-0.5 truncate">
                              {k.action_hint}
                            </div>
                          )}
                        </td>

                        {/* Position */}
                        <td className="px-6 py-4">
                          <span className={`px-2 py-1 rounded-lg text-xs font-bold ${getPositionColor(pos)}`}>
                            #{pos > 0 ? pos.toFixed(0) : "–"}
                          </span>
                        </td>

                        {/* Impressions */}
                        <td className="px-6 py-4">
                          <span className="text-sm font-bold text-slate-700">
                            {imp > 0 ? formatImpressions(imp) : <span className="text-slate-300">–</span>}
                          </span>
                        </td>

                        {/* CTR (from GSC) */}
                        <td className="px-6 py-4">
                          <span className="text-sm font-bold text-slate-700">
                            {ctr > 0
                              ? `${(ctr * 100).toFixed(2)}%`
                              : <span className="text-slate-300">–</span>}
                          </span>
                        </td>

                        {/* Intention */}
                        <td className="px-6 py-4">
                          {(() => {
                            const s = getIntentStyle(k.search_intent);
                            return (
                              <span className={`px-2 py-1 rounded-lg text-[11px] font-bold ${s.cls}`}>
                                {s.label}
                              </span>
                            );
                          })()}
                        </td>

                        {/* Branded */}
                        <td className="px-6 py-4">
                          {isBrandedKeyword(k.branded_status) ? (
                            <span className="px-2 py-1 rounded-lg text-[11px] font-bold bg-indigo-100 text-indigo-700">
                              Marque
                            </span>
                          ) : (
                            <span className="px-2 py-1 rounded-lg text-[11px] font-bold bg-slate-100 text-slate-500">
                              Hors marque
                            </span>
                          )}
                        </td>

                        {/* Opportunity Score */}
                        <td className="px-6 py-4 text-right">
                          <div className="inline-flex items-center gap-2 justify-end">
                            <span className={`px-3 py-1 rounded-full text-xs font-bold border ${getScoreColor(score)}`}>
                              +{Math.round(score)} clics
                            </span>
                            <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${priority.cls}`}>
                              {priority.text}
                            </span>
                          </div>
                        </td>

                        {/* Track button + suppression définitive */}
                        <td
                          className="px-6 py-4 text-right"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="inline-flex items-center gap-2">
                            <button
                              onClick={() =>
                                k.is_tracked ? handleUntrack(k.id) : handleTrack(k.id)
                              }
                              disabled={trackingId === k.id || deletingId === k.id}
                              title={k.is_tracked ? "Retirer du suivi" : "Ajouter au suivi"}
                              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                                k.is_tracked
                                  ? "bg-red-50 text-red-600 hover:bg-red-100 border border-red-100"
                                  : "bg-indigo-600 text-white hover:bg-indigo-700 shadow-sm"
                              } disabled:opacity-60 disabled:cursor-not-allowed`}
                            >
                              {trackingId === k.id ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : k.is_tracked ? (
                                <EyeOff className="w-3.5 h-3.5" />
                              ) : (
                                <Eye className="w-3.5 h-3.5" />
                              )}
                              {k.is_tracked ? "Retirer" : "Suivre"}
                            </button>
                            <button
                              onClick={() => handleDelete(k)}
                              disabled={deletingId === k.id || trackingId === k.id}
                              title="Supprimer définitivement (ré-importable lors d'une future collecte)"
                              className="p-1.5 rounded-xl text-slate-400 hover:text-red-600 hover:bg-red-50 transition-all border border-transparent hover:border-red-100 disabled:opacity-60 disabled:cursor-not-allowed"
                            >
                              {deletingId === k.id ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <Trash2 className="w-3.5 h-3.5" />
                              )}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
      </div>

      {/* ── Qualification modal ─────────────────────────────────────────────── */}
      <AnimatePresence>
        {selectedKeyword && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedKeyword(null)}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-md"
            />

            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative w-full max-w-2xl bg-white rounded-[3rem] shadow-2xl overflow-hidden max-h-[90vh] flex flex-col"
            >
              {/* Modal header */}
              <div className="p-8 border-b border-slate-100 flex items-center justify-between bg-slate-50/50 shrink-0">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-indigo-600 rounded-2xl flex items-center justify-center text-white shadow-lg shadow-indigo-200">
                    <Sparkles className="w-6 h-6" />
                  </div>
                  <div>
                    <h2 className="text-2xl font-bold text-slate-900 tracking-tight">
                      {selectedKeyword.keyword}
                    </h2>
                    <p className="text-slate-500 text-sm font-medium">
                      Qualification intelligente
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setSelectedKeyword(null)}
                  className="p-2 hover:bg-white rounded-full text-slate-400 hover:text-slate-900 transition-all"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>

              {/* Modal body — scrollable */}
              <div className="p-10 overflow-y-auto">
                {isQualifying ? (
                  <div className="py-20 flex flex-col items-center justify-center gap-6">
                    <div className="relative">
                      <Loader2 className="w-16 h-16 text-indigo-600 animate-spin" />
                      <Sparkles className="w-6 h-6 text-indigo-400 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
                    </div>
                    <div className="text-center">
                      <p className="text-slate-900 font-bold text-lg">
                        Analyse stratégique en cours...
                      </p>
                      <p className="text-slate-500 text-sm mt-1">
                        Qualification des dimensions et lecture des indicateurs.
                      </p>
                    </div>
                  </div>
                ) : qualificationResult ? (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="space-y-8"
                  >
                    {/* Label + intent + priority */}
                    <div className="bg-indigo-600 rounded-3xl p-6 text-white shadow-xl shadow-indigo-100 flex items-center justify-between gap-4 flex-wrap">
                      <div>
                        <div className="text-indigo-200 text-[10px] uppercase font-bold tracking-widest mb-1">
                          Label de Qualification
                        </div>
                        <div className="text-xl font-bold">
                          {qualificationResult.qualification_label}
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-2">
                        <div className="bg-white/20 px-4 py-1 rounded-xl backdrop-blur-md border border-white/30">
                          <span className="text-xs font-bold uppercase">
                            {trFR(INTENT_FR, qualificationResult.search_intent)}
                          </span>
                        </div>
                        <div
                          className={`px-4 py-1 rounded-xl backdrop-blur-md border border-white/30 text-xs font-bold uppercase ${
                            qualificationResult.priority_level === "high"
                              ? "bg-rose-500/40"
                              : qualificationResult.priority_level === "medium"
                              ? "bg-amber-500/40"
                              : "bg-emerald-500/40"
                          }`}
                        >
                          Priorité : {trFR(PRIORITY_FR, qualificationResult.priority_level)}
                        </div>
                      </div>
                    </div>

                    {/* Action hint */}
                    <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-4 flex items-center gap-3">
                      <Zap className="w-5 h-5 text-emerald-600 shrink-0" />
                      <div>
                        <div className="text-[10px] text-emerald-600 uppercase font-bold tracking-wider">
                          Action Recommandée
                        </div>
                        <div className="text-sm font-bold text-slate-900">
                          {qualificationResult.action_hint}
                        </div>
                      </div>
                    </div>

                    {/* AI Overview signal — pulled from the row, not the qualification result */}
                    {selectedKeyword?.has_ai_overview && (
                      <div
                        className={`rounded-2xl p-4 flex items-center gap-3 border ${
                          selectedKeyword.your_in_aio
                            ? "bg-emerald-50 border-emerald-100"
                            : "bg-amber-50 border-amber-100"
                        }`}
                      >
                        <Sparkles className={`w-5 h-5 shrink-0 ${
                          selectedKeyword.your_in_aio ? "text-emerald-600" : "text-amber-600"
                        }`} />
                        <div>
                          <div className={`text-[10px] uppercase font-bold tracking-wider ${
                            selectedKeyword.your_in_aio ? "text-emerald-600" : "text-amber-600"
                          }`}>
                            Aperçu IA
                          </div>
                          <div className="text-sm font-bold text-slate-900">
                            {selectedKeyword.your_in_aio
                              ? "Votre domaine est cité dans l'Aperçu IA ✓"
                              : "Aperçu IA présent — votre domaine n'est PAS cité"}
                          </div>
                          {!selectedKeyword.your_in_aio && (
                            <div className="text-xs text-amber-700 mt-1">
                              Optimisez le contenu (FAQ, données structurées, autorité de page) pour être cité.
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* 4-cell grid */}
                    <div className="grid grid-cols-2 gap-4">
                      {[
                        {
                          icon: ShieldCheck,
                          label: "Marque",
                          value: trFR(BRANDED_FR, qualificationResult.branded_status),
                        },
                        {
                          icon: Activity,
                          label: "Stabilité",
                          value: trFR(STABILITY_FR, qualificationResult.stability_status),
                        },
                        {
                          icon: Zap,
                          label: "Type de Traîne",
                          value: trFR(TAIL_FR, qualificationResult.tail_type),
                        },
                        {
                          icon: AlertCircle,
                          label: "Exclure de l'Analyse",
                          value: qualificationResult.exclude_from_opportunity ? "Oui" : "Non",
                          colorClass: qualificationResult.exclude_from_opportunity
                            ? "text-red-600"
                            : "text-emerald-600",
                        },
                      ].map(({ icon: Icon, label, value, colorClass }) => (
                        <div key={label} className="p-5 bg-slate-50 rounded-2xl border border-slate-100">
                          <div className="flex items-center gap-2 text-slate-400 mb-2">
                            <Icon className="w-4 h-4" />
                            <span className="text-[10px] uppercase font-bold tracking-wider">
                              {label}
                            </span>
                          </div>
                          <div className={`text-lg font-bold text-slate-900 capitalize ${colorClass ?? ""}`}>
                            {value}
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* KPI interpretation */}
                    {Object.keys(qualificationResult.kpi_interpretation || {}).length > 0 && (
                      <div className="space-y-3">
                        <h4 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                          <BarChart className="w-4 h-4 text-indigo-600" />
                          Interprétation des KPIs
                        </h4>
                        <div className="grid grid-cols-1 gap-2">
                          {Object.entries(qualificationResult.kpi_interpretation).map(
                            ([key, value]) => (
                              <div
                                key={key}
                                className="flex items-start gap-3 p-3 bg-slate-50 rounded-xl border border-slate-100"
                              >
                                <div className="text-[10px] font-bold text-slate-400 uppercase w-32 shrink-0 mt-1">
                                  {KPI_KEY_FR[key.toLowerCase()] ?? key.replace(/_/g, " ")}
                                </div>
                                <div className="text-xs text-slate-600 leading-relaxed">
                                  {translateKpiValue(String(value))}
                                </div>
                              </div>
                            )
                          )}
                        </div>
                      </div>
                    )}

                    {/* Reasoning */}
                    {qualificationResult.reasoning && (
                      <div className="space-y-3">
                        <h4 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                          <Info className="w-4 h-4 text-indigo-600" />
                          Raisonnement Stratégique
                        </h4>
                        <div className="bg-slate-900 rounded-3xl p-6 text-slate-300 text-sm leading-relaxed border border-slate-800">
                          {qualificationResult.reasoning}
                        </div>
                      </div>
                    )}
                  </motion.div>
                ) : (
                  <div className="py-20 text-center text-slate-400">
                    Une erreur est survenue lors de la qualification.
                  </div>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}