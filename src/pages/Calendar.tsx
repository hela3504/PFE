import React, { useState, useEffect } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  Sparkles,
  Loader2,
} from "lucide-react";
import {
  format,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  isSameMonth,
  isSameDay,
  addMonths,
  subMonths,
} from "date-fns";
import { fr } from "date-fns/locale";
import { motion, AnimatePresence } from "motion/react";
import { getSeasonalSuggestions } from "../services/geminiService";
import Markdown from "react-markdown";

const EVENT_TYPES = {
  Publication: { color: "bg-blue-500", light: "bg-blue-50", text: "text-blue-600" },
  Saison:      { color: "bg-emerald-500", light: "bg-emerald-50", text: "text-emerald-600" },
  Audit:       { color: "bg-amber-500", light: "bg-amber-50", text: "text-amber-600" },
  Urgent:      { color: "bg-rose-500", light: "bg-rose-50", text: "text-rose-600" },
};

export default function Calendar() {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [events, setEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [projects, setProjects] = useState<any[]>([]);
  const [aiSuggestions, setAiSuggestions] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiDomain, setAiDomain] = useState("Parapharmacie");
  const [aiLocation, setAiLocation] = useState("France");
  const [newEvent, setNewEvent] = useState({
    projectId: "",
    title: "",
    description: "",
    start_date: format(new Date(), "yyyy-MM-dd"),
    end_date: format(new Date(), "yyyy-MM-dd"),
    type: "Publication",
  });

  useEffect(() => {
    fetchEvents();
    fetchProjects();
  }, []);

  const fetchEvents = async () => {
    setLoading(true);
    setError(null);
    try {
      const token = localStorage.getItem("token");
      const res = await fetch("/api/calendar", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setEvents(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("fetchEvents error:", err);
      setError("Impossible de charger les événements.");
      setEvents([]);
    } finally {
      setLoading(false);
    }
  };

  const fetchProjects = async () => {
    try {
      const token = localStorage.getItem("token");
      const res = await fetch("/api/projects", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const list = Array.isArray(data) ? data : [];
      setProjects(list);
      if (list.length > 0) {
        setNewEvent((prev) => ({ ...prev, projectId: String(list[0].id) }));
      }
    } catch (err) {
      console.error("fetchProjects error:", err);
      setProjects([]);
    }
  };

  const generateSuggestions = async () => {
    setAiLoading(true);
    try {
      const suggestions = await getSeasonalSuggestions(aiDomain, aiLocation);
      setAiSuggestions(suggestions || null);
    } catch (err) {
      console.error("generateSuggestions error:", err);
    } finally {
      setAiLoading(false);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const token = localStorage.getItem("token");
      const res = await fetch("/api/calendar", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(newEvent),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setIsModalOpen(false);
      fetchEvents();
    } catch (err) {
      console.error("handleCreate error:", err);
      alert("Erreur lors de la création de l'événement.");
    }
  };

  // Calendar grid computation — wrapped in try/catch to prevent blank page
  let calendarDays: Date[] = [];
  try {
    const monthStart = startOfMonth(currentDate);
    const monthEnd = endOfMonth(monthStart);
    const startDate = startOfWeek(monthStart, { weekStartsOn: 1 });
    const endDate = endOfWeek(monthEnd, { weekStartsOn: 1 });
    calendarDays = eachDayOfInterval({ start: startDate, end: endDate });
  } catch (err) {
    console.error("Calendar grid error:", err);
  }

  const monthStart = startOfMonth(currentDate);

  // Safe event lookup per day
  const getEventsForDay = (day: Date) => {
    try {
      return events.filter((e) => {
        if (!e?.start_date) return false;
        return isSameDay(new Date(e.start_date), day);
      });
    } catch {
      return [];
    }
  };

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Calendrier SEO</h1>
          <p className="text-slate-500 mt-1">Planifiez vos actions et anticipez les saisonnalités.</p>
        </div>
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex bg-white p-1 rounded-xl border border-slate-200 shadow-sm">
            <button
              onClick={() => setCurrentDate(subMonths(currentDate, 1))}
              className="p-2 hover:bg-slate-50 rounded-lg transition-all text-slate-500"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <div className="px-4 py-2 font-bold text-slate-900 min-w-[150px] text-center capitalize">
              {format(currentDate, "MMMM yyyy", { locale: fr })}
            </div>
            <button
              onClick={() => setCurrentDate(addMonths(currentDate, 1))}
              className="p-2 hover:bg-slate-50 rounded-lg transition-all text-slate-500"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
          <button
            onClick={() => setIsModalOpen(true)}
            className="flex items-center gap-2 px-6 py-3 bg-indigo-600 text-white rounded-2xl font-bold shadow-lg shadow-indigo-100 hover:bg-indigo-700 transition-all active:scale-95"
          >
            <Plus className="w-5 h-5" />
            Nouvel événement
          </button>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="px-6 py-4 bg-red-50 border border-red-100 rounded-2xl text-red-600 text-sm font-medium">
          {error}
        </div>
      )}

      {/* Calendar grid */}
      <div className="bg-white rounded-[2.5rem] border border-slate-100 shadow-sm overflow-hidden">
        <div className="grid grid-cols-7 border-b border-slate-100">
          {["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"].map((day) => (
            <div
              key={day}
              className="py-4 text-center text-[10px] font-bold text-slate-400 uppercase tracking-widest"
            >
              {day}
            </div>
          ))}
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20 gap-3 text-slate-400">
            <Loader2 className="w-5 h-5 animate-spin" />
            Chargement...
          </div>
        ) : (
          <div className="grid grid-cols-7">
            {calendarDays.map((day, i) => {
              const dayEvents = getEventsForDay(day);
              const isToday = isSameDay(day, new Date());
              const isCurrentMonth = isSameMonth(day, monthStart);

              return (
                <div
                  key={i}
                  className={`min-h-[140px] p-4 border-r border-b border-slate-50 transition-colors hover:bg-slate-50/30 ${
                    !isCurrentMonth ? "bg-slate-50/50 opacity-40" : ""
                  }`}
                >
                  <div
                    className={`text-sm font-bold mb-2 w-7 h-7 flex items-center justify-center rounded-full ${
                      isToday
                        ? "bg-indigo-600 text-white"
                        : "text-slate-400"
                    }`}
                  >
                    {format(day, "d")}
                  </div>
                  <div className="space-y-1.5">
                    {dayEvents.map((event, idx) => {
                      const typeStyle =
                        EVENT_TYPES[event.type as keyof typeof EVENT_TYPES] ??
                        EVENT_TYPES["Publication"];
                      return (
                        <div
                          key={idx}
                          className={`px-2 py-1 rounded-lg text-[10px] font-bold truncate cursor-pointer hover:brightness-95 transition-all ${typeStyle.light} ${typeStyle.text}`}
                        >
                          {event.title}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* AI Suggestions */}
      <div className="bg-slate-900 p-10 rounded-[3rem] text-white relative overflow-hidden group">
        <div className="relative z-10">
          <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6 mb-8">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-indigo-500/20 rounded-2xl flex items-center justify-center text-indigo-400 border border-indigo-500/30">
                <Sparkles className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-2xl font-bold">Suggestions IA Saisonnières</h3>
                <p className="text-slate-400 text-sm mt-1">Anticipez les tendances de recherche à venir.</p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-4 w-full lg:w-auto">
              <div className="flex flex-col gap-1">
                <label className="text-[10px] uppercase font-bold text-slate-500 tracking-wider ml-1">Domaine</label>
                <input
                  type="text"
                  value={aiDomain}
                  onChange={(e) => setAiDomain(e.target.value)}
                  placeholder="Ex: Parapharmacie"
                  className="bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all w-40"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] uppercase font-bold text-slate-500 tracking-wider ml-1">Localisation</label>
                <input
                  type="text"
                  value={aiLocation}
                  onChange={(e) => setAiLocation(e.target.value)}
                  placeholder="Ex: Tunisie"
                  className="bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all w-40"
                />
              </div>
              <button
                onClick={generateSuggestions}
                disabled={aiLoading}
                className="flex items-center gap-2 px-6 py-3 bg-white text-slate-900 rounded-2xl font-bold hover:bg-slate-100 transition-all disabled:opacity-50 mt-4 lg:mt-0"
              >
                {aiLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Sparkles className="w-5 h-5" />}
                {aiSuggestions ? "Actualiser" : "Analyser"}
              </button>
            </div>
          </div>

          <div className="min-h-[100px]">
            {aiLoading ? (
              <div className="py-12 flex flex-col items-center justify-center gap-4">
                <Loader2 className="w-10 h-10 text-indigo-400 animate-spin" />
                <p className="text-slate-400 font-medium animate-pulse">
                  Recherche des événements saisonniers...
                </p>
              </div>
            ) : aiSuggestions ? (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
              >
                <div className="bg-white/5 border border-white/10 rounded-3xl p-8 backdrop-blur-sm">
                  <div className="text-slate-300 leading-relaxed">
                    <Markdown>{aiSuggestions}</Markdown>
                  </div>
                </div>
              </motion.div>
            ) : (
              <div className="py-12 text-center border-2 border-dashed border-white/10 rounded-3xl">
                <p className="text-slate-500 font-medium">
                  L'IA peut analyser le web pour vous suggérer des événements comme le Black Friday, les soldes ou les vacances d'été.
                </p>
              </div>
            )}
          </div>
        </div>

        <div className="absolute -right-20 -bottom-20 w-96 h-96 bg-indigo-600/20 rounded-full blur-[100px] group-hover:scale-110 transition-transform duration-1000" />
        <div className="absolute -left-20 -top-20 w-64 h-64 bg-blue-600/10 rounded-full blur-[80px] group-hover:scale-110 transition-transform duration-1000" />
      </div>

      {/* Modal */}
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
              <h2 className="text-2xl font-bold text-slate-900 mb-2">Nouvel Événement</h2>
              <p className="text-slate-500 mb-8">Planifiez une action SEO stratégique.</p>

              <form onSubmit={handleCreate} className="space-y-6">
                <div className="space-y-2">
                  <label className="text-sm font-bold text-slate-700 ml-1">Titre</label>
                  <input
                    type="text"
                    required
                    value={newEvent.title}
                    onChange={(e) => setNewEvent({ ...newEvent, title: e.target.value })}
                    className="w-full px-5 py-3.5 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                    placeholder="Ex: Optimisation H1 - Page Home"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-sm font-bold text-slate-700 ml-1">Projet</label>
                    <select
                      value={newEvent.projectId}
                      onChange={(e) => setNewEvent({ ...newEvent, projectId: e.target.value })}
                      className="w-full px-5 py-3.5 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all appearance-none"
                    >
                      {projects.length === 0 && (
                        <option value="">Aucun projet</option>
                      )}
                      {projects.map((p) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-bold text-slate-700 ml-1">Type</label>
                    <select
                      value={newEvent.type}
                      onChange={(e) => setNewEvent({ ...newEvent, type: e.target.value })}
                      className="w-full px-5 py-3.5 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all appearance-none"
                    >
                      {Object.keys(EVENT_TYPES).map((t) => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-sm font-bold text-slate-700 ml-1">Date début</label>
                    <input
                      type="date"
                      required
                      value={newEvent.start_date}
                      onChange={(e) => setNewEvent({ ...newEvent, start_date: e.target.value })}
                      className="w-full px-5 py-3.5 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-bold text-slate-700 ml-1">Date fin</label>
                    <input
                      type="date"
                      required
                      value={newEvent.end_date}
                      onChange={(e) => setNewEvent({ ...newEvent, end_date: e.target.value })}
                      className="w-full px-5 py-3.5 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                    />
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
                    Enregistrer
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