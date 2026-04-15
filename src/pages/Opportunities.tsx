import { useState, useEffect, useMemo } from "react";
import {
  Zap,
  TrendingUp,
  Filter,
  ArrowUpRight,
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
} from "lucide-react";
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  ZAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import { motion, AnimatePresence } from "motion/react";
import { qualifyKeywords } from "../services/geminiService";

// ─── Types ────────────────────────────────────────────────────────────────────

type Project = {
  id: number;
  name: string;
};

type OpportunityRow = {
  id: number;
  projectId: number;
  keyword: string;
  volume: number;
  position: number;
  competition: number;
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
  // FIX: is_tracked is now populated by the backend (was always undefined before
  // because the column didn't exist in the DB and wasn't in the SELECT query)
  is_tracked?: boolean;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const getPriorityLabel = (score: number) => {
  if (score >= 1) return "🚀 High";
  if (score >= 0.4) return "🔥 Medium";
  return "⚪ Low";
};

const getScoreColor = (score: number) => {
  if (score >= 1) return "bg-emerald-50 text-emerald-600";
  if (score >= 0.4) return "bg-amber-50 text-amber-600";
  return "bg-slate-100 text-slate-600";
};

// FIX: Normalised branded detection — handles both "non_branded" and "non-branded"
// variants that the backend might return depending on whether the NLP enrichment
// ran or whether the COALESCE fallback ("non-branded") is active.
const isBrandedKeyword = (branded_status?: string): boolean => {
  if (!branded_status) return false;
  const v = branded_status.toLowerCase().trim();
  return v === "branded";
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function Opportunities() {
  const [data, setData] = useState<OpportunityRow[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [loading, setLoading] = useState(true);

  // FIX: Separate state for each async action to avoid conflating UI states.
  // The original code used a single `resetting` flag for both filter reset
  // and the n8n trigger, which caused the button to stay disabled even when
  // only the filters needed clearing.
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetSuccess, setResetSuccess] = useState(false);

  // FIX: trackingId tracks which keyword row is loading, not a global flag.
  const [trackingId, setTrackingId] = useState<number | null>(null);
  const [trackError, setTrackError] = useState<string | null>(null);

  // Filter state
  const [search, setSearch] = useState("");
  const [minVolume, setMinVolume] = useState("");
  const [maxCompetition, setMaxCompetition] = useState("");
  const [onlyPositiveTrend, setOnlyPositiveTrend] = useState(false);
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
      competition_score: keyword.competition_score || keyword.competition || 0,
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

  // ─── Reset filters (local only) ─────────────────────────────────────────────
  //
  // FIX: The original resetFilters() was doing TWO things at once:
  //   1. Resetting the filter UI state (instant, no network needed)
  //   2. Triggering the n8n workflow (async, can fail)
  // This was wrong: a filter reset should never block on a network call.
  // These are now split into two separate actions.

  const clearFilters = () => {
    setSearch("");
    setMinVolume("");
    setMaxCompetition("");
    setOnlyPositiveTrend(false);
    setExcludeBranded(false);
  };

  // ─── Trigger n8n workflow ───────────────────────────────────────────────────
  //
  // FIX: Separated from filter reset. Now calls /api/opportunities/reset which
  // was missing from the backend and has been added to server.ts.
  // Displays a proper inline error instead of an alert() popup.

  const handleTriggerWorkflow = async () => {
    setResetting(true);
    setResetError(null);
    setResetSuccess(false);
    try {
      const res = await fetch("/api/opportunities/reset", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("token")}`,
        },
        body: JSON.stringify({ projectId: selectedProjectId || null }),
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

      const matchesMinVolume =
        minVolume === "" || Number(k.volume || 0) >= Number(minVolume);

      const matchesMaxCompetition =
        maxCompetition === "" ||
        Number(k.competition || 0) <= Number(maxCompetition);

      const matchesTrend = !onlyPositiveTrend || Number(k.trend || 0) > 0;

      // FIX: Use the normalised helper — handles "branded", "non_branded",
      // "non-branded" variants without ambiguity.
      const matchesBranded = !excludeBranded || !isBrandedKeyword(k.branded_status);

      return (
        matchesSearch &&
        matchesMinVolume &&
        matchesMaxCompetition &&
        matchesTrend &&
        matchesBranded
      );
    });
  }, [data, search, minVolume, maxCompetition, onlyPositiveTrend, excludeBranded]);

  const trackedCount = useMemo(
    () => data.filter((k) => k.is_tracked).length,
    [data]
  );

  const scatterData = filteredData.map((k) => ({
    x: Number((k.competition || 0) * 100),
    y: Number(k.volume || 0),
    z: Math.max(40, Math.abs((k.trend || 0) * 200)),
    name: k.keyword,
    score: Number(k.opportunity_score || 0),
  }));

  const topOpportunity = filteredData[0];

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
            Priorisation automatique basée sur volume, compétition et potentiel CTR.
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
              Classement basé sur Opportunity Score
            </span>
          </div>

          {/* Tracked count badge */}
          {trackedCount > 0 && (
            <div className="px-4 py-2 bg-emerald-50 border border-emerald-100 rounded-xl text-sm font-bold text-emerald-700">
              {trackedCount} suivi{trackedCount > 1 ? "s" : ""}
            </div>
          )}

          {/* FIX: Workflow trigger moved out of resetFilters into its own button.
              Shows inline feedback instead of alert(). */}
          <div className="flex flex-col items-end gap-1">
            <button
              onClick={handleTriggerWorkflow}
              disabled={resetting}
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

      {/* ── Main grid ──────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">

        {/* ── Table card ───────────────────────────────────────────────────── */}
        <div className="lg:col-span-2 bg-white rounded-[2.5rem] border border-slate-100 shadow-sm overflow-hidden flex flex-col">

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
              <input
                type="number"
                value={minVolume}
                onChange={(e) => setMinVolume(e.target.value)}
                placeholder="Volume min"
                className="px-4 py-2 bg-white border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <input
                type="number"
                step="0.01"
                min="0"
                max="1"
                value={maxCompetition}
                onChange={(e) => setMaxCompetition(e.target.value)}
                placeholder="Compétition max (0-1)"
                className="px-4 py-2 bg-white border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <label className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-xl text-sm text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={onlyPositiveTrend}
                  onChange={(e) => setOnlyPositiveTrend(e.target.checked)}
                />
                Trend positif
              </label>
              <label className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-xl text-sm text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={excludeBranded}
                  onChange={(e) => setExcludeBranded(e.target.checked)}
                />
                Exclure branded
              </label>
            </div>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="text-slate-400 text-[10px] uppercase tracking-wider font-bold">
                  <th className="px-6 py-4">Keyword</th>
                  <th className="px-6 py-4">Volume</th>
                  <th className="px-6 py-4">Position</th>
                  <th className="px-6 py-4">Compétition</th>
                  <th className="px-6 py-4">Trend</th>
                  <th className="px-6 py-4 text-right">Opp. Score</th>
                  {/*
                    FIX: "Suivi" column header added — was missing in the previous
                    version but the column existed in tbody, causing misalignment.
                  */}
                  <th className="px-6 py-4 text-right">Suivi</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-slate-50">
                {loading ? (
                  <tr>
                    <td colSpan={7} className="px-6 py-10 text-center text-slate-400">
                      Chargement...
                    </td>
                  </tr>
                ) : filteredData.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-6 py-10 text-center text-slate-400">
                      Aucune opportunité trouvée.
                    </td>
                  </tr>
                ) : (
                  filteredData.map((k) => (
                    <tr
                      key={k.id}
                      className="hover:bg-slate-50/50 transition-colors group"
                    >
                      {/* Keyword cell — click opens qualification modal */}
                      <td
                        onClick={() => handleQualify(k)}
                        className="px-6 py-4 cursor-pointer"
                      >
                        <div className="font-bold text-slate-900 group-hover:text-indigo-600 transition-colors">
                          {k.keyword}
                        </div>
                        <div className="flex items-center gap-2 mt-1 flex-wrap">
                          <span className="text-[10px] text-slate-400 uppercase font-bold tracking-tighter">
                            {k.search_intent || "N/A"}
                          </span>
                          {k.branded_status && (
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 font-bold uppercase">
                              {String(k.branded_status).replace(/_/g, " ")}
                            </span>
                          )}
                        </div>
                      </td>

                      <td className="px-6 py-4 text-sm text-slate-600 font-medium">
                        {Number(k.volume || 0).toLocaleString()}
                      </td>

                      <td className="px-6 py-4">
                        <span className="px-2 py-1 bg-slate-100 text-slate-700 rounded-lg text-xs font-bold">
                          #{Number(k.position || 0).toFixed(1)}
                        </span>
                      </td>

                      <td className="px-6 py-4">
                        <div className="w-24 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${
                              Number(k.competition || 0) > 0.7
                                ? "bg-red-500"
                                : Number(k.competition || 0) > 0.4
                                ? "bg-amber-500"
                                : "bg-emerald-500"
                            }`}
                            style={{ width: `${Number(k.competition || 0) * 100}%` }}
                          />
                        </div>
                      </td>

                      <td className="px-6 py-4">
                        <div
                          className={`flex items-center gap-1 text-xs font-bold ${
                            Number(k.trend || 0) > 0 ? "text-emerald-600" : "text-red-600"
                          }`}
                        >
                          <TrendingUp
                            className={`w-3 h-3 ${Number(k.trend || 0) > 0 ? "" : "rotate-180"}`}
                          />
                          {Math.abs(Number(k.trend || 0) * 100).toFixed(0)}%
                        </div>
                      </td>

                      <td className="px-6 py-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <span
                            className={`px-3 py-1 rounded-full text-xs font-bold ${getScoreColor(
                              Number(k.opportunity_score || 0)
                            )}`}
                          >
                            {Number(k.opportunity_score || 0).toFixed(2)}
                          </span>
                          <span className="text-xs text-slate-400">
                            {getPriorityLabel(Number(k.opportunity_score || 0))}
                          </span>
                        </div>
                      </td>

                      {/*
                        FIX: Track button is now inside a dedicated <td> that
                        stops click propagation so it doesn't open the modal.
                        Previously the entire <tr> had onClick={() => handleQualify(k)}
                        which meant clicking "Suivre" also opened the modal.
                        Now only the keyword cell triggers qualification.
                      */}
                      <td
                        className="px-6 py-4 text-right"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          onClick={() =>
                            k.is_tracked ? handleUntrack(k.id) : handleTrack(k.id)
                          }
                          disabled={trackingId === k.id}
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
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* ── Sidebar ──────────────────────────────────────────────────────── */}
        <div className="space-y-8">
          {/* Scatter chart */}
          <div className="bg-white p-8 rounded-[2.5rem] border border-slate-100 shadow-sm">
            <h3 className="text-xl font-bold text-slate-900 mb-6 flex items-center gap-2">
              Analyse Scatter
              <Info className="w-4 h-4 text-slate-300" />
            </h3>
            <div className="h-[300px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ScatterChart margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis
                    type="number"
                    dataKey="x"
                    name="Competition"
                    unit="%"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: "#94a3b8", fontSize: 10 }}
                  />
                  <YAxis
                    type="number"
                    dataKey="y"
                    name="Volume"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: "#94a3b8", fontSize: 10 }}
                  />
                  <ZAxis type="number" dataKey="z" range={[50, 400]} name="Trend" />
                  <Tooltip
                    cursor={{ strokeDasharray: "3 3" }}
                    contentStyle={{
                      backgroundColor: "#fff",
                      borderRadius: "16px",
                      border: "none",
                      boxShadow: "0 10px 15px -3px rgb(0 0 0 / 0.1)",
                    }}
                  />
                  <Scatter name="Keywords" data={scatterData}>
                    {scatterData.map((entry, index) => (
                      <Cell
                        key={`cell-${index}`}
                        fill={
                          entry.score >= 1
                            ? "#10b981"
                            : entry.score >= 0.4
                            ? "#f59e0b"
                            : "#6366f1"
                        }
                      />
                    ))}
                  </Scatter>
                </ScatterChart>
              </ResponsiveContainer>
            </div>

            <div className="mt-6 p-4 bg-indigo-50 rounded-2xl border border-indigo-100">
              <div className="flex items-center gap-2 text-indigo-600 font-bold text-sm mb-1">
                <Zap className="w-4 h-4" />
                Opportunité prioritaire
              </div>
              <p className="text-xs text-slate-600 leading-relaxed">
                {topOpportunity ? (
                  <>
                    Le mot-clé <strong>"{topOpportunity.keyword}"</strong> présente le
                    meilleur score actuel. Il combine potentiel de gain, volume et
                    compétition exploitable.
                  </>
                ) : (
                  <>Aucune opportunité mise en avant pour le moment.</>
                )}
              </p>
            </div>
          </div>

          {/* IA insights card */}
          <div className="bg-slate-900 p-8 rounded-[2.5rem] text-white overflow-hidden relative group">
            <div className="relative z-10">
              <div className="text-indigo-400 font-bold text-xs uppercase tracking-widest mb-2">
                IA Insights
              </div>
              <h4 className="text-xl font-bold mb-4">Lecture décisionnelle</h4>
              <p className="text-slate-400 text-sm leading-relaxed mb-6">
                L'objectif est de concentrer les efforts SEO sur les mots-clés à
                meilleur rendement potentiel : bon volume, concurrence acceptable et
                marge d'amélioration mesurable.
              </p>
              <button className="flex items-center gap-2 text-sm font-bold hover:gap-3 transition-all">
                Explorer les opportunités
                <ArrowUpRight className="w-4 h-4" />
              </button>
            </div>
            <div className="absolute -right-10 -bottom-10 w-40 h-40 bg-indigo-600/20 rounded-full blur-3xl group-hover:scale-150 transition-transform duration-700" />
          </div>
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
                            {qualificationResult.search_intent}
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
                          Priorité : {qualificationResult.priority_level}
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

                    {/* 4-cell grid */}
                    <div className="grid grid-cols-2 gap-4">
                      {[
                        {
                          icon: ShieldCheck,
                          label: "Branding",
                          value: qualificationResult.branded_status?.replace(/_/g, " "),
                        },
                        {
                          icon: Activity,
                          label: "Stabilité",
                          value: qualificationResult.stability_status,
                        },
                        {
                          icon: Zap,
                          label: "Type de Traîne",
                          value: qualificationResult.tail_type?.replace(/_/g, " "),
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
                                  {key.replace(/_/g, " ")}
                                </div>
                                <div className="text-xs text-slate-600 leading-relaxed">
                                  {value as string}
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