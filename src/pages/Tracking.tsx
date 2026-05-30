import { useState, useEffect, useMemo } from "react";
import {
  ArrowUp,
  ArrowDown,
  Minus,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Search,
  Briefcase,
  ChevronDown,
  Loader2,
  EyeOff,
  TrendingUp,
  MousePointer2,
  BarChart3,
  Zap,
  RefreshCw,
  X,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { useSelectedProject } from "../hooks/useSelectedProject";

type Project = {
  id: number;
  name: string;
};

type TrackedKeyword = {
  id: number;
  projectId?: number;
  keyword: string;
  position?: number | null;
  prev_position?: number | null;
  ctr?: number | null;
  prev_ctr?: number | null;
  impressions?: number | null;
  clicks?: number | null;
  opportunity_score?: number | null;
  ctr_gap?: number | null;
  performance_drift?: number | null;
  search_intent?: string | null;
  branded_status?: string | null;
  action_hint?: string | null;
  priority_level?: string | null;
  is_tracked?: boolean;
  // Date manuelle saisie par l'analyste = début réel de son intervention SEO.
  // Quand renseignée, l'évolution est calculée depuis la première ligne GSC
  // à partir de cette date (cf. /api/keywords/tracked).
  optimization_start_date?: string | null;
  baseline_date?: string | null;
  baseline_position?: number | null;
  baseline_ctr?: number | null;
  baseline_impressions?: number | null;
  baseline_clicks?: number | null;
  // Évolutions calculées par le backend à partir de gsc_daily (sans n8n).
  // > 0 = position dégradée, < 0 = position améliorée. NULL si pas de baseline.
  position_evolution?: number | null;
  impressions_evolution?: number | null;
  has_sufficient_history?: boolean;
};

const getStatusInfo = (drift: number) => {
  if (drift >= 5) return { label: "À corriger", cls: "bg-red-50 text-red-600",    Icon: XCircle };
  if (drift >= 2) return { label: "À surveiller", cls: "bg-amber-50 text-amber-600", Icon: AlertTriangle };
  return             { label: "Stable",      cls: "bg-emerald-50 text-emerald-600", Icon: CheckCircle2 };
};

// Statut basé sur l'évolution de position depuis la date d'optimisation.
// > 0 = la position s'éloigne (rang plus grand, dégradation),
// < 0 = la position s'améliore (rang plus petit, gain).
const getOptStatusInfo = (positionEvolution: number) => {
  if (positionEvolution >= 5)  return { label: "À corriger",  cls: "bg-red-50 text-red-600",       Icon: XCircle };
  if (positionEvolution >= 2)  return { label: "À surveiller", cls: "bg-amber-50 text-amber-600",   Icon: AlertTriangle };
  if (positionEvolution <= -2) return { label: "Améliore",    cls: "bg-emerald-50 text-emerald-600", Icon: TrendingUp };
  return                            { label: "Stable",       cls: "bg-slate-50 text-slate-600",    Icon: CheckCircle2 };
};

const formatNum = (n: number) => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}k`;
  return String(Math.round(n));
};

const INTENT_CLS: Record<string, string> = {
  transactionnelle: "bg-emerald-100 text-emerald-700",
  navigationnelle:  "bg-amber-100 text-amber-700",
  informationnelle: "bg-blue-100 text-blue-700",
};

export default function Tracking() {
  const [data, setData] = useState<TrackedKeyword[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useSelectedProject();
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [untrackingId, setUntrackingId] = useState<number | null>(null);
  const [untrackError, setUntrackError] = useState<string | null>(null);
  // Set des keywords en cours de sauvegarde de leur date d'optimisation
  // (pour griser le champ pendant la requête PATCH)
  const [savingDateIds, setSavingDateIds] = useState<Set<number>>(new Set());
  // Set des keywords en cours de refresh GSC ciblé (bouton ↻ par ligne)
  const [refreshingIds, setRefreshingIds] = useState<Set<number>>(new Set());
  // Flash vert sur la ligne quand le refresh vient de réussir (1.5s)
  const [flashingIds, setFlashingIds] = useState<Set<number>>(new Set());
  // Toast de progression / résultat du refresh GSC (bas-droite)
  const [refreshToast, setRefreshToast] = useState<{
    keyword: string;
    phase: "loading" | "success" | "error";
    stats?: { days: number; clicks: number; impressions: number };
    message?: string;
  } | null>(null);

  useEffect(() => { fetchProjects(); }, []);
  useEffect(() => { fetchTrackedKeywords(); }, [selectedProjectId]);

  const fetchProjects = async () => {
    try {
      const res = await fetch("/api/projects", {
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setProjects(await res.json());
    } catch (err) {
      console.error("Tracking fetchProjects:", err);
      setProjects([]);
    }
  };

  const fetchTrackedKeywords = async () => {
    setLoading(true);
    try {
      const url = selectedProjectId
        ? `/api/keywords/tracked?projectId=${selectedProjectId}`
        : "/api/keywords/tracked";
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
    } catch (err) {
      console.error("Tracking fetch:", err);
      setData([]);
    } finally {
      setLoading(false);
    }
  };

  const handleUntrack = async (keywordId: number) => {
    setUntrackingId(keywordId);
    setUntrackError(null);
    try {
      const res = await fetch(`/api/keywords/${keywordId}/untrack`, {
        method: "POST",
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData((prev) => prev.filter((k) => k.id !== keywordId));
    } catch (err: any) {
      setUntrackError(err.message || "Erreur lors de la suppression du suivi.");
      setTimeout(() => setUntrackError(null), 4000);
    } finally {
      setUntrackingId(null);
    }
  };

  // Sauvegarde la date manuelle de début d'optimisation. date = "" ⇒ effacer.
  // Le backend renvoie le row recomputé depuis gsc_daily (baseline + évolution).
  // On remplace directement la ligne dans le state pour une mise à jour
  // instantanée, sans refetch complet de la liste.
  const handleSetOptimizationDate = async (keywordId: number, date: string) => {
    setSavingDateIds((prev) => new Set(prev).add(keywordId));
    try {
      const res = await fetch(`/api/keywords/${keywordId}/optimization-start-date`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("token")}`,
        },
        body: JSON.stringify({ date: date || null }),
      });
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(errText || `HTTP ${res.status}`);
      }
      const payload = await res.json().catch(() => ({}));
      const row: TrackedKeyword | null = payload?.row ?? null;

      if (row) {
        setData((prev) => prev.map((k) => (k.id === keywordId ? row : k)));
      } else {
        // Fallback : si le backend n'a pas renvoyé de row, on refetch.
        await fetchTrackedKeywords();
      }
    } catch (err: any) {
      setUntrackError(err.message || "Erreur lors de la sauvegarde de la date.");
      setTimeout(() => setUntrackError(null), 4000);
    } finally {
      setSavingDateIds((prev) => {
        const next = new Set(prev);
        next.delete(keywordId);
        return next;
      });
    }
  };

  // Refresh ciblé des données GSC pour UN mot-clé. Déclenche le workflow n8n
  // dédié (refresh-gsc-keyword) côté backend, attend que gsc_daily soit
  // upserté, puis remplace la ligne dans data[] avec les valeurs fraîches.
  // N'utilise pas le bouton global "Relancer la collecte" — collecte ciblée.
  const handleRefreshGsc = async (keywordId: number) => {
    const days = 14;
    const targetKeyword = data.find((k) => k.id === keywordId)?.keyword ?? "";
    setRefreshingIds((prev) => new Set(prev).add(keywordId));
    setRefreshToast({ keyword: targetKeyword, phase: "loading" });
    try {
      const res = await fetch(`/api/keywords/${keywordId}/refresh-gsc`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("token")}`,
        },
        body: JSON.stringify({ days }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      const payload = await res.json();
      const row: TrackedKeyword | null = payload?.row ?? null;
      if (row) {
        setData((prev) => prev.map((k) => (k.id === keywordId ? row : k)));
        setRefreshToast({
          keyword: row.keyword || targetKeyword,
          phase: "success",
          stats: {
            days,
            clicks: Number(row.clicks ?? 0),
            impressions: Number(row.impressions ?? 0),
          },
        });
        setFlashingIds((prev) => new Set(prev).add(keywordId));
        setTimeout(() => {
          setFlashingIds((prev) => {
            const next = new Set(prev);
            next.delete(keywordId);
            return next;
          });
        }, 1500);
        setTimeout(() => setRefreshToast(null), 4000);
      }
    } catch (err: any) {
      setRefreshToast({
        keyword: targetKeyword,
        phase: "error",
        message: err.message || "Erreur lors du rafraîchissement GSC.",
      });
      setTimeout(() => setRefreshToast(null), 5000);
    } finally {
      setRefreshingIds((prev) => {
        const next = new Set(prev);
        next.delete(keywordId);
        return next;
      });
    }
  };

  const filteredData = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? data.filter((k) => k.keyword.toLowerCase().includes(q)) : data;
  }, [data, search]);

  // Summary stats
  const stats = useMemo(() => {
    const total = filteredData.length;
    const needAction = filteredData.filter((k) => Number(k.performance_drift ?? 0) >= 5).length;
    const totalImpressions = filteredData.reduce((s, k) => s + Number(k.impressions ?? 0), 0);
    const totalGain = filteredData.reduce((s, k) => s + Number(k.opportunity_score ?? 0), 0);
    return { total, needAction, totalImpressions, totalGain };
  }, [filteredData]);

  return (
    <div className="max-w-7xl mx-auto space-y-8">

      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Suivi des mots-clés</h1>
          <p className="text-slate-500 mt-1">Mots-clés sélectionnés depuis Opportunités pour un suivi actif.</p>
        </div>
        <div className="relative">
          <Briefcase className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <select
            value={selectedProjectId}
            onChange={(e) => setSelectedProjectId(e.target.value)}
            className="pl-10 pr-8 py-2 bg-white border border-slate-200 rounded-xl text-sm font-bold text-slate-700 shadow-sm hover:bg-slate-50 transition-all appearance-none outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="">Tous les projets</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <ChevronDown className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
        </div>
      </div>

      {/* KPI summary cards */}
      {!loading && filteredData.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { icon: BarChart3,      label: "Suivis",             value: stats.total,                           color: "text-indigo-600",  bg: "bg-indigo-50" },
            { icon: XCircle,        label: "Nécessitent action", value: stats.needAction,                      color: "text-red-600",     bg: "bg-red-50" },
            { icon: MousePointer2,  label: "Impressions totales",value: formatNum(stats.totalImpressions),     color: "text-blue-600",    bg: "bg-blue-50" },
            { icon: Zap,            label: "Gain potentiel total",value: `+${Math.round(stats.totalGain)} clics`, color: "text-emerald-600", bg: "bg-emerald-50" },
          ].map((s, i) => (
            <motion.div
              key={s.label}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.06 }}
              className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5"
            >
              <div className={`w-9 h-9 ${s.bg} rounded-xl flex items-center justify-center mb-3`}>
                <s.icon className={`w-4 h-4 ${s.color}`} />
              </div>
              <div className="text-xl font-bold text-slate-900">{s.value}</div>
              <div className="text-xs text-slate-500 font-medium mt-0.5">{s.label}</div>
            </motion.div>
          ))}
        </div>
      )}

      {/* Error toast */}
      {untrackError && (
        <div className="bg-red-50 border border-red-200 rounded-2xl px-5 py-3 text-sm text-red-700 font-medium">
          {untrackError}
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-[2.5rem] border border-slate-100 shadow-sm overflow-hidden">

        {/* Table bar */}
        <div className="p-6 border-b border-slate-50 flex items-center justify-between bg-slate-50/50 flex-wrap gap-4">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher un mot-clé..."
              className="pl-10 pr-4 py-2 bg-white border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 w-64 outline-none"
            />
          </div>
          <div className="text-sm text-slate-500 font-medium">
            {filteredData.length} mot{filteredData.length > 1 ? "s" : ""}-clé{filteredData.length > 1 ? "s" : ""} suivi{filteredData.length > 1 ? "s" : ""}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="text-slate-400 text-[10px] uppercase tracking-wider font-bold border-b border-slate-100">
                <th className="px-6 py-4">Mot-clé</th>
                <th className="px-6 py-4">Date début opti.</th>
                <th className="px-6 py-4">Position</th>
                <th className="px-6 py-4">Évolution</th>
                <th className="px-6 py-4">Impressions</th>
                <th className="px-6 py-4">Clics</th>
                <th className="px-6 py-4">CTR</th>
                <th className="px-6 py-4">CTR Gap</th>
                <th className="px-6 py-4">Gain potentiel</th>
                <th className="px-6 py-4">Statut</th>
                <th className="px-6 py-4 text-right">Action</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-50">
              {loading ? (
                <tr>
                  <td colSpan={11} className="px-6 py-10 text-center text-slate-400">
                    <div className="inline-flex items-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Chargement...
                    </div>
                  </td>
                </tr>
              ) : filteredData.length === 0 ? (
                <tr>
                  <td colSpan={11} className="px-6 py-16 text-center">
                    <div className="flex flex-col items-center gap-3 text-slate-400">
                      <TrendingUp className="w-8 h-8 opacity-40" />
                      <p className="font-medium">Aucun mot-clé suivi.</p>
                      <p className="text-xs">Ajoutez des mots-clés depuis la page Opportunités.</p>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredData.map((k) => {
                  const pos = Number(k.position ?? 0);
                  // prev_position renvoyé par l'API = baseline si optimization_start_date
                  // est défini, sinon fallback 7-jours. Voir GET /api/keywords/tracked.
                  const prevPos = Number(k.prev_position ?? 0);
                  const posDiff = prevPos > 0 ? prevPos - pos : 0; // positive = improved
                  const ctr = Number(k.ctr ?? 0);
                  const prevCtr = Number(k.prev_ctr ?? 0);
                  const ctrDiff = ctr - prevCtr;
                  const gap = Number(k.ctr_gap ?? 0);
                  const drift = Number(k.performance_drift ?? 0);
                  const score = Number(k.opportunity_score ?? 0);
                  // Statut : pris depuis l'évolution avant/après dès qu'une
                  // date d'optimisation est exploitable. Sinon fallback sur le
                  // drift 28 jours de scores_daily.
                  const hasOptHistory = k.has_sufficient_history === true;
                  const posEvolution = Number(k.position_evolution ?? 0);
                  const { label: statusLabel, cls: statusCls, Icon: StatusIcon } = hasOptHistory
                    ? getOptStatusInfo(posEvolution)
                    : getStatusInfo(Math.abs(drift));
                  const intentKey = (k.search_intent ?? "").toLowerCase();

                  // Date manuelle d'optimisation : pilote l'affichage des deltas
                  // impressions/clics et le tooltip d'évolution.
                  const optStart = (k.optimization_start_date || "").slice(0, 10);
                  const baselineDate = (k.baseline_date || "").slice(0, 10);
                  const hasBaseline = !!optStart;
                  const impressions = Number(k.impressions ?? 0);
                  const clicks = Number(k.clicks ?? 0);
                  const baselineImp = Number(k.baseline_impressions ?? 0);
                  const baselineClk = Number(k.baseline_clicks ?? 0);
                  const impDiff = hasBaseline ? impressions - baselineImp : 0;
                  const clkDiff = hasBaseline ? clicks - baselineClk : 0;
                  const isSavingDate = savingDateIds.has(k.id);
                  const isRefreshing = refreshingIds.has(k.id);
                  const isFlashing = flashingIds.has(k.id);

                  return (
                    <motion.tr
                      key={k.id}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className={`group transition-colors duration-700 ${
                        isFlashing
                          ? "bg-emerald-50"
                          : "hover:bg-slate-50/50"
                      }`}
                    >
                      {/* Keyword */}
                      <td className="px-6 py-4 max-w-[180px]">
                        <div className="font-bold text-slate-900 truncate">{k.keyword}</div>
                        <div className="flex items-center gap-1 mt-0.5">
                          {intentKey && INTENT_CLS[intentKey] && (
                            <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${INTENT_CLS[intentKey]}`}>
                              {intentKey === "transactionnelle" ? "Transac." : intentKey === "navigationnelle" ? "Nav." : "Info."}
                            </span>
                          )}
                          {(k.branded_status ?? "").toLowerCase() === "branded" && (
                            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-indigo-100 text-indigo-700">
                              Branded
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Date début optimisation (saisie manuelle par l'analyste) */}
                      <td className="px-6 py-4">
                        <input
                          type="date"
                          value={optStart}
                          disabled={isSavingDate}
                          onChange={(e) => handleSetOptimizationDate(k.id, e.target.value)}
                          className="px-2 py-1 text-xs bg-white border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
                          title={
                            hasBaseline && baselineDate && baselineDate !== optStart
                              ? `Baseline réelle : ${baselineDate} (1ʳᵉ donnée disponible ≥ ${optStart})`
                              : hasBaseline
                              ? `Évolution calculée depuis le ${optStart}`
                              : "Saisir la date de début d'intervention SEO"
                          }
                        />
                        {hasBaseline && baselineDate && baselineDate !== optStart && (
                          <div className="text-[9px] text-slate-400 mt-1">
                            data: {baselineDate}
                          </div>
                        )}
                        {hasBaseline && k.has_sufficient_history === false && (
                          <div className="text-[9px] text-amber-600 mt-1">
                            comparaison sous 1-2 j
                          </div>
                        )}
                      </td>

                      {/* Position */}
                      <td className="px-6 py-4">
                        {isRefreshing ? (
                          <div className="h-5 w-10 bg-slate-200 rounded animate-pulse" />
                        ) : (
                          <>
                            <div className="text-lg font-bold text-slate-900">
                              {pos > 0 ? `#${pos.toFixed(0)}` : "–"}
                            </div>
                            {prevPos > 0 && (
                              <div className="text-[10px] text-slate-400">
                                vs #{prevPos.toFixed(0)}
                                {hasBaseline ? " (baseline)" : ""}
                              </div>
                            )}
                          </>
                        )}
                      </td>

                      {/* Evolution */}
                      <td className="px-6 py-4">
                        {isRefreshing ? (
                          <div className="h-4 w-12 bg-slate-200 rounded animate-pulse" />
                        ) : prevPos > 0 ? (
                          <div className={`flex items-center gap-1 text-sm font-bold ${
                            posDiff > 0 ? "text-emerald-600" : posDiff < 0 ? "text-red-600" : "text-slate-400"
                          }`}>
                            {posDiff > 0 ? <ArrowUp className="w-4 h-4" /> : posDiff < 0 ? <ArrowDown className="w-4 h-4" /> : <Minus className="w-4 h-4" />}
                            {Math.abs(posDiff).toFixed(1)}
                          </div>
                        ) : (
                          <span className="text-slate-300 text-sm">–</span>
                        )}
                      </td>

                      {/* Impressions (delta vs baseline si date d'opti définie) */}
                      <td className="px-6 py-4">
                        {isRefreshing ? (
                          <div className="h-4 w-12 bg-slate-200 rounded animate-pulse" />
                        ) : (
                          <>
                            <span className="text-sm font-bold text-slate-700">
                              {impressions > 0 ? formatNum(impressions) : <span className="text-slate-300">–</span>}
                            </span>
                            {hasBaseline && (baselineImp > 0 || impressions > 0) && (
                              <div className={`text-[10px] font-bold ${
                                impDiff > 0 ? "text-emerald-600" : impDiff < 0 ? "text-red-600" : "text-slate-400"
                              }`}>
                                {impDiff > 0 ? "+" : ""}{formatNum(Math.abs(impDiff))} vs baseline
                              </div>
                            )}
                          </>
                        )}
                      </td>

                      {/* Clicks (delta vs baseline si date d'opti définie) */}
                      <td className="px-6 py-4">
                        {isRefreshing ? (
                          <div className="h-4 w-10 bg-slate-200 rounded animate-pulse" />
                        ) : (
                          <>
                            <span className="text-sm font-bold text-slate-700">
                              {clicks > 0 ? formatNum(clicks) : <span className="text-slate-300">–</span>}
                            </span>
                            {hasBaseline && (baselineClk > 0 || clicks > 0) && (
                              <div className={`text-[10px] font-bold ${
                                clkDiff > 0 ? "text-emerald-600" : clkDiff < 0 ? "text-red-600" : "text-slate-400"
                              }`}>
                                {clkDiff > 0 ? "+" : ""}{formatNum(Math.abs(clkDiff))} vs baseline
                              </div>
                            )}
                          </>
                        )}
                      </td>

                      {/* CTR */}
                      <td className="px-6 py-4">
                        {isRefreshing ? (
                          <div className="h-4 w-12 bg-slate-200 rounded animate-pulse" />
                        ) : (
                          <>
                            <div className="text-sm font-bold text-slate-900">
                              {ctr > 0 ? `${(ctr * 100).toFixed(1)}%` : <span className="text-slate-300">–</span>}
                            </div>
                            {prevCtr > 0 && ctrDiff !== 0 && (
                              <div className={`text-[10px] font-bold ${ctrDiff > 0 ? "text-emerald-600" : "text-red-600"}`}>
                                {ctrDiff > 0 ? "+" : ""}{(ctrDiff * 100).toFixed(1)}%
                              </div>
                            )}
                          </>
                        )}
                      </td>

                      {/* CTR Gap */}
                      <td className="px-6 py-4">
                        {isRefreshing ? (
                          <div className="h-4 w-14 bg-slate-200 rounded animate-pulse" />
                        ) : gap !== 0 ? (
                          <span className={`text-xs font-bold ${
                            gap >= -0.02 ? "text-emerald-600" : gap >= -0.07 ? "text-amber-600" : "text-red-600"
                          }`}>
                            {gap > 0 ? "+" : ""}{(gap * 100).toFixed(1)}%
                          </span>
                        ) : (
                          <span className="text-slate-300 text-xs">–</span>
                        )}
                      </td>

                      {/* Opportunity score */}
                      <td className="px-6 py-4">
                        {isRefreshing ? (
                          <div className="h-6 w-20 bg-slate-200 rounded-lg animate-pulse" />
                        ) : score > 0 ? (
                          <span className={`px-2 py-1 rounded-lg text-xs font-bold border ${
                            score >= 200 ? "bg-emerald-50 text-emerald-700 border-emerald-200" :
                            score >= 50  ? "bg-amber-50 text-amber-700 border-amber-200" :
                                           "bg-slate-50 text-slate-600 border-slate-200"
                          }`}>
                            +{Math.round(score)} clics
                          </span>
                        ) : (
                          <span className="text-slate-300 text-xs">–</span>
                        )}
                      </td>

                      {/* Status */}
                      <td className="px-6 py-4">
                        {isRefreshing ? (
                          <div className="h-6 w-24 bg-slate-200 rounded-lg animate-pulse" />
                        ) : (
                          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider ${statusCls}`}>
                            <StatusIcon className="w-3 h-3" />
                            {statusLabel}
                          </span>
                        )}
                      </td>

                      {/* Actions : refresh GSC ciblé + arrêt du suivi */}
                      <td className="px-6 py-4 text-right">
                        <div className="inline-flex items-center gap-1 justify-end">
                          <button
                            onClick={() => handleRefreshGsc(k.id)}
                            disabled={refreshingIds.has(k.id)}
                            title="Rafraîchir les données GSC pour ce mot-clé (latence ~2 jours)"
                            className="p-2 hover:bg-white hover:shadow-sm rounded-lg text-slate-400 hover:text-indigo-600 transition-all border border-transparent hover:border-slate-100 disabled:opacity-50"
                          >
                            {refreshingIds.has(k.id)
                              ? <Loader2 className="w-5 h-5 animate-spin" />
                              : <RefreshCw className="w-5 h-5" />
                            }
                          </button>
                          <button
                            onClick={() => handleUntrack(k.id)}
                            disabled={untrackingId === k.id}
                            title="Arrêter le suivi"
                            className="p-2 hover:bg-white hover:shadow-sm rounded-lg text-slate-400 hover:text-red-600 transition-all border border-transparent hover:border-slate-100 disabled:opacity-50"
                          >
                            {untrackingId === k.id
                              ? <Loader2 className="w-5 h-5 animate-spin" />
                              : <EyeOff className="w-5 h-5" />
                            }
                          </button>
                        </div>
                      </td>
                    </motion.tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Toast de refresh GSC (loading / success / error) — bas-droite, auto-disparait */}
        <AnimatePresence>
          {refreshToast && (
            <motion.div
              key={`${refreshToast.keyword}-${refreshToast.phase}`}
              initial={{ opacity: 0, y: 20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 20, scale: 0.95 }}
              transition={{ duration: 0.2 }}
              className="fixed bottom-6 right-6 z-50 min-w-[280px] max-w-sm bg-white rounded-xl shadow-2xl border border-slate-200 overflow-hidden"
            >
              <div className={`h-1 ${
                refreshToast.phase === "loading"
                  ? "bg-indigo-500"
                  : refreshToast.phase === "success"
                  ? "bg-emerald-500"
                  : "bg-red-500"
              }`} />
              <div className="p-4 flex items-start gap-3">
                <div className="shrink-0 mt-0.5">
                  {refreshToast.phase === "loading" && <Loader2 className="w-5 h-5 text-indigo-500 animate-spin" />}
                  {refreshToast.phase === "success" && <CheckCircle2 className="w-5 h-5 text-emerald-500" />}
                  {refreshToast.phase === "error" && <XCircle className="w-5 h-5 text-red-500" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-bold text-slate-900">
                    {refreshToast.phase === "loading" && "Mise à jour en cours"}
                    {refreshToast.phase === "success" && "Données actualisées"}
                    {refreshToast.phase === "error" && "Échec de la mise à jour"}
                  </div>
                  <div className="text-xs text-slate-500 truncate mt-0.5">
                    {refreshToast.keyword}
                  </div>
                  {refreshToast.phase === "success" && refreshToast.stats && (
                    <div className="text-xs text-slate-600 mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5">
                      <span><span className="font-semibold text-slate-900">{refreshToast.stats.days}</span> jours</span>
                      <span><span className="font-semibold text-slate-900">{formatNum(refreshToast.stats.clicks)}</span> clics</span>
                      <span><span className="font-semibold text-slate-900">{formatNum(refreshToast.stats.impressions)}</span> impressions</span>
                    </div>
                  )}
                  {refreshToast.phase === "error" && refreshToast.message && (
                    <div className="text-xs text-red-600 mt-1">{refreshToast.message}</div>
                  )}
                </div>
                <button
                  onClick={() => setRefreshToast(null)}
                  className="shrink-0 p-1 -mr-1 -mt-1 text-slate-400 hover:text-slate-600 rounded"
                  aria-label="Fermer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Action hint footer */}
        {!loading && filteredData.some((k) => k.action_hint) && (
          <div className="p-6 border-t border-slate-50 bg-slate-50/30">
            <div className="flex items-center gap-2 text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">
              <Zap className="w-3.5 h-3.5 text-indigo-500" />
              Actions recommandées par l'IA
            </div>
            <div className="space-y-2">
              {filteredData
                .filter((k) => k.action_hint)
                .slice(0, 3)
                .map((k) => (
                  <div key={k.id} className="flex items-start gap-3 text-xs text-slate-600">
                    <span className="font-bold text-slate-900 shrink-0">{k.keyword}:</span>
                    <span>{k.action_hint}</span>
                  </div>
                ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
