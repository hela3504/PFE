import { useState, useEffect, useMemo } from "react";
import {
  ArrowUp,
  ArrowDown,
  Minus,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Search,
  Filter,
  Briefcase,
  ChevronDown,
  Loader2,
  EyeOff,
} from "lucide-react";

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
  performance_drift?: number | null;
  status?: string | null;
  is_tracked?: boolean;
};

export default function Tracking() {
  const [data, setData] = useState<TrackedKeyword[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [untrackingId, setUntrackingId] = useState<number | null>(null);

  useEffect(() => {
    fetchProjects();
  }, []);

  useEffect(() => {
    fetchTrackedKeywords();
  }, [selectedProjectId]);

  const fetchProjects = async () => {
    try {
      const token = localStorage.getItem("token");
      if (!token) throw new Error("No token found");

      const res = await fetch("/api/projects", {
        headers: { Authorization: `Bearer ${token}` },
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

  const fetchTrackedKeywords = async () => {
    setLoading(true);

    try {
      const token = localStorage.getItem("token");
      if (!token) throw new Error("No token found");

      const url = selectedProjectId
        ? `/api/keywords/tracked?projectId=${selectedProjectId}`
        : "/api/keywords/tracked";

      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const json = await res.json();
      setData(Array.isArray(json) ? json : []);
    } catch (error) {
      console.error("Tracking fetchTrackedKeywords error:", error);
      setData([]);
    } finally {
      setLoading(false);
    }
  };

  const handleUntrack = async (keywordId: number) => {
    try {
      setUntrackingId(keywordId);

      const token = localStorage.getItem("token");
      if (!token) throw new Error("No token found");

      const res = await fetch(`/api/keywords/${keywordId}/untrack`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      await fetchTrackedKeywords();
    } catch (error) {
      console.error("Tracking handleUntrack error:", error);
      alert("Erreur lors de la suppression du suivi.");
    } finally {
      setUntrackingId(null);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "Stable":
        return (
          <span className="flex items-center gap-1.5 px-2.5 py-1 bg-emerald-50 text-emerald-600 rounded-lg text-[10px] font-bold uppercase tracking-wider">
            <CheckCircle2 className="w-3 h-3" /> Stable
          </span>
        );
      case "Risk":
        return (
          <span className="flex items-center gap-1.5 px-2.5 py-1 bg-amber-50 text-amber-600 rounded-lg text-[10px] font-bold uppercase tracking-wider">
            <AlertTriangle className="w-3 h-3" /> À surveiller
          </span>
        );
      case "Action Required":
        return (
          <span className="flex items-center gap-1.5 px-2.5 py-1 bg-red-50 text-red-600 rounded-lg text-[10px] font-bold uppercase tracking-wider">
            <XCircle className="w-3 h-3" /> À corriger
          </span>
        );
      default:
        return (
          <span className="flex items-center gap-1.5 px-2.5 py-1 bg-slate-100 text-slate-500 rounded-lg text-[10px] font-bold uppercase tracking-wider">
            <Minus className="w-3 h-3" /> Inconnu
          </span>
        );
    }
  };

  const filteredData = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return data;

    return data.filter((k) =>
      String(k.keyword || "").toLowerCase().includes(q)
    );
  }, [data, search]);

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight">
            Suivi des mots-clés
          </h1>
          <p className="text-slate-500 mt-1">
            Suivez uniquement les mots-clés sélectionnés depuis Opportunités.
          </p>
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
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <ChevronDown className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
        </div>
      </div>

      <div className="bg-white rounded-[2.5rem] border border-slate-100 shadow-sm overflow-hidden">
        <div className="p-6 border-b border-slate-50 flex items-center justify-between bg-slate-50/50 flex-wrap gap-4">
          <div className="flex items-center gap-4 flex-wrap">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Rechercher..."
                className="pl-10 pr-4 py-2 bg-white border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 w-64 outline-none"
              />
            </div>

            <button className="flex items-center gap-2 px-4 py-2 text-slate-600 hover:bg-white border border-transparent hover:border-slate-200 rounded-xl transition-all text-sm font-medium">
              <Filter className="w-4 h-4" />
              Filtres
            </button>
          </div>

          <div className="text-sm text-slate-500 font-medium">
            {filteredData.length} mot(s)-clé(s) suivi(s)
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="text-slate-400 text-[10px] uppercase tracking-wider font-bold">
                <th className="px-8 py-5">Mot-clé</th>
                <th className="px-8 py-5">Position</th>
                <th className="px-8 py-5">Évolution</th>
                <th className="px-8 py-5">CTR</th>
                <th className="px-8 py-5">Performance Drift</th>
                <th className="px-8 py-5">Statut</th>
                <th className="px-8 py-5 text-right">Actions</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-50">
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-8 py-10 text-center text-slate-400">
                    <div className="inline-flex items-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Chargement...
                    </div>
                  </td>
                </tr>
              ) : filteredData.length > 0 ? (
                filteredData.map((k) => {
                  const currentPosition = Number(k.position ?? 0);
                  const previousPosition = Number(k.prev_position ?? 0);
                  const diff = previousPosition - currentPosition;

                  const currentCtr = Number(k.ctr ?? 0);
                  const previousCtr = Number(k.prev_ctr ?? 0);
                  const ctrDiff = currentCtr - previousCtr;

                  const drift =
                    k.performance_drift !== null && k.performance_drift !== undefined
                      ? Number(k.performance_drift)
                      : Math.abs(diff);

                  const derivedStatus =
                    drift > 5 ? "Action Required" : drift > 2 ? "Risk" : "Stable";

                  return (
                    <tr key={k.id} className="hover:bg-slate-50/50 transition-colors group">
                      <td className="px-8 py-5">
                        <div className="font-bold text-slate-900">{k.keyword}</div>
                        <div className="text-[10px] text-slate-400 font-bold mt-0.5">
                          Suivi actif
                        </div>
                      </td>

                      <td className="px-8 py-5">
                        <div className="flex items-center gap-2">
                          <span className="text-lg font-bold text-slate-900">
                            {currentPosition.toFixed(1)}
                          </span>
                          <span className="text-xs text-slate-400 font-medium">
                            vs {previousPosition.toFixed(1)}
                          </span>
                        </div>
                      </td>

                      <td className="px-8 py-5">
                        <div
                          className={`flex items-center gap-1 text-sm font-bold ${
                            diff > 0
                              ? "text-emerald-600"
                              : diff < 0
                              ? "text-red-600"
                              : "text-slate-400"
                          }`}
                        >
                          {diff > 0 ? (
                            <ArrowUp className="w-4 h-4" />
                          ) : diff < 0 ? (
                            <ArrowDown className="w-4 h-4" />
                          ) : (
                            <Minus className="w-4 h-4" />
                          )}
                          {Math.abs(diff).toFixed(1)}
                        </div>
                      </td>

                      <td className="px-8 py-5">
                        <div className="text-sm font-bold text-slate-900">
                          {(currentCtr * 100).toFixed(1)}%
                        </div>
                        <div
                          className={`text-[10px] font-bold ${
                            ctrDiff > 0 ? "text-emerald-600" : ctrDiff < 0 ? "text-red-600" : "text-slate-400"
                          }`}
                        >
                          {ctrDiff > 0 ? "+" : ""}
                          {(ctrDiff * 100).toFixed(1)}%
                        </div>
                      </td>

                      <td className="px-8 py-5">
                        <div className="w-32 h-2 bg-slate-100 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${
                              drift > 5 ? "bg-red-500" : drift > 2 ? "bg-amber-500" : "bg-indigo-500"
                            }`}
                            style={{ width: `${Math.min(100, drift * 10)}%` }}
                          />
                        </div>
                      </td>

                      <td className="px-8 py-5">
                        {getStatusBadge(derivedStatus)}
                      </td>

                      <td className="px-8 py-5 text-right">
                        <button
                          onClick={() => handleUntrack(k.id)}
                          disabled={untrackingId === k.id}
                          className="p-2 hover:bg-white hover:shadow-sm rounded-lg text-slate-400 hover:text-red-600 transition-all border border-transparent hover:border-slate-100 disabled:opacity-50"
                          title="Arrêter le suivi"
                        >
                          {untrackingId === k.id ? (
                            <Loader2 className="w-5 h-5 animate-spin" />
                          ) : (
                            <EyeOff className="w-5 h-5" />
                          )}
                        </button>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={7} className="px-8 py-10 text-center text-slate-400">
                    Aucun mot-clé suivi pour le moment.
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