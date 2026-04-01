import React, { useState, useEffect, useMemo } from "react";
import { Plus, Globe, Trash2, Edit2, ExternalLink, Search, Filter } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

type Project = {
  id: number;
  name: string;
  domain: string;
  country: string;
  language: string;
  created_at: string | null;
  userId?: number;
};

const emptyProject = {
  name: "",
  domain: "",
  country: "FR",
  language: "Français",
};

export default function Projects() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [formData, setFormData] = useState(emptyProject);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchProjects();
  }, []);

  const fetchProjects = async () => {
    setLoading(true);

    try {
      const token = localStorage.getItem("token");
      if (!token) throw new Error("No token found");

      const res = await fetch("/api/projects", {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const json = await res.json();
      setProjects(Array.isArray(json) ? json : []);
    } catch (error) {
      console.error("Projects fetchProjects error:", error);
      setProjects([]);
    } finally {
      setLoading(false);
    }
  };

  const openCreateModal = () => {
    setEditingProject(null);
    setFormData(emptyProject);
    setIsModalOpen(true);
  };

  const openEditModal = (project: Project) => {
    setEditingProject(project);
    setFormData({
      name: project.name || "",
      domain: project.domain || "",
      country: project.country || "FR",
      language: project.language || "Français",
    });
    setIsModalOpen(true);
  };

  const normalizeUrl = (url: string) => {
    if (!url) return "";
    return url.startsWith("http://") || url.startsWith("https://")
      ? url
      : `https://${url}`;
  };

  const handleOpenSite = (domain: string) => {
    const finalUrl = normalizeUrl(domain);
    if (!finalUrl) return;
    window.open(finalUrl, "_blank", "noopener,noreferrer");
  };

  const handleDelete = async (projectId: number) => {
    const confirmed = window.confirm("Voulez-vous vraiment supprimer ce projet ?");
    if (!confirmed) return;

    try {
      const token = localStorage.getItem("token");
      if (!token) throw new Error("No token found");

      const res = await fetch(`/api/projects/${projectId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      await fetchProjects();
    } catch (error) {
      console.error("Projects delete error:", error);
      alert("Erreur lors de la suppression du projet.");
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      const token = localStorage.getItem("token");
      if (!token) throw new Error("No token found");

      const isEdit = Boolean(editingProject);
      const url = isEdit
        ? `/api/projects/${editingProject!.id}`
        : "/api/projects";

      const method = isEdit ? "PUT" : "POST";

      const res = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(formData),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      setIsModalOpen(false);
      setEditingProject(null);
      setFormData(emptyProject);
      await fetchProjects();
    } catch (error) {
      console.error("Projects submit error:", error);
      alert("Erreur lors de l’enregistrement du projet.");
    }
  };

  const filteredProjects = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return projects;

    return projects.filter((project) => {
      return (
        String(project.name || "").toLowerCase().includes(q) ||
        String(project.domain || "").toLowerCase().includes(q) ||
        String(project.country || "").toLowerCase().includes(q)
      );
    });
  }, [projects, search]);

  const formatDate = (value: string | null) => {
    if (!value) return "-";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "-";
    return d.toLocaleDateString();
  };

  const getInitial = (name: string) => {
    const clean = String(name || "").trim();
    return clean ? clean[0].toUpperCase() : "?";
  };

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-10">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Projets</h1>
          <p className="text-slate-500 mt-1">Gérez vos sites web et leurs configurations SEO.</p>
        </div>

        <button
          onClick={openCreateModal}
          className="flex items-center gap-2 px-6 py-3 bg-indigo-600 text-white rounded-2xl font-bold shadow-lg shadow-indigo-100 hover:bg-indigo-700 transition-all active:scale-95"
        >
          <Plus className="w-5 h-5" />
          Créer un projet
        </button>
      </div>

      <div className="bg-white rounded-[2rem] border border-slate-100 shadow-sm overflow-hidden">
        <div className="p-6 border-b border-slate-50 flex items-center justify-between bg-slate-50/50">
          <div className="flex items-center gap-4">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Filtrer les projets..."
                className="pl-10 pr-4 py-2 bg-white border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 w-64 outline-none"
              />
            </div>

            <button className="flex items-center gap-2 px-4 py-2 text-slate-600 hover:bg-white border border-transparent hover:border-slate-200 rounded-xl transition-all text-sm font-medium">
              <Filter className="w-4 h-4" />
              Filtres
            </button>
          </div>

          <div className="text-sm text-slate-500 font-medium">
            {filteredProjects.length} projet(s) au total
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="text-slate-400 text-xs uppercase tracking-wider font-bold">
                <th className="px-8 py-5">Nom du projet</th>
                <th className="px-8 py-5">Domaine</th>
                <th className="px-8 py-5">Pays</th>
                <th className="px-8 py-5">Date création</th>
                <th className="px-8 py-5 text-right">Actions</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-50">
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-8 py-10 text-center text-slate-400">
                    Chargement...
                  </td>
                </tr>
              ) : filteredProjects.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-8 py-10 text-center text-slate-400">
                    Aucun projet trouvé.
                  </td>
                </tr>
              ) : (
                filteredProjects.map((project) => (
                  <tr key={project.id} className="hover:bg-slate-50/50 transition-colors group">
                    <td className="px-8 py-5">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-indigo-50 rounded-xl flex items-center justify-center text-indigo-600 font-bold">
                          {getInitial(project.name)}
                        </div>
                        <span className="font-bold text-slate-900">
                          {project.name || "Sans nom"}
                        </span>
                      </div>
                    </td>

                    <td className="px-8 py-5">
                      <div className="flex items-center gap-2 text-slate-600">
                        <Globe className="w-4 h-4 text-slate-400" />
                        {project.domain || "-"}
                      </div>
                    </td>

                    <td className="px-8 py-5">
                      <span className="px-3 py-1 bg-slate-100 text-slate-600 rounded-full text-xs font-bold">
                        {project.country || "-"}
                      </span>
                    </td>

                    <td className="px-8 py-5 text-slate-500 text-sm">
                      {formatDate(project.created_at)}
                    </td>

                    <td className="px-8 py-5 text-right">
                      <div className="flex items-center justify-end gap-2 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => openEditModal(project)}
                          title="Modifier"
                          className="p-2 hover:bg-white hover:shadow-sm rounded-lg text-slate-400 hover:text-indigo-600 transition-all border border-transparent hover:border-slate-100"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>

                        <button
                          onClick={() => handleDelete(project.id)}
                          title="Supprimer"
                          className="p-2 hover:bg-white hover:shadow-sm rounded-lg text-slate-400 hover:text-red-600 transition-all border border-transparent hover:border-slate-100"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>

                        <button
                          onClick={() => handleOpenSite(project.domain)}
                          title="Ouvrir le site"
                          className="p-2 hover:bg-white hover:shadow-sm rounded-lg text-slate-400 hover:text-slate-900 transition-all border border-transparent hover:border-slate-100"
                        >
                          <ExternalLink className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsModalOpen(false)}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            />

            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-lg bg-white rounded-[2.5rem] shadow-2xl p-10 overflow-hidden"
            >
              <h2 className="text-2xl font-bold text-slate-900 mb-2">
                {editingProject ? "Modifier le projet" : "Nouveau Projet"}
              </h2>
              <p className="text-slate-500 mb-8">
                {editingProject
                  ? "Modifiez les détails de votre projet."
                  : "Configurez les détails de votre nouveau site web."}
              </p>

              <form onSubmit={handleSubmit} className="space-y-6">
                <div className="space-y-2">
                  <label className="text-sm font-bold text-slate-700 ml-1">Nom du projet</label>
                  <input
                    type="text"
                    required
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full px-5 py-3.5 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                    placeholder="Ex: Mon Site E-commerce"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-bold text-slate-700 ml-1">Domaine (URL)</label>
                  <input
                    type="text"
                    required
                    value={formData.domain}
                    onChange={(e) => setFormData({ ...formData, domain: e.target.value })}
                    className="w-full px-5 py-3.5 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                    placeholder="Ex: monsite.com"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-sm font-bold text-slate-700 ml-1">Pays</label>
                    <select
                      value={formData.country}
                      onChange={(e) => setFormData({ ...formData, country: e.target.value })}
                      className="w-full px-5 py-3.5 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all appearance-none"
                    >
                      <option value="FR">France</option>
                      <option value="TN">Tunisie</option>
                      <option value="UK">UK</option>
                      <option value="DE">Allemagne</option>
                    </select>
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-bold text-slate-700 ml-1">Langue</label>
                    <select
                      value={formData.language}
                      onChange={(e) => setFormData({ ...formData, language: e.target.value })}
                      className="w-full px-5 py-3.5 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all appearance-none"
                    >
                      <option value="Français">Français</option>
                      <option value="Anglais">Anglais</option>
                      <option value="Allemand">Allemand</option>
                    </select>
                  </div>
                </div>

                <div className="flex gap-4 pt-4">
                  <button
                    type="button"
                    onClick={() => setIsModalOpen(false)}
                    className="flex-1 py-4 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-2xl font-bold transition-all"
                  >
                    Annuler
                  </button>

                  <button
                    type="submit"
                    className="flex-1 py-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl font-bold shadow-lg shadow-indigo-100 transition-all"
                  >
                    {editingProject ? "Enregistrer" : "Créer le projet"}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}