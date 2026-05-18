import React, { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Eye, EyeOff, Lock, ArrowRight, CheckCircle2, AlertCircle } from "lucide-react";
import { motion } from "motion/react";

export default function ResetPassword() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get("token") || "";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const tokenMissing = useMemo(() => !token || token.length < 16, [token]);

  useEffect(() => {
    if (success) {
      const t = setTimeout(() => navigate("/login"), 3000);
      return () => clearTimeout(t);
    }
  }, [success, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (password.length < 6) {
      setError("Le mot de passe doit contenir au moins 6 caractères");
      return;
    }
    if (password !== confirm) {
      setError("Les mots de passe ne correspondent pas");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`);
      setSuccess(true);
    } catch (err: any) {
      setError(err.message || "Une erreur est survenue");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#F8FAFC] via-white to-indigo-50/40 p-4 relative overflow-hidden">
      <div className="absolute -top-40 -right-40 w-[500px] h-[500px] bg-indigo-200/30 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute -bottom-40 -left-40 w-[500px] h-[500px] bg-blue-200/30 rounded-full blur-[120px] pointer-events-none" />

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative w-full max-w-md bg-white rounded-3xl shadow-xl shadow-slate-200/60 p-10 border border-slate-100"
      >
        <div className="text-center mb-10">
          <div className="flex flex-col items-center gap-4 mb-6">
            <img
              src="/logo-bleu-waoo.png"
              alt="Waoo"
              className="h-16 w-auto object-contain select-none"
              draggable={false}
            />
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold uppercase tracking-[0.25em] text-indigo-600">SEO BI</span>
              <span className="h-1 w-1 rounded-full bg-slate-300" />
              <span className="text-xs font-medium text-slate-400">by Waoo</span>
            </div>
          </div>

          <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Nouveau mot de passe</h1>
          <p className="text-slate-500 mt-2">
            Choisissez un nouveau mot de passe pour votre compte.
          </p>
        </div>

        {tokenMissing ? (
          <div className="p-5 bg-red-50 border border-red-100 rounded-2xl text-red-700 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
            <div>
              <p className="font-bold text-sm">Lien invalide</p>
              <p className="text-xs mt-1">
                Le lien de réinitialisation est manquant ou incorrect. Demandez un nouveau lien depuis la page de connexion.
              </p>
              <Link to="/login" className="inline-block mt-3 text-sm font-bold text-red-700 underline hover:no-underline">
                Retour à la connexion
              </Link>
            </div>
          </div>
        ) : success ? (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="p-5 bg-emerald-50 border border-emerald-100 rounded-2xl text-emerald-700 flex items-start gap-3"
          >
            <CheckCircle2 className="w-5 h-5 shrink-0 mt-0.5" />
            <div>
              <p className="font-bold text-sm">Mot de passe mis à jour ✓</p>
              <p className="text-xs mt-1">
                Vous pouvez maintenant vous connecter avec votre nouveau mot de passe.
                Redirection automatique dans quelques secondes…
              </p>
              <Link to="/login" className="inline-block mt-3 text-sm font-bold text-emerald-700 underline hover:no-underline">
                Aller à la connexion
              </Link>
            </div>
          </motion.div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-2">
              <label className="text-sm font-semibold text-slate-700 ml-1">Nouveau mot de passe</label>
              <div className="relative">
                <Lock className="w-5 h-5 absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-12 pr-12 py-3.5 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all outline-none text-slate-900"
                  placeholder="••••••••"
                  required
                  minLength={6}
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                >
                  {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
              <p className="text-xs text-slate-400 ml-1">Minimum 6 caractères.</p>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-semibold text-slate-700 ml-1">Confirmer</label>
              <div className="relative">
                <Lock className="w-5 h-5 absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type={showPassword ? "text" : "password"}
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  className="w-full pl-12 pr-4 py-3.5 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all outline-none text-slate-900"
                  placeholder="••••••••"
                  required
                  autoComplete="new-password"
                />
              </div>
            </div>

            {error && (
              <motion.div
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                className="p-3 bg-red-50 border border-red-100 text-red-600 text-sm rounded-xl text-center font-medium"
              >
                {error}
              </motion.div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl font-bold shadow-lg shadow-indigo-200 transition-all flex items-center justify-center gap-2 group disabled:opacity-70"
            >
              {loading ? "Enregistrement..." : "Réinitialiser le mot de passe"}
              <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
            </button>

            <div className="text-center text-sm text-slate-500">
              <Link to="/login" className="text-indigo-600 font-bold hover:text-indigo-700 transition-colors">
                Retour à la connexion
              </Link>
            </div>
          </form>
        )}
      </motion.div>
    </div>
  );
}
