import { useState, useEffect } from "react";
import { 
  LineChart as LineChartIcon, 
  ArrowUp, 
  ArrowDown, 
  Minus,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Search,
  Filter,
  MoreHorizontal,
  Briefcase,
  ChevronDown
} from "lucide-react";
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer 
} from "recharts";
import { motion } from "motion/react";

export default function Tracking() {
  const [data, setData] = useState<any[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchProjects();
  }, []);

  useEffect(() => {
    fetchData();
  }, [selectedProjectId]);

  const fetchProjects = async () => {
  try {
    const res = await fetch("/api/projects", {
      headers: { Authorization: `Bearer ${localStorage.getItem("token")}` }
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const json = await res.json();
    setProjects(Array.isArray(json) ? json : []);
  } catch (error) {
    console.error("Tracking fetchProjects error:", error);
    setProjects([]);
  }
};

  const fetchData = async () => {
  setLoading(true);

  try {
    const url = selectedProjectId
      ? `/api/dashboard?projectId=${selectedProjectId}`
      : "/api/dashboard";

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${localStorage.getItem("token")}` }
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const json = await res.json();

    // /api/dashboard renvoie un objet, pas un tableau
    setData(Array.isArray(json.keywords) ? json.keywords : []);
  } catch (error) {
    console.error("Tracking fetchData error:", error);
    setData([]);
  } finally {
    setLoading(false);
  }
};
  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'Stable': return <span className="flex items-center gap-1.5 px-2.5 py-1 bg-emerald-50 text-emerald-600 rounded-lg text-[10px] font-bold uppercase tracking-wider"><CheckCircle2 className="w-3 h-3" /> Stable</span>;
      case 'Risk': return <span className="flex items-center gap-1.5 px-2.5 py-1 bg-amber-50 text-amber-600 rounded-lg text-[10px] font-bold uppercase tracking-wider"><AlertTriangle className="w-3 h-3" /> À surveiller</span>;
      case 'Action Required': return <span className="flex items-center gap-1.5 px-2.5 py-1 bg-red-50 text-red-600 rounded-lg text-[10px] font-bold uppercase tracking-wider"><XCircle className="w-3 h-3" /> À corriger</span>;
      default: return null;
    }
  };

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Suivi des mots-clés</h1>
          <p className="text-slate-500 mt-1">Monitoring et contrôle des performances en temps réel.</p>
        </div>
        <div className="relative">
          <Briefcase className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <select 
            value={selectedProjectId}
            onChange={(e) => setSelectedProjectId(e.target.value)}
            className="pl-10 pr-8 py-2 bg-white border border-slate-200 rounded-xl text-sm font-bold text-slate-700 shadow-sm hover:bg-slate-50 transition-all appearance-none outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="">Tous les projets</option>
            {projects.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <ChevronDown className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
        </div>
      </div>

      <div className="bg-white rounded-[2.5rem] border border-slate-100 shadow-sm overflow-hidden">
        <div className="p-6 border-b border-slate-50 flex items-center justify-between bg-slate-50/50">
          <div className="flex items-center gap-4">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input 
                type="text" 
                placeholder="Rechercher..." 
                className="pl-10 pr-4 py-2 bg-white border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 w-64 outline-none"
              />
            </div>
            <button className="flex items-center gap-2 px-4 py-2 text-slate-600 hover:bg-white border border-transparent hover:border-slate-200 rounded-xl transition-all text-sm font-medium">
              <Filter className="w-4 h-4" />
              Filtres
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="text-slate-400 text-[10px] uppercase tracking-wider font-bold">
                <th className="px-8 py-5">Mot-clé</th>
                <th className="px-8 py-5">Position</th>
                <th className="px-8 py-5">Évolution (30j)</th>
                <th className="px-8 py-5">CTR</th>
                <th className="px-8 py-5">Performance Drift</th>
                <th className="px-8 py-5">Statut</th>
                <th className="px-8 py-5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {loading ? (
                <tr><td colSpan={7} className="px-8 py-10 text-center text-slate-400">Chargement...</td></tr>
                            ) : Array.isArray(data) && data.length > 0 ? data.map((k) => {
                const diff = Number(k.prev_position ?? 0) - Number(k.position ?? 0);
                const ctrDiff = Number(k.ctr ?? 0) - Number(k.prev_ctr ?? 0);
                return (
                  <tr key={k.id} className="hover:bg-slate-50/50 transition-colors group">
                    <td className="px-8 py-5">
                      <div className="font-bold text-slate-900">{k.keyword}</div>
                      <div className="text-[10px] text-slate-400 font-bold mt-0.5">Opti: 12/02/2024</div>
                    </td>
                    <td className="px-8 py-5">
                      <div className="flex items-center gap-2">
                        <span className="text-lg font-bold text-slate-900">{k.position}</span>
                        <span className="text-xs text-slate-400 font-medium">vs {k.prev_position}</span>
                      </div>
                    </td>
                    <td className="px-8 py-5">
                      <div className={`flex items-center gap-1 text-sm font-bold ${diff > 0 ? 'text-emerald-600' : diff < 0 ? 'text-red-600' : 'text-slate-400'}`}>
                        {diff > 0 ? <ArrowUp className="w-4 h-4" /> : diff < 0 ? <ArrowDown className="w-4 h-4" /> : <Minus className="w-4 h-4" />}
                        {Math.abs(diff)}
                      </div>
                    </td>
                    <td className="px-8 py-5">
                      <div className="text-sm font-bold text-slate-900">{(Number(k.ctr ?? 0) * 100).toFixed(1)}%</div>
                      <div className={`text-[10px] font-bold ${ctrDiff > 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                        {ctrDiff > 0 ? '+' : ''}{(ctrDiff * 100).toFixed(1)}%
                      </div>
                    </td>
                    <td className="px-8 py-5">
                      <div className="w-32 h-2 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${Math.abs(diff) > 5 ? 'bg-red-500' : 'bg-indigo-500'}`}
                          style={{ width: `${Math.min(100, Math.abs(diff) * 10)}%` }}
                        />
                      </div>
                    </td>
                    <td className="px-8 py-5">
                      {getStatusBadge(Math.abs(diff) > 5 ? 'Action Required' : Math.abs(diff) > 2 ? 'Risk' : 'Stable')}
                    </td>
                    <td className="px-8 py-5 text-right">
                      <button className="p-2 hover:bg-white hover:shadow-sm rounded-lg text-slate-400 hover:text-slate-900 transition-all border border-transparent hover:border-slate-100">
                        <MoreHorizontal className="w-5 h-5" />
                      </button>
                    </td>
                  </tr>
                );
              }) : (
                <tr>
                  <td colSpan={7} className="px-8 py-10 text-center text-slate-400">
                    Aucune donnée disponible.
                  </td>
                </tr>
              )}
                        </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
