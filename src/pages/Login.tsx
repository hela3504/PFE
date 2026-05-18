import React, { useRef, useState } from "react";
import { Eye, EyeOff, Lock, Mail, ArrowRight, Camera, X } from "lucide-react";
import { motion } from "motion/react";

interface LoginProps {
  onLogin: (user: any, token: string) => void;
}

type Mode = "login" | "signup" | "forgot";

export default function Login({ onLogin }: LoginProps) {
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("admin@example.com");
  const [password, setPassword] = useState("password123");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [avatar, setAvatar] = useState<string | null>(null); // data URL
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);

  const handleAvatarPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!/^image\/(jpeg|jpg|png|webp)$/.test(file.type)) {
      setError("Format d'image invalide (JPEG, PNG ou WebP)");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setError("Image trop volumineuse (max 2 Mo)");
      return;
    }
    setError("");
    const reader = new FileReader();
    reader.onload = () => setAvatar(reader.result as string);
    reader.readAsDataURL(file);
  };

  const switchMode = (next: Mode) => {
    setMode(next);
    setError("");
    setSuccess("");
    setAvatar(null);
    if (next === "signup" || next === "forgot") {
      setEmail("");
      setPassword("");
      setConfirmPassword("");
    } else {
      setConfirmPassword("");
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess("");

    if (mode === "signup") {
      if (password.length < 6) {
        setError("Le mot de passe doit contenir au moins 6 caractères");
        return;
      }
      if (password !== confirmPassword) {
        setError("Les mots de passe ne correspondent pas");
        return;
      }
    }

    setLoading(true);
    try {
      if (mode === "forgot") {
        await fetch("/api/auth/forgot-password", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email }),
        });
        // Always show success — backend doesn't reveal whether email exists
        setSuccess("Si un compte existe avec cet email, un lien de réinitialisation vous a été envoyé. Pensez à vérifier vos spams.");
        return;
      }

      const path = mode === "signup" ? "/api/auth/signup" : "/api/auth/login";
      const body: any = { email, password };
      if (mode === "signup" && avatar) body.avatar = avatar;
      const res = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (res.ok) {
        onLogin(data.user, data.token);
      } else {
        setError(data.error || "Une erreur est survenue");
      }
    } catch {
      setError("Impossible de se connecter au serveur");
    } finally {
      setLoading(false);
    }
  };

  const isSignup = mode === "signup";

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#F8FAFC] via-white to-indigo-50/40 p-4 relative overflow-hidden">
      {/* Soft background blobs to add depth without overpowering the logo */}
      <div className="absolute -top-40 -right-40 w-[500px] h-[500px] bg-indigo-200/30 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute -bottom-40 -left-40 w-[500px] h-[500px] bg-blue-200/30 rounded-full blur-[120px] pointer-events-none" />

      <motion.div
        key={mode}
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative w-full max-w-md bg-white rounded-3xl shadow-xl shadow-slate-200/60 p-10 border border-slate-100"
      >
        {/* ── Brand header ──────────────────────────────────────────────── */}
        <div className="text-center mb-10">
          <div className="flex flex-col items-center gap-4 mb-6">
            <img
              src="/logo-bleu-waoo.png"
              alt="Waoo"
              className="h-16 w-auto object-contain select-none"
              draggable={false}
            />
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold uppercase tracking-[0.25em] text-indigo-600">
                SEO BI
              </span>
              <span className="h-1 w-1 rounded-full bg-slate-300" />
              <span className="text-xs font-medium text-slate-400">by Waoo</span>
            </div>
          </div>

          <h1 className="text-3xl font-bold text-slate-900 tracking-tight">
            {mode === "signup"
              ? "Créer un compte"
              : mode === "forgot"
                ? "Mot de passe oublié"
                : "Bienvenue"}
          </h1>
          <p className="text-slate-500 mt-2">
            {mode === "signup"
              ? "Créez votre espace SEO BI en quelques secondes."
              : mode === "forgot"
                ? "Entrez votre email — nous vous enverrons un lien pour réinitialiser votre mot de passe."
                : "Connectez-vous à votre espace SEO BI"}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {mode === "signup" && (
            <div className="flex flex-col items-center gap-3">
              <div className="relative group">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="w-24 h-24 rounded-full bg-slate-100 border-2 border-dashed border-slate-300 hover:border-indigo-500 hover:bg-indigo-50 transition-all flex items-center justify-center overflow-hidden focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  title="Ajouter une photo"
                >
                  {avatar ? (
                    <img src={avatar} alt="Aperçu" className="w-full h-full object-cover" />
                  ) : (
                    <Camera className="w-7 h-7 text-slate-400 group-hover:text-indigo-500 transition-colors" />
                  )}
                </button>
                {avatar && (
                  <button
                    type="button"
                    onClick={() => setAvatar(null)}
                    className="absolute -top-1 -right-1 w-6 h-6 rounded-full bg-red-500 hover:bg-red-600 text-white flex items-center justify-center shadow-md transition-all"
                    title="Retirer la photo"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              <p className="text-xs text-slate-400 text-center">
                {avatar ? "Photo prête" : "Ajouter une photo (optionnel)"}
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={handleAvatarPick}
                className="hidden"
              />
            </div>
          )}

          <div className="space-y-2">
            <label className="text-sm font-semibold text-slate-700 ml-1">Email</label>
            <div className="relative">
              <Mail className="w-5 h-5 absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full pl-12 pr-4 py-3.5 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all outline-none text-slate-900"
                placeholder="nom@exemple.com"
                required
                autoComplete="email"
              />
            </div>
          </div>

          {mode !== "forgot" && (
            <div className="space-y-2">
              <label className="text-sm font-semibold text-slate-700 ml-1">Mot de passe</label>
              <div className="relative">
                <Lock className="w-5 h-5 absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-12 pr-12 py-3.5 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all outline-none text-slate-900"
                  placeholder="••••••••"
                  required
                  minLength={isSignup ? 6 : undefined}
                  autoComplete={isSignup ? "new-password" : "current-password"}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                >
                  {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
              {isSignup && (
                <p className="text-xs text-slate-400 ml-1">Minimum 6 caractères.</p>
              )}
            </div>
          )}

          {isSignup && (
            <div className="space-y-2">
              <label className="text-sm font-semibold text-slate-700 ml-1">Confirmer le mot de passe</label>
              <div className="relative">
                <Lock className="w-5 h-5 absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type={showPassword ? "text" : "password"}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full pl-12 pr-4 py-3.5 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all outline-none text-slate-900"
                  placeholder="••••••••"
                  required
                  autoComplete="new-password"
                />
              </div>
            </div>
          )}

          {error && (
            <motion.div
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              className="p-3 bg-red-50 border border-red-100 text-red-600 text-sm rounded-xl text-center font-medium"
            >
              {error}
            </motion.div>
          )}

          {success && (
            <motion.div
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              className="p-4 bg-emerald-50 border border-emerald-100 text-emerald-700 text-sm rounded-xl font-medium leading-relaxed"
            >
              {success}
            </motion.div>
          )}

          {mode === "login" && (
            <div className="flex items-center justify-between text-sm">
              <label className="flex items-center gap-2 cursor-pointer group">
                <input type="checkbox" className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" />
                <span className="text-slate-600 group-hover:text-slate-900 transition-colors">Se souvenir de moi</span>
              </label>
              <button
                type="button"
                onClick={() => switchMode("forgot")}
                className="text-indigo-600 font-semibold hover:text-indigo-700 transition-colors"
              >
                Mot de passe oublié ?
              </button>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl font-bold shadow-lg shadow-indigo-200 transition-all flex items-center justify-center gap-2 group disabled:opacity-70"
          >
            {loading
              ? mode === "signup" ? "Création..." : mode === "forgot" ? "Envoi..." : "Connexion..."
              : mode === "signup" ? "Créer mon compte" : mode === "forgot" ? "Envoyer le lien" : "Se connecter"}
            <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
          </button>
        </form>

        <div className="mt-8 text-center text-sm text-slate-500">
          {mode === "signup" ? (
            <>
              Déjà un compte ?{" "}
              <button
                type="button"
                onClick={() => switchMode("login")}
                className="text-indigo-600 font-bold hover:text-indigo-700 transition-colors"
              >
                Se connecter
              </button>
            </>
          ) : mode === "forgot" ? (
            <button
              type="button"
              onClick={() => switchMode("login")}
              className="text-indigo-600 font-bold hover:text-indigo-700 transition-colors"
            >
              ← Retour à la connexion
            </button>
          ) : (
            <>
              Pas encore de compte ?{" "}
              <button
                type="button"
                onClick={() => switchMode("signup")}
                className="text-indigo-600 font-bold hover:text-indigo-700 transition-colors"
              >
                Créer un compte
              </button>
            </>
          )}
        </div>
      </motion.div>
    </div>
  );
}
