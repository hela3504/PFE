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
};

export default function Opportunities() {
  const [data, setData] = useState<OpportunityRow[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState("");
  const [minVolume, setMinVolume] = useState("");
  const [maxCompetition, setMaxCompetition] = useState("");
  const [onlyPositiveTrend, setOnlyPositiveTrend] = useState(false);
  const [excludeBranded, setExcludeBranded] = useState(false);

  const [selectedKeyword, setSelectedKeyword] = useState<OpportunityRow | null>(null);
  const [qualificationResult, setQualificationResult] = useState<any | null>(null);
  const [isQualifying, setIsQualifying] = useState(false);

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

      const json = await res.json();
      setData(Array.isArray(json) ? json : []);
    } catch (error) {
      console.error("fetchData error:", error);
      setData([]);
    } finally {
      setLoading(false);
    }
  };

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
        (keyword.keyword.split(" ").length > 3 ? 1 : 0),
    };

    try {
      const result = await qualifyKeywords(keyword.projectId, [input], date);
      if (result && result.results && result.results.length > 0) {
        setQualificationResult(result.results[0]);
      }
    } catch (error) {
      console.error("Qualification error:", error);
    } finally {
      setIsQualifying(false);
    }
  };

  const filteredData = useMemo(() => {
    return data.filter((k) => {
      const matchesSearch = k.keyword
        .toLowerCase()
        .includes(search.trim().toLowerCase());

      const matchesMinVolume =
        minVolume === "" || Number(k.volume || 0) >= Number(minVolume);

      const matchesMaxCompetition =
        maxCompetition === "" ||
        Number(k.competition || 0) <= Number(maxCompetition);

      const matchesTrend = !onlyPositiveTrend || Number(k.trend || 0) > 0;

      const matchesBranded =
        !excludeBranded ||
        !String(k.branded_status || "")
          .toLowerCase()
          .includes("branded");

      return (
        matchesSearch &&
        matchesMinVolume &&
        matchesMaxCompetition &&
        matchesTrend &&
        matchesBranded
      );
    });
  }, [data, search, minVolume, maxCompetition, onlyPositiveTrend, excludeBranded]);

  const scatterData = filteredData.map((k) => ({
    x: Number((k.competition || 0) * 100),
    y: Number(k.volume || 0),
    z: Math.max(40, Math.abs((k.trend || 0) * 200)),
    name: k.keyword,
    score: Number(k.opportunity_score || 0),
  }));

  const topOpportunity = filteredData[0];

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

  const resetFilters = () => {
    setSearch("");
    setMinVolume("");
    setMaxCompetition("");
    setOnlyPositiveTrend(false);
    setExcludeBranded(false);
  };

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      <div className="flex items-center justify-between gap-6 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight">
            Opportunités
          </h1>
          <p className="text-slate-500 mt-1">
            Priorisation automatique basée sur volume, compétition et potentiel CTR.
          </p>
        </div>

        <div className="flex items-center gap-4 flex-wrap">
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
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 bg-white rounded-[2.5rem] border border-slate-100 shadow-sm overflow-hidden flex flex-col">
          <div className="p-6 border-b border-slate-50 bg-slate-50/50 space-y-4">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-4 flex-wrap">
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

                <div className="flex items-center gap-2 px-4 py-2 text-slate-600 bg-white border border-slate-200 rounded-xl text-sm font-medium">
                  <Filter className="w-4 h-4" />
                  Filtres
                </div>
              </div>

              <button
                onClick={resetFilters}
                className="text-sm font-medium text-slate-500 hover:text-slate-900"
              >
                Réinitialiser
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

              <label className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-xl text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={onlyPositiveTrend}
                  onChange={(e) => setOnlyPositiveTrend(e.target.checked)}
                />
                Trend positif
              </label>

              <label className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-xl text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={excludeBranded}
                  onChange={(e) => setExcludeBranded(e.target.checked)}
                />
                Exclure branded
              </label>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="text-slate-400 text-[10px] uppercase tracking-wider font-bold">
                  <th className="px-6 py-4">Keyword</th>
                  <th className="px-6 py-4">Volume</th>
                  <th className="px-6 py-4">Position</th>
                  <th className="px-6 py-4">Compétition</th>
                  <th className="px-6 py-4">Trend</th>
                  <th className="px-6 py-4 text-right">Opportunity Score</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-slate-50">
                {loading ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-10 text-center text-slate-400">
                      Chargement...
                    </td>
                  </tr>
                ) : filteredData.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-10 text-center text-slate-400">
                      Aucune opportunité trouvée.
                    </td>
                  </tr>
                ) : (
                  filteredData.map((k) => (
                    <tr
                      key={k.id}
                      onClick={() => handleQualify(k)}
                      className="hover:bg-slate-50/50 transition-colors group cursor-pointer"
                    >
                      <td className="px-6 py-4">
                        <div className="font-bold text-slate-900 group-hover:text-indigo-600 transition-colors">
                          {k.keyword}
                        </div>
                        <div className="flex items-center gap-2 mt-1 flex-wrap">
                          <span className="text-[10px] text-slate-400 uppercase font-bold tracking-tighter">
                            {k.search_intent || "N/A"}
                          </span>
                          {k.branded_status && (
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 font-bold uppercase">
                              {String(k.branded_status).replace("_", " ")}
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
                            className={`w-3 h-3 ${
                              Number(k.trend || 0) > 0 ? "" : "rotate-180"
                            }`}
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
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="space-y-8">
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

          <div className="bg-slate-900 p-8 rounded-[2.5rem] text-white overflow-hidden relative group">
            <div className="relative z-10">
              <div className="text-indigo-400 font-bold text-xs uppercase tracking-widest mb-2">
                IA Insights
              </div>
              <h4 className="text-xl font-bold mb-4">Lecture décisionnelle</h4>
              <p className="text-slate-400 text-sm leading-relaxed mb-6">
                L’objectif est de concentrer les efforts SEO sur les mots-clés à meilleur
                rendement potentiel : bon volume, concurrence acceptable et marge
                d’amélioration mesurable.
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
              className="relative w-full max-w-2xl bg-white rounded-[3rem] shadow-2xl overflow-hidden"
            >
              <div className="p-8 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
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

              <div className="p-10">
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
                    <div className="bg-indigo-600 rounded-3xl p-6 text-white shadow-xl shadow-indigo-100 flex items-center justify-between">
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
                          Priorité: {qualificationResult.priority_level}
                        </div>
                      </div>
                    </div>

                    <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-4 flex items-center gap-3">
                      <Zap className="w-5 h-5 text-emerald-600" />
                      <div>
                        <div className="text-[10px] text-emerald-600 uppercase font-bold tracking-wider">
                          Action Recommandée
                        </div>
                        <div className="text-sm font-bold text-slate-900">
                          {qualificationResult.action_hint}
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-6">
                      <div className="p-5 bg-slate-50 rounded-2xl border border-slate-100">
                        <div className="flex items-center gap-2 text-slate-400 mb-2">
                          <ShieldCheck className="w-4 h-4" />
                          <span className="text-[10px] uppercase font-bold tracking-wider">
                            Branding
                          </span>
                        </div>
                        <div className="text-lg font-bold text-slate-900 capitalize">
                          {qualificationResult.branded_status?.replace("_", " ")}
                        </div>
                      </div>

                      <div className="p-5 bg-slate-50 rounded-2xl border border-slate-100">
                        <div className="flex items-center gap-2 text-slate-400 mb-2">
                          <Activity className="w-4 h-4" />
                          <span className="text-[10px] uppercase font-bold tracking-wider">
                            Stabilité
                          </span>
                        </div>
                        <div className="text-lg font-bold text-slate-900 capitalize">
                          {qualificationResult.stability_status}
                        </div>
                      </div>

                      <div className="p-5 bg-slate-50 rounded-2xl border border-slate-100">
                        <div className="flex items-center gap-2 text-slate-400 mb-2">
                          <Zap className="w-4 h-4" />
                          <span className="text-[10px] uppercase font-bold tracking-wider">
                            Type de Traîne
                          </span>
                        </div>
                        <div className="text-lg font-bold text-slate-900 capitalize">
                          {qualificationResult.tail_type?.replace("_", " ")}
                        </div>
                      </div>

                      <div className="p-5 bg-slate-50 rounded-2xl border border-slate-100">
                        <div className="flex items-center gap-2 text-slate-400 mb-2">
                          <AlertCircle className="w-4 h-4" />
                          <span className="text-[10px] uppercase font-bold tracking-wider">
                            Exclure de l'Analyse
                          </span>
                        </div>
                        <div
                          className={`text-lg font-bold ${
                            qualificationResult.exclude_from_opportunity
                              ? "text-red-600"
                              : "text-emerald-600"
                          }`}
                        >
                          {qualificationResult.exclude_from_opportunity ? "Oui" : "Non"}
                        </div>
                      </div>
                    </div>

                    <div className="space-y-3">
                      <h4 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                        <BarChart className="w-4 h-4 text-indigo-600" />
                        Interprétation des KPIs
                      </h4>

                      <div className="grid grid-cols-1 gap-2">
                        {Object.entries(
                          qualificationResult.kpi_interpretation || {}
                        ).map(([key, value]) => (
                          <div
                            key={key}
                            className="flex items-start gap-3 p-3 bg-slate-50 rounded-xl border border-slate-100"
                          >
                            <div className="text-[10px] font-bold text-slate-400 uppercase w-32 shrink-0 mt-1">
                              {key.replace("_", " ")}
                            </div>
                            <div className="text-xs text-slate-600 leading-relaxed">
                              {value as string}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-3">
                      <h4 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                        <Info className="w-4 h-4 text-indigo-600" />
                        Raisonnement Stratégique
                      </h4>
                      <div className="bg-slate-900 rounded-3xl p-6 text-slate-300 text-sm leading-relaxed border border-slate-800">
                        {qualificationResult.reasoning}
                      </div>
                    </div>
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