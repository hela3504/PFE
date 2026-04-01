import { useState, useEffect, useMemo } from "react";
import {
  TrendingUp,
  Users,
  MousePointer2,
  BarChart3,
  AlertCircle,
  ChevronDown,
  Calendar,
  Sparkles,
  Loader2,
  Briefcase,
  CheckCircle2,
  Layers,
  RefreshCw,
} from "lucide-react";
import {
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import { motion } from "motion/react";
import { getDashboardInterpretation } from "../services/geminiService";
import Markdown from "react-markdown";

const COLORS = ["#6366f1", "#10b981", "#f59e0b", "#ef4444"];

type Project = {
  id: number;
  name: string;
};

type DashboardKeyword = {
  id: number;
  keyword: string;
  volume?: number;
  position?: number;
  prev_position?: number;
  impressions?: number;
  ctr?: number;
  prev_ctr?: number;
  competition?: number;
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
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [aiInterpretation, setAiInterpretation] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [actionPlan, setActionPlan] = useState<any[]>([]);
  const [clusters, setClusters] = useState<any[]>([]);
  const [clusteringLoading, setClusteringLoading] = useState(false);

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
    try {
      const url = selectedProjectId
        ? `/api/dashboard?projectId=${selectedProjectId}`
        : "/api/dashboard";

      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${localStorage.getItem("token")}`,
        },
      });

      const json = await res.json();
      setDashboard(json);
      setAiInterpretation(null);
    } catch (error) {
      console.error("fetchDashboard error:", error);
      setDashboard(null);
    } finally {
      setLoading(false);
    }
  };

  const fetchActionPlan = async () => {
    if (!selectedProjectId) return;
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
        label: "Mots-clés suivis",
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
        label: "CTR moyen",
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

  const chartData = dashboard?.charts?.trafficTrend || [];
  const pieData = dashboard?.charts?.brandedSplit || [];
  const alerts = dashboard?.alerts || {
    strongDrop: 0,
    toWatch: 0,
    opportunities: 0,
  };

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto min-h-[400px] flex items-center justify-center">
        <div className="flex items-center gap-3 text-slate-500 font-medium">
          <Loader2 className="w-5 h-5 animate-spin" />
          Chargement du dashboard...
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Dashboard Global</h1>
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

          <button className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-xl text-sm font-bold text-slate-700 shadow-sm hover:bg-slate-50 transition-all">
            <Calendar className="w-4 h-4 text-slate-400" />
            Derniers 30 jours
            <ChevronDown className="w-4 h-4 text-slate-400" />
          </button>
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

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 bg-white p-8 rounded-[2.5rem] border border-slate-100 shadow-sm">
          <div className="flex items-center justify-between mb-8">
            <h3 className="text-xl font-bold text-slate-900">Évolution du trafic organique</h3>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 bg-indigo-500 rounded-full" />
                <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Visites</span>
              </div>
            </div>
          </div>
          <div className="h-[300px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="colorTraffic" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.1} />
                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis
                  dataKey="name"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: "#94a3b8", fontSize: 12 }}
                  dy={10}
                />
                <YAxis axisLine={false} tickLine={false} tick={{ fill: "#94a3b8", fontSize: 12 }} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#fff",
                    borderRadius: "16px",
                    border: "none",
                    boxShadow: "0 10px 15px -3px rgb(0 0 0 / 0.1)",
                  }}
                  cursor={{ stroke: "#6366f1", strokeWidth: 2 }}
                />
                <Area
                  type="monotone"
                  dataKey="traffic"
                  stroke="#6366f1"
                  strokeWidth={3}
                  fillOpacity={1}
                  fill="url(#colorTraffic)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white p-8 rounded-[2.5rem] border border-slate-100 shadow-sm">
          <h3 className="text-xl font-bold text-slate-900 mb-8">Répartition Branded</h3>
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
            <div className="flex items-center gap-3 mb-8">
              <div className="w-10 h-10 bg-emerald-100 rounded-xl flex items-center justify-center text-emerald-600">
                <CheckCircle2 className="w-5 h-5" />
              </div>
              <h3 className="text-xl font-bold text-slate-900">Plan d'Action IA</h3>
            </div>
            <div className="space-y-4">
              {actionPlan.length > 0 ? (
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

      <div className="bg-white p-8 rounded-[2.5rem] border border-slate-100 shadow-sm">
        <div className="flex items-center gap-3 mb-6">
          <AlertCircle className="w-6 h-6 text-amber-500" />
          <h3 className="text-xl font-bold text-slate-900">Section Alertes</h3>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="p-4 bg-red-50 border border-red-100 rounded-2xl">
            <div className="text-red-600 font-bold text-sm mb-1">Forte baisse</div>
            <div className="text-slate-900 font-bold">{alerts.strongDrop} mots-clés</div>
            <div className="text-xs text-slate-500 mt-2">Perte de &gt; 5 positions</div>
          </div>
          <div className="p-4 bg-amber-50 border border-amber-100 rounded-2xl">
            <div className="text-amber-600 font-bold text-sm mb-1">À surveiller</div>
            <div className="text-slate-900 font-bold">{alerts.toWatch} mots-clés</div>
            <div className="text-xs text-slate-500 mt-2">Instabilité détectée</div>
          </div>
          <div className="p-4 bg-emerald-50 border border-emerald-100 rounded-2xl">
            <div className="text-emerald-600 font-bold text-sm mb-1">Opportunités</div>
            <div className="text-slate-900 font-bold">{alerts.opportunities} nouvelles</div>
            <div className="text-xs text-slate-500 mt-2">Mots-clés faciles à ranker</div>
          </div>
        </div>
      </div>
    </div>
  );
}