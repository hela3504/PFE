import { useState, useEffect, useMemo } from "react";
import {
  TrendingUp,
  Users,
  MousePointer2,
  BarChart3,
  ChevronDown,
  Sparkles,
  Loader2,
  Briefcase,
  CheckCircle2,
  Layers,
  RefreshCw,
  Target,
  X as CloseIcon,
} from "lucide-react";
import {
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  Legend,
  AreaChart,
  Area,
} from "recharts";
import { motion } from "motion/react";
import { getDashboardInterpretation } from "../services/aiService";
import { useSelectedProject } from "../hooks/useSelectedProject";
import Markdown from "react-markdown";

const COLORS = ["#2563eb", "#10b981", "#f59e0b", "#ef4444"];

// Expected CTR per SERP position (AWR/Sistrix benchmark — same table as backend computeCtrGap)
const EXPECTED_CTR: Record<number, number> = {
  1: 0.28, 2: 0.15, 3: 0.11, 4: 0.08, 5: 0.07,
  6: 0.05, 7: 0.04, 8: 0.03, 9: 0.03, 10: 0.03,
};
const expectedCtrFor = (pos: number) => {
  if (pos <= 0) return 0;
  if (pos <= 10) return EXPECTED_CTR[Math.round(pos)] ?? 0.03;
  if (pos <= 20) return 0.02;
  return 0.01;
};

// Backend renvoie "Branded"/"Non-branded" (case SQL en dur) — on traduit côté front.
const BRAND_LABEL: Record<string, string> = {
  "Branded":     "De marque",
  "Non-branded": "Générique",
};

// Strategic SERP buckets — labels + colors used by the position distribution chart
const POSITION_BUCKETS = [
  { name: "Top 3",    subtitle: "Excellent",         range: (p: number) => p > 0 && p <= 3,  color: "#10b981" },
  { name: "Pos 4-10", subtitle: "Forte opportunité", range: (p: number) => p > 3 && p <= 10, color: "#22d3ee" },
  { name: "Pos 11-20",subtitle: "À booster",         range: (p: number) => p > 10 && p <= 20,color: "#2563eb" },
  { name: "Pos 21-50",subtitle: "Faible visibilité", range: (p: number) => p > 20 && p <= 50,color: "#f59e0b" },
  { name: "50+",      subtitle: "Invisible",         range: (p: number) => p > 50,           color: "#ef4444" },
] as const;

type Project = {
  id: number;
  name: string;
};

type DashboardKeyword = {
  id: number;
  keyword: string;
  position?: number;
  prev_position?: number;
  impressions?: number;
  ctr?: number;
  prev_ctr?: number;
  trend?: number;
  status?: string;
  type?: string;
  intent?: string;
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

type DashboardResponse = {
  kpis: {
    totalKeywords: number;
    organicTraffic: number;
    avgCtr: number;
    avgPosition: number;
  };
  charts: {
    trafficTrend: { name: string; traffic: number }[];
    brandedSplit: { name: string; value: number; count?: number }[];
  };
  alerts: {
    strongDrop: number;
    toWatch: number;
    opportunities: number;
  };
  keywords: DashboardKeyword[];
};

export default function Dashboard() {
  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useSelectedProject();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [aiInterpretation, setAiInterpretation] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [actionPlan, setActionPlan] = useState<any[]>([]);
  const [actionPlanLoading, setActionPlanLoading] = useState(false);
  const [clusters, setClusters] = useState<any[]>([]);
  const [clusteringLoading, setClusteringLoading] = useState(false);
  const [selectedBucket, setSelectedBucket] = useState<string | null>(null);

  useEffect(() => {
    fetchProjects();
  }, []);

  useEffect(() => {
    fetchDashboard();
  }, [selectedProjectId]);

  useEffect(() => {
    if (selectedProjectId) {
      fetchActionPlan();
      fetchClusters();
    } else {
      setActionPlan([]);
      setClusters([]);
    }
  }, [selectedProjectId]);

  const fetchProjects = async () => {
    try {
      const res = await fetch("/api/projects", {
        headers: {
          Authorization: `Bearer ${localStorage.getItem("token")}`,
        },
      });
      const data = await res.json();
      setProjects(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error("fetchProjects error:", error);
      setProjects([]);
    }
  };

  const fetchDashboard = async () => {
    setLoading(true);
    setError(null);
    try {
      const url = selectedProjectId
        ? `/api/dashboard?projectId=${selectedProjectId}`
        : "/api/dashboard";

      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${localStorage.getItem("token")}`,
        },
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Erreur ${res.status}`);
      }

      const json = await res.json();
      setDashboard(json);
      setAiInterpretation(null);
    } catch (err: any) {
      console.error("fetchDashboard error:", err);
      setDashboard(null);
      setError(err?.message || "Impossible de charger le tableau de bord.");
    } finally {
      setLoading(false);
    }
  };

  const fetchActionPlan = async () => {
    if (!selectedProjectId) return;
    setActionPlanLoading(true);
    setActionPlan([]); // clear stale rows from previous project so the spinner is the only thing on screen
    try {
      const res = await fetch(`/api/projects/${selectedProjectId}/action-plan`, {
        headers: {
          Authorization: `Bearer ${localStorage.getItem("token")}`,
        },
      });
      const json = await res.json();
      setActionPlan(Array.isArray(json) ? json : []);
    } catch (error) {
      console.error("fetchActionPlan error:", error);
      setActionPlan([]);
    } finally {
      setActionPlanLoading(false);
    }
  };

  const fetchClusters = async () => {
    if (!selectedProjectId) return;
    try {
      const res = await fetch(`/api/projects/${selectedProjectId}/clusters`, {
        headers: {
          Authorization: `Bearer ${localStorage.getItem("token")}`,
        },
      });
      const json = await res.json();
      setClusters(Array.isArray(json) ? json : []);
    } catch (error) {
      console.error("fetchClusters error:", error);
      setClusters([]);
    }
  };

  const generateInterpretation = async () => {
    if (!dashboard) return;
    setAiLoading(true);
    try {
      const interpretation = await getDashboardInterpretation(stats, dashboard.keywords || []);
      setAiInterpretation(interpretation || null);
    } catch (error) {
      console.error("generateInterpretation error:", error);
      setAiInterpretation("Impossible de générer l’analyse IA pour le moment.");
    } finally {
      setAiLoading(false);
    }
  };

  const handleCluster = async () => {
    if (!selectedProjectId) return;
    setClusteringLoading(true);
    try {
      await fetch(`/api/projects/${selectedProjectId}/cluster`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${localStorage.getItem("token")}`,
        },
      });
      await fetchClusters();
    } catch (error) {
      console.error("cluster error:", error);
    } finally {
      setClusteringLoading(false);
    }
  };

  const formatTraffic = (value: number) => {
    if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
    if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
    return String(value || 0);
  };

  const stats = useMemo(() => {
    const kpis = dashboard?.kpis || {
      totalKeywords: 0,
      organicTraffic: 0,
      avgCtr: 0,
      avgPosition: 0,
    };

    return [
      {
        label: "Mots-clés extraits",
        value: kpis.totalKeywords,
        icon: BarChart3,
        color: "text-indigo-600",
        bg: "bg-indigo-50",
      },
      {
        label: "Trafic organique",
        value: formatTraffic(kpis.organicTraffic),
        icon: Users,
        color: "text-blue-600",
        bg: "bg-blue-50",
      },
      {
        label: "CTR global",
        value: `${Number(kpis.avgCtr || 0).toFixed(2)}%`,
        icon: MousePointer2,
        color: "text-emerald-600",
        bg: "bg-emerald-50",
      },
      {
        label: "Position moyenne",
        value: Number(kpis.avgPosition || 0).toFixed(2),
        icon: TrendingUp,
        color: "text-amber-600",
        bg: "bg-amber-50",
      },
    ];
  }, [dashboard]);

  // 30-day organic clicks evolution (from /api/dashboard charts.trafficTrend)
  const trafficTrend = dashboard?.charts?.trafficTrend || [];

  // Position distribution: bucket every tracked keyword by SERP position,
  // current vs previous. Bars are clickable to drill into the bucket.
  const positionDistribution = useMemo(() => {
    const kws = dashboard?.keywords || [];
    return POSITION_BUCKETS.map((b) => ({
      name:     b.name,
      subtitle: b.subtitle,
      current:  kws.filter((k) => b.range(Number(k.position ?? 0))).length,
      previous: kws.filter((k) => b.range(Number(k.prev_position ?? 0))).length,
      color:    b.color,
    }));
  }, [dashboard]);

  // Net movement into the Top 10 vs previous period (KPI badge on the chart)
  const top10Delta = useMemo(() => {
    const kws = dashboard?.keywords || [];
    const inTop10 = (p: number) => p > 0 && p <= 10;
    const now  = kws.filter((k) => inTop10(Number(k.position ?? 0))).length;
    const prev = kws.filter((k) => inTop10(Number(k.prev_position ?? 0))).length;
    return { now, prev, diff: now - prev };
  }, [dashboard]);

  // Drill-down: keywords in the selected bucket, ranked by impressions
  const drillKeywords = useMemo(() => {
    if (!selectedBucket) return [];
    const bucket = POSITION_BUCKETS.find((b) => b.name === selectedBucket);
    if (!bucket) return [];
    return (dashboard?.keywords || [])
      .filter((k) => bucket.range(Number(k.position ?? 0)))
      .sort((a, b) => Number(b.impressions ?? 0) - Number(a.impressions ?? 0))
      .slice(0, 30);
  }, [selectedBucket, dashboard]);

  // Per-bucket actual vs expected CTR (impression-weighted, %)
  const ctrByPosition = useMemo(() => {
    const kws = dashboard?.keywords || [];
    return POSITION_BUCKETS.slice(0, 4).map((b) => {
      const inBucket = kws.filter((k) => b.range(Number(k.position ?? 0)));
      const totalImp = inBucket.reduce((s, k) => s + Number(k.impressions ?? 0), 0);
      const actual = totalImp > 0
        ? inBucket.reduce((s, k) => s + Number(k.ctr ?? 0) * Number(k.impressions ?? 0), 0) / totalImp
        : 0;
      const expected = totalImp > 0
        ? inBucket.reduce((s, k) => s + expectedCtrFor(Number(k.position ?? 0)) * Number(k.impressions ?? 0), 0) / totalImp
        : 0;
      return {
        name: b.name,
        actual:   Math.round(actual * 10000) / 100,
        expected: Math.round(expected * 10000) / 100,
        gap:      Math.round((actual - expected) * 10000) / 100,
        count:    inBucket.length,
      };
    });
  }, [dashboard]);

  // Global aggregate (the hero numbers asked for: Actual / Expected / Gap)
  const ctrAggregate = useMemo(() => {
    const kws = (dashboard?.keywords || []).filter((k) => Number(k.position ?? 0) > 0);
    const totalImp = kws.reduce((s, k) => s + Number(k.impressions ?? 0), 0);
    if (totalImp === 0) return { actual: 0, expected: 0, gap: 0 };
    const actual = kws.reduce((s, k) => s + Number(k.ctr ?? 0) * Number(k.impressions ?? 0), 0) / totalImp;
    const expected = kws.reduce((s, k) => s + expectedCtrFor(Number(k.position ?? 0)) * Number(k.impressions ?? 0), 0) / totalImp;
    return {
      actual:   Math.round(actual * 10000) / 100,
      expected: Math.round(expected * 10000) / 100,
      gap:      Math.round((actual - expected) * 10000) / 100,
    };
  }, [dashboard]);

  const pieData = (dashboard?.charts?.brandedSplit || []).map((item) => ({
    ...item,
    name: BRAND_LABEL[item.name] ?? item.name,
  }));

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto min-h-[400px] flex items-center justify-center">
        <div className="flex items-center gap-3 text-slate-500 font-medium">
          <Loader2 className="w-5 h-5 animate-spin" />
          Chargement du tableau de bord...
        </div>
      </div>
    );
  }

  if (error && !dashboard) {
    return (
      <div className="max-w-7xl mx-auto min-h-[300px] flex items-center justify-center">
        <div className="bg-red-50 border border-red-200 rounded-3xl px-8 py-6 text-center max-w-md">
          <div className="text-red-700 font-bold mb-2">Impossible de charger le tableau de bord</div>
          <p className="text-red-600 text-sm mb-4">{error}</p>
          <button
            onClick={fetchDashboard}
            className="inline-flex items-center gap-2 px-4 py-2 bg-red-600 text-white text-sm font-bold rounded-xl hover:bg-red-700"
          >
            Réessayer
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Tableau de bord global</h1>
          <p className="text-slate-500 mt-1">Vue d'ensemble de vos performances SEO.</p>
        </div>
        <div className="flex items-center gap-3">
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
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {stats.map((stat, i) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.1 }}
            className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm"
          >
            <div className="flex items-center justify-between mb-4">
              <div className={`w-12 h-12 ${stat.bg} rounded-2xl flex items-center justify-center`}>
                <stat.icon className={`w-6 h-6 ${stat.color}`} />
              </div>
            </div>
            <div className="text-2xl font-bold text-slate-900">{stat.value}</div>
            <div className="text-sm text-slate-500 font-medium mt-1">{stat.label}</div>
          </motion.div>
        ))}
      </div>

      {/* ── Organic Traffic Evolution (30 days) ─────────────────────────────── */}
      <div className="bg-white p-8 rounded-[2.5rem] border border-slate-100 shadow-sm">
        <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
          <div>
            <h3 className="text-xl font-bold text-slate-900">Évolution du trafic organique</h3>
            <p className="text-sm text-slate-500 mt-1">Clics organiques sur les 30 derniers jours.</p>
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 bg-indigo-50 border border-indigo-100 rounded-xl">
            <div className="w-2.5 h-2.5 bg-indigo-500 rounded-full" />
            <span className="text-xs font-bold text-indigo-700 uppercase tracking-wider">Clics</span>
          </div>
        </div>

        {trafficTrend.length === 0 ? (
          <div className="h-[260px] flex items-center justify-center text-slate-400 text-sm">
            Pas encore de données GSC.
          </div>
        ) : (
          <div className="h-[260px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trafficTrend} margin={{ top: 10, right: 10, bottom: 0, left: -10 }}>
                <defs>
                  <linearGradient id="colorTraffic" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#2563eb" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="#2563eb" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis
                  dataKey="name"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: "#94a3b8", fontSize: 11 }}
                  dy={8}
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: "#94a3b8", fontSize: 11 }}
                  allowDecimals={false}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#fff",
                    borderRadius: "12px",
                    border: "1px solid #e2e8f0",
                    boxShadow: "0 10px 15px -3px rgb(0 0 0 / 0.08)",
                  }}
                  cursor={{ stroke: "#2563eb", strokeWidth: 1, strokeDasharray: "3 3" }}
                  formatter={(v: any) => [`${v} clics`, "Trafic"]}
                />
                <Area
                  type="monotone"
                  dataKey="traffic"
                  stroke="#2563eb"
                  strokeWidth={2.5}
                  fill="url(#colorTraffic)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 bg-white p-8 rounded-[2.5rem] border border-slate-100 shadow-sm">
          <div className="flex items-center justify-between mb-2 flex-wrap gap-3">
            <div>
              <h3 className="text-xl font-bold text-slate-900">Distribution des positions SERP</h3>
              <p className="text-sm text-slate-500 mt-1">
                Combien de mots-clés se classent dans chaque tranche, comparé à la période précédente.
              </p>
            </div>
            <div
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold border ${
                top10Delta.diff > 0
                  ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                  : top10Delta.diff < 0
                  ? "bg-red-50 text-red-700 border-red-200"
                  : "bg-slate-50 text-slate-600 border-slate-200"
              }`}
              title="Variation du nombre de mots-clés dans le Top 10 vs période précédente"
            >
              <TrendingUp className={`w-4 h-4 ${top10Delta.diff < 0 ? "rotate-180" : ""}`} />
              {top10Delta.diff > 0 ? "+" : ""}
              {top10Delta.diff} dans le Top 10
              <span className="text-xs font-medium opacity-70 ml-1">
                ({top10Delta.prev} → {top10Delta.now})
              </span>
            </div>
          </div>

          <div className="h-[300px] w-full mt-6">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={positionDistribution} barGap={6} margin={{ top: 10, right: 10, bottom: 0, left: -10 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis
                  dataKey="name"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: "#64748b", fontSize: 12, fontWeight: 600 }}
                  dy={8}
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: "#94a3b8", fontSize: 12 }}
                  allowDecimals={false}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#fff",
                    borderRadius: "12px",
                    border: "1px solid #e2e8f0",
                    boxShadow: "0 10px 15px -3px rgb(0 0 0 / 0.08)",
                  }}
                  cursor={{ fill: "#f8fafc" }}
                  labelFormatter={(label) => {
                    const b = POSITION_BUCKETS.find((x) => x.name === label);
                    return b ? `${label} — ${b.subtitle}` : String(label);
                  }}
                />
                <Legend
                  iconType="circle"
                  wrapperStyle={{ paddingTop: 12, fontSize: 12 }}
                  formatter={(value) => (
                    <span className="text-slate-600 font-medium">
                      {value === "current" ? "Aujourd'hui" : "Période précédente"}
                    </span>
                  )}
                />
                <Bar
                  dataKey="previous"
                  name="previous"
                  fill="#cbd5e1"
                  radius={[8, 8, 0, 0]}
                  onClick={(d: any) => setSelectedBucket(d?.name ?? null)}
                  style={{ cursor: "pointer" }}
                />
                <Bar
                  dataKey="current"
                  name="current"
                  radius={[8, 8, 0, 0]}
                  onClick={(d: any) => setSelectedBucket(d?.name ?? null)}
                  style={{ cursor: "pointer" }}
                >
                  {positionDistribution.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Strategic legend — colored chips with subtitle */}
          <div className="mt-4 flex flex-wrap gap-2">
            {POSITION_BUCKETS.map((b) => (
              <button
                key={b.name}
                onClick={() => setSelectedBucket(b.name)}
                className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-bold border transition-all ${
                  selectedBucket === b.name
                    ? "bg-slate-900 text-white border-slate-900"
                    : "bg-white text-slate-600 border-slate-200 hover:border-slate-300"
                }`}
              >
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: b.color }} />
                {b.name}
                <span className={`font-medium ${selectedBucket === b.name ? "text-slate-300" : "text-slate-400"}`}>
                  · {b.subtitle}
                </span>
              </button>
            ))}
          </div>

          {/* Drill-down panel */}
          {selectedBucket && (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-6 border-t border-slate-100 pt-6"
            >
              <div className="flex items-center justify-between mb-3">
                <div>
                  <div className="text-sm font-bold text-slate-900">
                    Mots-clés en {selectedBucket}
                    <span className="text-slate-400 font-medium ml-1">
                      ({drillKeywords.length})
                    </span>
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    Triés par impressions — cliquez sur "Suivre" depuis Opportunités pour les surveiller.
                  </div>
                </div>
                <button
                  onClick={() => setSelectedBucket(null)}
                  className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-slate-700 transition-all"
                >
                  <CloseIcon className="w-4 h-4" />
                </button>
              </div>

              {drillKeywords.length === 0 ? (
                <div className="py-6 text-center text-xs text-slate-400">Aucun mot-clé dans cette tranche.</div>
              ) : (
                <div className="space-y-1.5 max-h-[260px] overflow-y-auto pr-1">
                  {drillKeywords.map((k) => (
                    <div
                      key={k.id}
                      className="flex items-center justify-between gap-3 px-3 py-2 rounded-xl hover:bg-slate-50 transition-colors"
                    >
                      <div className="font-medium text-sm text-slate-900 truncate flex-1">
                        {k.keyword}
                      </div>
                      <div className="flex items-center gap-3 text-xs text-slate-500 shrink-0">
                        <span className="font-bold text-slate-700">
                          #{Number(k.position ?? 0).toFixed(0)}
                        </span>
                        <span>{Number(k.impressions ?? 0).toLocaleString("fr-FR")} imp.</span>
                        <span>{((Number(k.ctr ?? 0)) * 100).toFixed(1)}% CTR</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </motion.div>
          )}
        </div>

        <div className="bg-white p-8 rounded-[2.5rem] border border-slate-100 shadow-sm">
          <h3 className="text-xl font-bold text-slate-900 mb-8">Répartition par marque</h3>
          <div className="h-[250px] w-full flex items-center justify-center">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={pieData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={80}
                  paddingAngle={5}
                  dataKey="value"
                >
                  {pieData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>

          <div className="space-y-4 mt-4">
            {pieData.map((item, i) => (
              <div key={item.name} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: COLORS[i] }} />
                  <span className="text-sm font-medium text-slate-600">{item.name}</span>
                </div>
                <span className="text-sm font-bold text-slate-900">{item.value}%</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── CTR Actuel vs CTR Attendu ──────────────────────────────────────── */}
      <div className="bg-white p-8 rounded-[2.5rem] border border-slate-100 shadow-sm">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center text-white shadow-lg shadow-indigo-200">
            <Target className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-xl font-bold text-slate-900">CTR Actuel vs CTR Attendu</h3>
            <p className="text-sm text-slate-500 mt-0.5">
              Identifie les positions où le snippet sous-performe (titre, méta-description, intent à optimiser).
            </p>
          </div>
        </div>

        {/* Hero KPIs */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6">
          <div className="p-5 rounded-2xl bg-slate-50 border border-slate-100">
            <div className="text-[10px] uppercase font-bold tracking-wider text-slate-500 mb-1">CTR Actuel</div>
            <div className="text-3xl font-bold text-slate-900">{ctrAggregate.actual.toFixed(2)}%</div>
            <div className="text-xs text-slate-500 mt-1">Pondéré par impressions</div>
          </div>
          <div className="p-5 rounded-2xl bg-indigo-50 border border-indigo-100">
            <div className="text-[10px] uppercase font-bold tracking-wider text-indigo-600 mb-1">CTR Attendu</div>
            <div className="text-3xl font-bold text-indigo-700">{ctrAggregate.expected.toFixed(2)}%</div>
            <div className="text-xs text-indigo-600/70 mt-1">Benchmark AWR/Sistrix par position</div>
          </div>
          <div
            className={`p-5 rounded-2xl border ${
              ctrAggregate.gap >= 0
                ? "bg-emerald-50 border-emerald-100"
                : ctrAggregate.gap >= -2
                ? "bg-amber-50 border-amber-100"
                : "bg-red-50 border-red-100"
            }`}
          >
            <div
              className={`text-[10px] uppercase font-bold tracking-wider mb-1 ${
                ctrAggregate.gap >= 0
                  ? "text-emerald-600"
                  : ctrAggregate.gap >= -2
                  ? "text-amber-600"
                  : "text-red-600"
              }`}
            >
              Écart de CTR
            </div>
            <div
              className={`text-3xl font-bold ${
                ctrAggregate.gap >= 0
                  ? "text-emerald-700"
                  : ctrAggregate.gap >= -2
                  ? "text-amber-700"
                  : "text-red-700"
              }`}
            >
              {ctrAggregate.gap > 0 ? "+" : ""}
              {ctrAggregate.gap.toFixed(2)}%
            </div>
            <div className="text-xs text-slate-500 mt-1">
              {ctrAggregate.gap >= 0
                ? "Snippet performant"
                : ctrAggregate.gap >= -2
                ? "Légèrement sous-performant"
                : "Optimiser titre / méta / intent"}
            </div>
          </div>
        </div>

        {/* Per-bucket bar chart */}
        <div className="h-[260px] w-full mt-6">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={ctrByPosition} barGap={6} margin={{ top: 10, right: 10, bottom: 0, left: -10 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
              <XAxis
                dataKey="name"
                axisLine={false}
                tickLine={false}
                tick={{ fill: "#64748b", fontSize: 12, fontWeight: 600 }}
                dy={8}
              />
              <YAxis
                axisLine={false}
                tickLine={false}
                tick={{ fill: "#94a3b8", fontSize: 12 }}
                tickFormatter={(v) => `${v}%`}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "#fff",
                  borderRadius: "12px",
                  border: "1px solid #e2e8f0",
                  boxShadow: "0 10px 15px -3px rgb(0 0 0 / 0.08)",
                }}
                cursor={{ fill: "#f8fafc" }}
                formatter={(v: any, name: any) => [`${v}%`, name === "actual" ? "Actuel" : "Attendu"]}
              />
              <Legend
                iconType="circle"
                wrapperStyle={{ paddingTop: 12, fontSize: 12 }}
                formatter={(value) => (
                  <span className="text-slate-600 font-medium">
                    {value === "actual" ? "CTR actuel" : "CTR attendu"}
                  </span>
                )}
              />
              <Bar dataKey="expected" name="expected" fill="#bfdbfe" radius={[8, 8, 0, 0]} />
              <Bar dataKey="actual"   name="actual"   fill="#2563eb" radius={[8, 8, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="bg-white p-8 rounded-[2.5rem] border border-slate-100 shadow-sm overflow-hidden relative group">
        <div className="flex items-center justify-between mb-6 relative z-10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center text-white shadow-lg shadow-indigo-200">
              <Sparkles className="w-5 h-5" />
            </div>
            <h3 className="text-xl font-bold text-slate-900">Interprétation IA</h3>
          </div>
          <button
            onClick={generateInterpretation}
            disabled={aiLoading || !dashboard}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-50 text-indigo-600 rounded-xl text-sm font-bold hover:bg-indigo-100 transition-all disabled:opacity-50"
          >
            {aiLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            {aiInterpretation ? "Mettre à jour" : "Générer l'analyse"}
          </button>
        </div>

        <div className="relative z-10">
          {aiLoading ? (
            <div className="py-12 flex flex-col items-center justify-center gap-4">
              <Loader2 className="w-8 h-8 text-indigo-600 animate-spin" />
              <p className="text-slate-500 font-medium animate-pulse">Analyse des données en cours...</p>
            </div>
          ) : aiInterpretation ? (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="prose prose-slate max-w-none"
            >
              <div className="text-slate-600 leading-relaxed markdown-body">
                <Markdown>{aiInterpretation}</Markdown>
              </div>
            </motion.div>
          ) : (
            <div className="py-12 text-center">
              <p className="text-slate-400 font-medium">
                Cliquez sur le bouton pour obtenir une analyse stratégique de vos données par l'IA.
              </p>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mt-8">
          <div className="bg-white p-8 rounded-[2.5rem] border border-slate-100 shadow-sm">
            <div className="flex items-center justify-between mb-8 gap-3 flex-wrap">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 bg-emerald-100 rounded-xl flex items-center justify-center text-emerald-600 shrink-0 relative">
                  <CheckCircle2 className="w-5 h-5" />
                  {actionPlanLoading && (
                    <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-emerald-600 flex items-center justify-center shadow-md">
                      <Loader2 className="w-3 h-3 text-white animate-spin" />
                    </span>
                  )}
                </div>
                <h3 className="text-xl font-bold text-slate-900 truncate">Plan d'Action IA</h3>
              </div>
              {actionPlanLoading && (
                <motion.div
                  initial={{ opacity: 0, x: 8 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-50 border border-emerald-100 text-emerald-700 text-xs font-bold whitespace-nowrap"
                >
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Génération IA…
                </motion.div>
              )}
            </div>
            <div className="space-y-4">
              {actionPlanLoading ? (
                // Skeleton — three pulsing placeholder cards while the LLM is thinking
                <div className="space-y-3">
                  {[0, 1, 2].map((i) => (
                    <div
                      key={i}
                      className="p-4 rounded-2xl bg-slate-50 border border-slate-100 animate-pulse"
                      style={{ animationDelay: `${i * 0.15}s` }}
                    >
                      <div className="flex items-start justify-between mb-3">
                        <div className="h-4 bg-slate-200 rounded w-1/2" />
                        <div className="h-4 bg-slate-200 rounded-full w-12" />
                      </div>
                      <div className="space-y-2">
                        <div className="h-3 bg-slate-200 rounded w-full" />
                        <div className="h-3 bg-slate-200 rounded w-4/5" />
                      </div>
                    </div>
                  ))}
                  <p className="text-center text-xs text-slate-400 pt-2">
                    L'IA prépare un plan d'action priorisé pour ce projet…
                  </p>
                </div>
              ) : actionPlan.length > 0 ? (
                actionPlan.map((item, i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.1 }}
                    className="p-4 rounded-2xl bg-slate-50 border border-slate-100 hover:border-emerald-200 transition-all group"
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div className="font-bold text-slate-900 group-hover:text-emerald-600 transition-colors">
                        {item.title}
                      </div>
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider ${
                          item.priority === "High"
                            ? "bg-red-100 text-red-600"
                            : item.priority === "Medium"
                            ? "bg-amber-100 text-amber-600"
                            : "bg-blue-100 text-blue-600"
                        }`}
                      >
                        {item.priority}
                      </span>
                    </div>
                    <p className="text-sm text-slate-500 leading-relaxed">{item.description}</p>
                  </motion.div>
                ))
              ) : (
                <div className="py-12 text-center text-slate-400">
                  Sélectionnez un projet pour voir le plan d'action.
                </div>
              )}
            </div>
          </div>

          <div className="bg-white p-8 rounded-[2.5rem] border border-slate-100 shadow-sm">
            <div className="flex items-center justify-between mb-8">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-amber-100 rounded-xl flex items-center justify-center text-amber-600">
                  <Layers className="w-5 h-5" />
                </div>
                <h3 className="text-xl font-bold text-slate-900">Clusters Sémantiques</h3>
              </div>
              <button
                onClick={handleCluster}
                disabled={clusteringLoading || !selectedProjectId}
                className="p-2 bg-slate-50 text-slate-400 rounded-xl hover:bg-amber-50 hover:text-amber-600 transition-all disabled:opacity-50"
              >
                {clusteringLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              </button>
            </div>
            <div className="space-y-4">
              {clusters.length > 0 ? (
                clusters.map((cluster, i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.1 }}
                    className="p-4 rounded-2xl bg-slate-50 border border-slate-100"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="font-bold text-slate-900">{cluster.cluster_name}</div>
                      <span className="text-xs font-bold text-slate-400">
                        {cluster.keywords.length} mots-clés
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 mb-3">{cluster.description}</p>
                    <div className="flex flex-wrap gap-2">
                      {cluster.keywords.slice(0, 3).map((kw: string) => (
                        <span
                          key={kw}
                          className="text-[10px] bg-white px-2 py-1 rounded-lg border border-slate-100 text-slate-600"
                        >
                          {kw}
                        </span>
                      ))}
                      {cluster.keywords.length > 3 && (
                        <span className="text-[10px] text-slate-400">+{cluster.keywords.length - 3}</span>
                      )}
                    </div>
                  </motion.div>
                ))
              ) : (
                <div className="py-12 text-center text-slate-400">
                  Aucun cluster généré. Cliquez sur rafraîchir.
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="absolute -right-20 -top-20 w-64 h-64 bg-indigo-50 rounded-full blur-3xl opacity-50 group-hover:scale-110 transition-transform duration-700" />
      </div>

    </div>
  );
}