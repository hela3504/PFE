import { useEffect, useMemo, useRef, useState } from "react";
import {
  Sparkles,
  Send,
  Square,
  RotateCcw,
  Loader2,
  AlertCircle,
  Database,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import Markdown from "react-markdown";
import {
  streamAssistant,
  type AssistantMessage,
} from "../services/geminiService";
import { useSelectedProject } from "../hooks/useSelectedProject";

// ─── Dynamic chips ─────────────────────────────────────────────────────────────
//
// Each chip carries a short visual label + the full prompt that gets sent when
// the user clicks it. We pick chips based on the current month so the section
// always feels "in-season". Ramadan / Aïd dates follow the lunar calendar and
// are mapped manually for 2026-2027.

type Chip = { label: string; prompt: string };

function getDynamicChips(now: Date = new Date()): Chip[] {
  const month = now.getMonth() + 1; // 1-12
  const year = now.getFullYear();

  const monthly: Record<number, Chip[]> = {
    1: [
      { label: "Soldes d'hiver", prompt: "Quels contenus SEO publier pour capter le trafic des soldes d'hiver ?" },
      { label: "Saint-Valentin", prompt: "Quelles opportunités SEO préparer pour la Saint-Valentin ?" },
      { label: "Galette des rois", prompt: "Comment optimiser mes pages pour la saison de l'Épiphanie ?" },
    ],
    2: [
      { label: "Saint-Valentin", prompt: "Quelles opportunités SEO préparer pour la Saint-Valentin ?" },
      { label: "Carnaval", prompt: "Quels mots-clés cibler autour du Carnaval ?" },
      { label: "Vacances de février", prompt: "Quelles tendances de recherche anticiper pendant les vacances de février ?" },
    ],
    3: [
      { label: "Pâques", prompt: "Quels contenus SEO préparer pour Pâques ?" },
      { label: "Printemps", prompt: "Comment adapter ma stratégie SEO à l'arrivée du printemps ?" },
      { label: "Mode printemps-été", prompt: "Quels mots-clés cibler pour la collection printemps-été ?" },
    ],
    4: [
      { label: "Pâques", prompt: "Quels contenus SEO publier juste avant Pâques ?" },
      { label: "Préparer l'été", prompt: "Quels sujets SEO préparer avant l'été pour mon activité ?" },
      { label: "Fête du Travail", prompt: "Quelles requêtes saisonnières gagner autour du 1er mai ?" },
    ],
    5: [
      { label: "Fête des mères", prompt: "Quelles opportunités SEO préparer pour la fête des mères ?" },
      { label: "Préparer les soldes d'été", prompt: "Comment anticiper les soldes d'été côté SEO ?" },
      { label: "Pentecôte", prompt: "Quelles tendances de recherche autour des vacances de Pentecôte ?" },
    ],
    6: [
      { label: "Soldes d'été", prompt: "Quelle stratégie SEO déployer pour les soldes d'été ?" },
      { label: "Fête des pères", prompt: "Quelles opportunités SEO autour de la fête des pères ?" },
      { label: "Vacances scolaires", prompt: "Quels contenus SEO publier au début des vacances d'été ?" },
    ],
    7: [
      { label: "Vacances d'été", prompt: "Quelles requêtes touristiques et estivales sont en pic ce mois-ci ?" },
      { label: "Préparer la rentrée", prompt: "Comment commencer à préparer la rentrée scolaire côté SEO ?" },
      { label: "Fête nationale", prompt: "Quelles opportunités SEO autour de la fête nationale ?" },
    ],
    8: [
      { label: "Rentrée scolaire", prompt: "Quels contenus SEO préparer pour la rentrée scolaire ?" },
      { label: "Préparer Black Friday", prompt: "Comment commencer à préparer le Black Friday dès maintenant ?" },
      { label: "Vendanges", prompt: "Quelles tendances de recherche autour des vendanges et du vin ?" },
    ],
    9: [
      { label: "Rentrée scolaire", prompt: "Comment exploiter le pic de rentrée scolaire côté SEO ?" },
      { label: "Halloween", prompt: "Quels contenus SEO préparer en amont d'Halloween ?" },
      { label: "Préparer Black Friday", prompt: "Quelle stratégie de contenu lancer pour le Black Friday ?" },
    ],
    10: [
      { label: "Halloween", prompt: "Quelles opportunités SEO autour d'Halloween cette année ?" },
      { label: "Black Friday", prompt: "Comment optimiser mon site pour le pic de trafic Black Friday ?" },
      { label: "Préparer Noël", prompt: "Quels contenus SEO publier dès octobre pour Noël ?" },
    ],
    11: [
      { label: "Black Friday", prompt: "Quelle stratégie SEO finale pour le Black Friday qui arrive ?" },
      { label: "Cyber Monday", prompt: "Quelles différences SEO entre Black Friday et Cyber Monday ?" },
      { label: "Préparer Noël", prompt: "Comment optimiser mes pages produits pour Noël ?" },
    ],
    12: [
      { label: "Noël", prompt: "Quelles opportunités SEO de dernière minute pour Noël ?" },
      { label: "Saint-Sylvestre", prompt: "Quels contenus SEO publier pour la Saint-Sylvestre et le Nouvel An ?" },
      { label: "Bilan SEO de l'année", prompt: "Aide-moi à faire un bilan SEO de l'année et planifier la suivante." },
    ],
  };

  // Lunar calendar — manual mapping for 2026/2027 Ramadan windows
  const ramadan: Record<number, { start: Date; end: Date }> = {
    2026: { start: new Date(2026, 0, 5), end: new Date(2026, 2, 18) },
    2027: { start: new Date(2026, 11, 25), end: new Date(2027, 2, 8) },
  };

  const chips: Chip[] = [...(monthly[month] || [])];

  const r = ramadan[year];
  if (r && now >= r.start && now <= r.end) {
    chips.unshift(
      { label: "Ramadan", prompt: "Quelles tendances SEO et opportunités de contenu autour du Ramadan ?" },
      { label: "Aïd al-Fitr", prompt: "Comment préparer mon SEO pour l'Aïd al-Fitr ?" },
    );
  }

  chips.push(
    { label: "Idées evergreen", prompt: "Donne-moi 5 idées de contenu SEO evergreen pour mon secteur." },
    { label: "Tendances SEO", prompt: "Quelles sont les tendances SEO majeures du moment ?" },
  );

  // Deduplicate by label and cap at 6
  const seen = new Set<string>();
  return chips
    .filter((c) => (seen.has(c.label) ? false : (seen.add(c.label), true)))
    .slice(0, 6);
}

// ─── Component ─────────────────────────────────────────────────────────────────

const MAX_TURNS = 10;

type Project = { id: number; name: string };

type Props = {
  projects: Project[];
};

export default function SeasonalAssistant({ projects }: Props) {
  const [selectedProjectId] = useSelectedProject();
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [streamingText, setStreamingText] = useState<string>("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [input, setInput] = useState("");
  const [useProjectContext, setUseProjectContext] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const turnCount = useMemo(
    () => messages.filter((m) => m.role === "user").length,
    [messages]
  );
  const reachedLimit = turnCount >= MAX_TURNS;

  const chips = useMemo(() => getDynamicChips(new Date()), []);

  const selectedProject = useMemo(
    () => projects.find((p) => String(p.id) === selectedProjectId) || null,
    [projects, selectedProjectId]
  );

  // Auto-scroll to bottom on new messages / stream chunks
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages, streamingText]);

  // Auto-resize the textarea up to ~6 lines
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 168) + "px";
  }, [input]);

  // Abort any in-flight stream on unmount
  useEffect(() => () => abortRef.current?.abort(), []);

  const handleSend = async (textOverride?: string) => {
    const text = (textOverride ?? input).trim();
    if (!text || isStreaming || reachedLimit) return;

    const userMsg: AssistantMessage = { role: "user", content: text };
    const nextMessages = [...messages, userMsg];

    setMessages(nextMessages);
    setInput("");
    setError(null);
    setStreamingText("");
    setIsStreaming(true);

    abortRef.current = new AbortController();

    let accumulated = "";

    await streamAssistant({
      messages: nextMessages,
      useProjectContext: useProjectContext && !!selectedProjectId,
      projectId: useProjectContext && selectedProjectId ? Number(selectedProjectId) : null,
      onDelta: (delta) => {
        accumulated += delta;
        setStreamingText(accumulated);
      },
      onDone: () => {
        if (accumulated) {
          setMessages((prev) => [...prev, { role: "assistant", content: accumulated }]);
        }
        setStreamingText("");
        setIsStreaming(false);
      },
      onError: (msg) => {
        setError(msg);
        // Commit any partial response we got so the user keeps the context
        if (accumulated) {
          setMessages((prev) => [...prev, { role: "assistant", content: accumulated }]);
        }
        setStreamingText("");
        setIsStreaming(false);
      },
      signal: abortRef.current.signal,
    });
  };

  const handleReset = () => {
    abortRef.current?.abort();
    setMessages([]);
    setStreamingText("");
    setIsStreaming(false);
    setError(null);
    setInput("");
  };

  const handleStop = () => {
    abortRef.current?.abort();
    setStreamingText((current) => {
      if (current) {
        setMessages((prev) => [...prev, { role: "assistant", content: current }]);
      }
      return "";
    });
    setIsStreaming(false);
  };

  const handleChipClick = (chip: Chip) => {
    setInput(chip.prompt);
    textareaRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const isEmpty = messages.length === 0 && !streamingText;

  return (
    <div className="bg-white rounded-[2.5rem] border border-slate-100 shadow-sm relative overflow-hidden">
      {/* Decorative blurs */}
      <div className="absolute -right-20 -bottom-20 w-72 h-72 bg-indigo-100/40 rounded-full blur-[80px] pointer-events-none" />
      <div className="absolute -left-20 -top-20 w-56 h-56 bg-blue-100/40 rounded-full blur-[60px] pointer-events-none" />

      {/* Header */}
      <div className="relative z-10 flex items-center justify-between gap-4 p-8 lg:p-10 pb-6 border-b border-slate-100">
        <div className="flex items-center gap-4 min-w-0">
          <div className="w-12 h-12 bg-indigo-600 rounded-2xl flex items-center justify-center text-white shadow-lg shadow-indigo-200 shrink-0">
            <Sparkles className="w-6 h-6" />
          </div>
          <div className="min-w-0">
            <h3 className="text-2xl font-bold text-slate-900 tracking-tight truncate">
              Assistant SEO saisonnier
            </h3>
            <p className="text-slate-500 text-sm mt-1">
              Décrivez votre besoin, l'IA identifie les opportunités saisonnières pour vous.
            </p>
          </div>
        </div>

        {messages.length > 0 && (
          <button
            onClick={handleReset}
            disabled={isStreaming}
            className="shrink-0 inline-flex items-center gap-2 px-4 py-2 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-xl text-sm font-bold text-slate-600 transition-all disabled:opacity-50"
            title="Effacer la conversation et recommencer"
          >
            <RotateCcw className="w-4 h-4" />
            Nouvelle conversation
          </button>
        )}
      </div>

      {/* Conversation area */}
      <div
        ref={scrollRef}
        className="relative z-10 px-8 lg:px-10 py-6 min-h-[260px] max-h-[480px] overflow-y-auto"
      >
        {isEmpty ? (
          <div className="py-10 px-4 text-center border-2 border-dashed border-slate-200 rounded-3xl bg-slate-50/50">
            <Sparkles className="w-8 h-8 text-indigo-300 mx-auto mb-3" />
            <p className="text-slate-600 font-medium max-w-md mx-auto">
              Posez une question stratégique : événements saisonniers, contenus à anticiper,
              tendances locales, mots-clés à cibler avant un pic.
            </p>
            <p className="text-slate-400 text-xs mt-2 max-w-md mx-auto">
              Exemple : <em>"Trouve des événements saisonniers pour une parapharmacie en France avant l'été."</em>
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <AnimatePresence initial={false}>
              {messages.map((m, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[85%] rounded-2xl px-5 py-3.5 ${
                      m.role === "user"
                        ? "bg-indigo-600 text-white rounded-tr-sm"
                        : "bg-slate-50 border border-slate-100 text-slate-700 rounded-tl-sm"
                    }`}
                  >
                    {m.role === "user" ? (
                      <p className="whitespace-pre-wrap text-sm leading-relaxed">{m.content}</p>
                    ) : (
                      <div className="prose prose-sm prose-slate max-w-none markdown-body">
                        <Markdown>{m.content}</Markdown>
                      </div>
                    )}
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>

            {/* Streaming bubble — appended live as deltas arrive */}
            {(isStreaming || streamingText) && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex justify-start"
              >
                <div className="max-w-[85%] rounded-2xl rounded-tl-sm px-5 py-3.5 bg-slate-50 border border-slate-100 text-slate-700">
                  {streamingText ? (
                    <div className="prose prose-sm prose-slate max-w-none markdown-body">
                      <Markdown>{streamingText}</Markdown>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 text-slate-400 text-sm">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      L'IA réfléchit...
                    </div>
                  )}
                </div>
              </motion.div>
            )}
          </div>
        )}

        {/* Error banner */}
        {error && (
          <div className="mt-4 px-4 py-3 bg-red-50 border border-red-200 rounded-2xl text-red-700 text-sm font-medium flex items-start gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}
      </div>

      {/* Footer: chips + input */}
      <div className="relative z-10 border-t border-slate-100 p-6 lg:p-8 bg-white/60 backdrop-blur space-y-4">
        {/* Dynamic chips — visible only when conversation is empty */}
        {isEmpty && (
          <div>
            <div className="text-[10px] uppercase tracking-wider font-bold text-slate-500 mb-2 ml-1">
              💡 Suggestions du moment
            </div>
            <div className="flex flex-wrap gap-2">
              {chips.map((chip, i) => (
                <motion.button
                  key={chip.label}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.04 }}
                  onClick={() => handleChipClick(chip)}
                  disabled={isStreaming}
                  className="px-3.5 py-1.5 bg-indigo-50 hover:bg-indigo-100 border border-indigo-100 text-indigo-700 rounded-full text-xs font-bold transition-all disabled:opacity-50"
                >
                  {chip.label}
                </motion.button>
              ))}
            </div>
          </div>
        )}

        {/* Project context toggle — only meaningful if a project is selected */}
        {selectedProject && (
          <label
            className={`flex items-center gap-3 px-4 py-2.5 rounded-xl border cursor-pointer transition-all ${
              useProjectContext
                ? "bg-indigo-50 border-indigo-200"
                : "bg-slate-50 border-slate-200 hover:border-slate-300"
            }`}
            title="Injecte les mots-clés, position et marque du projet dans le prompt envoyé à l'IA"
          >
            <input
              type="checkbox"
              checked={useProjectContext}
              onChange={(e) => setUseProjectContext(e.target.checked)}
              disabled={isStreaming}
              className="w-4 h-4 accent-indigo-600"
            />
            <Database className={`w-4 h-4 ${useProjectContext ? "text-indigo-600" : "text-slate-400"}`} />
            <span className={`text-sm font-medium ${useProjectContext ? "text-indigo-700" : "text-slate-600"}`}>
              Utiliser le contexte du projet{" "}
              <strong className={useProjectContext ? "text-indigo-900" : "text-slate-700"}>
                « {selectedProject.name} »
              </strong>
            </span>
          </label>
        )}

        {/* Turn-limit banner */}
        {reachedLimit && (
          <div className="px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-800 text-sm font-medium flex items-center justify-between gap-3 flex-wrap">
            <span>
              Limite de {MAX_TURNS} tours atteinte — démarrez une nouvelle conversation pour continuer.
            </span>
            <button
              onClick={handleReset}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold rounded-lg transition-all"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Recommencer
            </button>
          </div>
        )}

        {/* Input row */}
        <div className="flex items-end gap-3">
          <div className="flex-1 relative">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                reachedLimit
                  ? "Limite de conversation atteinte"
                  : "Posez votre question stratégique..."
              }
              disabled={isStreaming || reachedLimit}
              rows={1}
              className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl text-sm text-slate-900 placeholder:text-slate-400 focus:ring-2 focus:ring-indigo-500 focus:bg-white outline-none transition-all resize-none disabled:opacity-60"
            />
          </div>

          {isStreaming ? (
            <button
              onClick={handleStop}
              className="shrink-0 inline-flex items-center justify-center w-12 h-12 bg-slate-800 hover:bg-slate-900 text-white rounded-2xl shadow-lg transition-all"
              title="Arrêter la génération"
            >
              <Square className="w-4 h-4" />
            </button>
          ) : (
            <button
              onClick={() => handleSend()}
              disabled={!input.trim() || reachedLimit}
              className="shrink-0 inline-flex items-center justify-center w-12 h-12 bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl shadow-lg shadow-indigo-100 transition-all disabled:opacity-40 disabled:cursor-not-allowed active:scale-95"
              title="Envoyer (Entrée)"
            >
              <Send className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Subtle help line */}
        <div className="flex items-center justify-between text-[11px] text-slate-400 px-1">
          <span>
            {turnCount}/{MAX_TURNS} tours
          </span>
          <span className="hidden sm:inline">
            Entrée pour envoyer · Maj + Entrée pour aller à la ligne
          </span>
        </div>
      </div>
    </div>
  );
}
