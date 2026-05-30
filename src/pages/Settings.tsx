import { useState, useEffect, useMemo, useRef } from "react";
import {
  Save,
  Bell,
  ChevronRight,
  Mail,
  TrendingDown,
  Calendar,
  Sun,
  Moon,
  User,
  Loader2,
  Users as UsersIcon,
  Plus,
  Edit2,
  Trash2,
  X,
  Eye,
  EyeOff,
  Camera,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

// File → data URL with size + type validation
function readImageAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!/^image\/(jpeg|jpg|png|webp)$/.test(file.type)) {
      return reject(new Error("Format d'image invalide (JPEG, PNG ou WebP)"));
    }
    if (file.size > 2 * 1024 * 1024) {
      return reject(new Error("Image trop volumineuse (max 2 Mo)"));
    }
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Lecture du fichier échouée"));
    reader.readAsDataURL(file);
  });
}

type Thresholds = { ctrGap: number; drift: number };
type Notifications = { positionDrop: boolean; upcomingEvents: boolean };
type StoredSettings = {
  thresholds?: Thresholds;
  notifications?: Notifications;
};

const DEFAULT_THRESHOLDS: Thresholds = { ctrGap: 2.5, drift: 3 };
const DEFAULT_NOTIFICATIONS: Notifications = { positionDrop: true, upcomingEvents: true };

export default function Settings() {
  const [activeTab, setActiveTab] = useState("alerts");
  const [thresholds, setThresholds] = useState<Thresholds>(DEFAULT_THRESHOLDS);
  const [notifications, setNotifications] = useState<Notifications>(DEFAULT_NOTIFICATIONS);
  const [darkMode, setDarkMode] = useState(() =>
    document.documentElement.classList.contains("dark")
  );
  const [profile, setProfile] = useState({
    email: JSON.parse(localStorage.getItem("user") || "{}").email || "",
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });

  const [loadingSettings, setLoadingSettings] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [profileFeedback, setProfileFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  // ── Users tab state ────────────────────────────────────────────────────────
  type UserRow = { id: number; email: string; avatar_url?: string | null; is_admin?: boolean };
  const [users, setUsers] = useState<UserRow[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [userModalOpen, setUserModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<UserRow | null>(null);
  const [userForm, setUserForm] = useState<{ email: string; password: string; avatar: string | null; avatarPreview: string | null; is_admin: boolean }>({
    email: "",
    password: "",
    avatar: null,
    avatarPreview: null,
    is_admin: false,
  });
  const userAvatarInputRef = useRef<HTMLInputElement>(null);
  const [userFormShowPassword, setUserFormShowPassword] = useState(false);
  const [userSaving, setUserSaving] = useState(false);
  const [usersFeedback, setUsersFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  // ── Profile-tab avatar state ──────────────────────────────────────────────
  const [profileAvatar, setProfileAvatar] = useState<string | null>(null); // staged data URL (not yet saved)
  const [profileAvatarUrl, setProfileAvatarUrl] = useState<string | null>(
    JSON.parse(localStorage.getItem("user") || "{}").avatar_url ?? null
  );
  const profileAvatarInputRef = useRef<HTMLInputElement>(null);

  const token = localStorage.getItem("token");
  const currentUser = useMemo(() => {
    try { return JSON.parse(localStorage.getItem("user") || "{}"); }
    catch { return {}; }
  }, []);
  const currentUserId: number | null = currentUser.id ?? null;
  const isAdmin: boolean = currentUser.is_admin === true;

  // ── Load persisted settings on mount ──────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/settings", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: StoredSettings = await res.json();
        if (cancelled) return;
        if (data.thresholds) setThresholds({ ...DEFAULT_THRESHOLDS, ...data.thresholds });
        if (data.notifications) setNotifications({ ...DEFAULT_NOTIFICATIONS, ...data.notifications });
      } catch (err) {
        console.error("Settings load error:", err);
      } finally {
        if (!cancelled) setLoadingSettings(false);
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  // ── Persist settings (debounced via explicit save buttons) ────────────────
  const persistSettings = async (next: StoredSettings) => {
    setSaving(true);
    setFeedback(null);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          thresholds: next.thresholds ?? thresholds,
          notifications: next.notifications ?? notifications,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setFeedback({ type: "success", message: "Modifications enregistrées" });
    } catch (err: any) {
      setFeedback({ type: "error", message: err.message || "Erreur d'enregistrement" });
    } finally {
      setSaving(false);
      setTimeout(() => setFeedback(null), 3000);
    }
  };

  const toggleNotification = (key: keyof Notifications) => {
    const next = { ...notifications, [key]: !notifications[key] };
    setNotifications(next);
    persistSettings({ notifications: next });
  };

  const handleSaveThresholds = () => persistSettings({ thresholds });

  const handleToggleDark = () => {
    const newMode = !darkMode;
    setDarkMode(newMode);
    document.documentElement.classList.toggle("dark", newMode);
    localStorage.setItem("theme", newMode ? "dark" : "light");
  };

  // ── Profile (email + password) ────────────────────────────────────────────
  const handleSaveProfile = async () => {
    setProfileFeedback(null);
    if (profile.newPassword && profile.newPassword !== profile.confirmPassword) {
      setProfileFeedback({ type: "error", message: "Les mots de passe ne correspondent pas" });
      return;
    }
    setSavingProfile(true);
    try {
      const res = await fetch("/api/profile", {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: profile.email,
          currentPassword: profile.currentPassword,
          newPassword: profile.newPassword || undefined,
          avatar: profileAvatar || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || `Erreur ${res.status}`);
      }
      setProfileFeedback({ type: "success", message: "Profil enregistré" });
      const stored = JSON.parse(localStorage.getItem("user") || "{}");
      const newAvatarUrl = data.avatar_url ?? stored.avatar_url ?? null;
      localStorage.setItem(
        "user",
        JSON.stringify({ ...stored, email: profile.email, avatar_url: newAvatarUrl })
      );
      // Notify App.tsx so the sidebar avatar refreshes instantly
      window.dispatchEvent(new Event("user-updated"));
      setProfileAvatarUrl(newAvatarUrl);
      setProfileAvatar(null); // staged → clear once saved
      setProfile((p) => ({ ...p, currentPassword: "", newPassword: "", confirmPassword: "" }));
    } catch (err: any) {
      setProfileFeedback({ type: "error", message: err.message });
    } finally {
      setSavingProfile(false);
      setTimeout(() => setProfileFeedback(null), 4000);
    }
  };

  // ── Users CRUD ────────────────────────────────────────────────────────────
  const fetchUsers = async () => {
    setUsersLoading(true);
    try {
      const res = await fetch("/api/users", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setUsers(await res.json());
    } catch (err) {
      console.error("fetchUsers error:", err);
      setUsers([]);
    } finally {
      setUsersLoading(false);
    }
  };

  // Auto-load when the tab opens
  useEffect(() => {
    if (activeTab === "users") fetchUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  const openCreateUser = () => {
    setEditingUser(null);
    setUserForm({ email: "", password: "", avatar: null, avatarPreview: null, is_admin: false });
    setUserFormShowPassword(false);
    setUserModalOpen(true);
  };

  const openEditUser = (u: UserRow) => {
    setEditingUser(u);
    setUserForm({
      email: u.email,
      password: "",
      avatar: null,
      avatarPreview: u.avatar_url ?? null,
      is_admin: u.is_admin === true,
    });
    setUserFormShowPassword(false);
    setUserModalOpen(true);
  };

  const handleUserAvatarPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await readImageAsDataUrl(file);
      setUserForm((f) => ({ ...f, avatar: dataUrl, avatarPreview: dataUrl }));
    } catch (err: any) {
      setUsersFeedback({ type: "error", message: err.message });
      setTimeout(() => setUsersFeedback(null), 4000);
    } finally {
      e.target.value = ""; // allow re-picking the same file
    }
  };

  const handleUserSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setUserSaving(true);
    setUsersFeedback(null);
    try {
      const isEdit = Boolean(editingUser);
      const url = isEdit ? `/api/users/${editingUser!.id}` : "/api/users";
      const method = isEdit ? "PUT" : "POST";
      const body: any = { email: userForm.email, is_admin: userForm.is_admin };
      if (userForm.password) body.password = userForm.password;
      if (userForm.avatar) body.avatar = userForm.avatar;

      const res = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`);

      setUserModalOpen(false);
      setUsersFeedback({
        type: "success",
        message: isEdit ? "Utilisateur mis à jour" : "Utilisateur créé",
      });
      await fetchUsers();
    } catch (err: any) {
      setUsersFeedback({ type: "error", message: err.message });
    } finally {
      setUserSaving(false);
      setTimeout(() => setUsersFeedback(null), 4000);
    }
  };

  const handleUserDelete = async (u: UserRow) => {
    if (u.id === currentUserId) return;
    if (!window.confirm(`Supprimer l'utilisateur "${u.email}" ? Cette action est irréversible.`)) return;
    setDeletingId(u.id);
    setUsersFeedback(null);
    try {
      const res = await fetch(`/api/users/${u.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`);
      setUsersFeedback({ type: "success", message: "Utilisateur supprimé" });
      await fetchUsers();
    } catch (err: any) {
      setUsersFeedback({ type: "error", message: err.message });
    } finally {
      setDeletingId(null);
      setTimeout(() => setUsersFeedback(null), 4000);
    }
  };

  const menuItems = [
    { key: "alerts", name: "Seuils d'alertes", icon: Bell },
    { key: "notifications", name: "Notifications", icon: Mail },
    { key: "appearance", name: "Apparence", icon: Sun },
    { key: "profile", name: "Profil utilisateur", icon: User },
    ...(isAdmin ? [{ key: "users", name: "Utilisateurs", icon: UsersIcon }] : []),
  ];

  const notificationItems: { key: keyof Notifications; icon: any; label: string; description: string }[] = [
    {
      key: "positionDrop",
      icon: TrendingDown,
      label: "Alerte chute de position",
      description: "Notifier si le drift dépasse le seuil défini",
    },
    {
      key: "upcomingEvents",
      icon: Calendar,
      label: "Rappel événements à venir",
      description: "Notifier les événements du calendrier dans les 3 prochains jours",
    },
  ];

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Paramètres</h1>
          <p className="text-slate-500 mt-1">Personnalisez votre moteur décisionnel SEO.</p>
        </div>
      </div>

      {feedback && (
        <div
          className={`px-5 py-3 rounded-2xl text-sm font-medium border ${
            feedback.type === "success"
              ? "bg-emerald-50 border-emerald-200 text-emerald-700"
              : "bg-red-50 border-red-200 text-red-700"
          }`}
        >
          {feedback.message}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        <div className="space-y-2">
          {menuItems.map((item) => (
            <button
              key={item.key}
              onClick={() => setActiveTab(item.key)}
              className={`w-full flex items-center justify-between px-4 py-3 rounded-xl text-sm font-bold transition-all ${
                activeTab === item.key
                  ? "bg-indigo-50 text-indigo-600"
                  : "text-slate-500 hover:bg-slate-50 hover:text-slate-900"
              }`}
            >
              <div className="flex items-center gap-3">
                <item.icon className="w-4 h-4" />
                {item.name}
              </div>
              <ChevronRight className={`w-4 h-4 ${activeTab === item.key ? "opacity-100" : "opacity-0"}`} />
            </button>
          ))}
        </div>

        <div className="md:col-span-2 space-y-8">
          {/* Alerts */}
          {activeTab === "alerts" && (
            <section className="bg-white p-8 rounded-[2.5rem] border border-slate-100 shadow-sm">
              <h3 className="text-xl font-bold text-slate-900 mb-6 flex items-center gap-2">
                <Bell className="w-5 h-5 text-amber-500" />
                Seuils d'alertes
              </h3>

              <div className="grid grid-cols-2 gap-6">
                <div className="space-y-2">
                  <label className="text-sm font-bold text-slate-700">Seuil CTR gap (%)</label>
                  <input
                    type="number"
                    step="0.1"
                    value={thresholds.ctrGap}
                    onChange={(e) => setThresholds({ ...thresholds, ctrGap: parseFloat(e.target.value) || 0 })}
                    className="w-full px-5 py-3 bg-slate-50 border border-slate-200 rounded-2xl"
                    disabled={loadingSettings}
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-bold text-slate-700">Seuil Drift (pos)</label>
                  <input
                    type="number"
                    value={thresholds.drift}
                    onChange={(e) => setThresholds({ ...thresholds, drift: parseInt(e.target.value) || 0 })}
                    className="w-full px-5 py-3 bg-slate-50 border border-slate-200 rounded-2xl"
                    disabled={loadingSettings}
                  />
                </div>
              </div>

              <button
                onClick={handleSaveThresholds}
                disabled={saving || loadingSettings}
                className="mt-6 inline-flex items-center gap-2 px-5 py-2.5 bg-indigo-600 text-white text-sm font-bold rounded-xl hover:bg-indigo-700 disabled:opacity-60"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Enregistrer
              </button>
            </section>
          )}

          {/* Notifications */}
          {activeTab === "notifications" && (
            <section className="bg-white p-8 rounded-[2.5rem] border border-slate-100 shadow-sm">
              <h3 className="text-xl font-bold text-slate-900 mb-6 flex items-center gap-2">
                <Mail className="w-5 h-5 text-indigo-500" />
                Notifications
              </h3>

              <div className="space-y-4">
                {notificationItems.map(({ key, icon: Icon, label, description }) => (
                  <div
                    key={key}
                    className="flex items-center justify-between p-4 rounded-2xl bg-slate-50 border border-slate-100"
                  >
                    <div className="flex items-center gap-4">
                      <div className="w-9 h-9 rounded-xl bg-indigo-50 flex items-center justify-center flex-shrink-0">
                        <Icon className="w-4 h-4 text-indigo-500" />
                      </div>
                      <div>
                        <p className="text-sm font-bold text-slate-800">{label}</p>
                        <p className="text-xs text-slate-400 mt-0.5">{description}</p>
                      </div>
                    </div>
                    <button
                      onClick={() => toggleNotification(key)}
                      disabled={loadingSettings}
                      className={`relative w-11 h-6 rounded-full transition-colors duration-200 flex-shrink-0 ${
                        notifications[key] ? "bg-indigo-600" : "bg-slate-200"
                      } disabled:opacity-60`}
                    >
                      <span
                        className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-all duration-200 ${
                          notifications[key] ? "left-6" : "left-1"
                        }`}
                      />
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Appearance */}
          {activeTab === "appearance" && (
            <section className="bg-white p-8 rounded-[2.5rem] border border-slate-100 shadow-sm">
              <h3 className="text-xl font-bold text-slate-900 mb-6 flex items-center gap-2">
                <Sun className="w-5 h-5 text-amber-500" />
                Apparence
              </h3>

              <div className="flex items-center justify-between p-4 rounded-2xl bg-slate-50 border border-slate-100">
                <div className="flex items-center gap-4">
                  <div className="w-9 h-9 rounded-xl bg-amber-50 flex items-center justify-center flex-shrink-0">
                    {darkMode ? <Moon className="w-4 h-4 text-amber-500" /> : <Sun className="w-4 h-4 text-amber-500" />}
                  </div>
                  <div>
                    <p className="text-sm font-bold text-slate-800">{darkMode ? "Mode sombre" : "Mode clair"}</p>
                    <p className="text-xs text-slate-400 mt-0.5">Changer l'apparence de l'application</p>
                  </div>
                </div>
                <button
                  onClick={handleToggleDark}
                  className={`relative w-11 h-6 rounded-full transition-colors duration-200 flex-shrink-0 ${
                    darkMode ? "bg-indigo-600" : "bg-slate-200"
                  }`}
                >
                  <span
                    className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-all duration-200 ${
                      darkMode ? "left-6" : "left-1"
                    }`}
                  />
                </button>
              </div>
            </section>
          )}

          {/* Profile */}
          {activeTab === "profile" && (
            <section className="bg-white p-8 rounded-[2.5rem] border border-slate-100 shadow-sm">
              <h3 className="text-xl font-bold text-slate-900 mb-6 flex items-center gap-2">
                <User className="w-5 h-5 text-indigo-500" />
                Profil utilisateur
              </h3>

              {profileFeedback && (
                <div
                  className={`mb-4 px-4 py-3 rounded-2xl text-sm font-medium border ${
                    profileFeedback.type === "success"
                      ? "bg-emerald-50 border-emerald-200 text-emerald-700"
                      : "bg-red-50 border-red-200 text-red-700"
                  }`}
                >
                  {profileFeedback.message}
                </div>
              )}

              <div className="space-y-6">
                <div className="flex items-center gap-4 p-4 rounded-2xl bg-slate-50 border border-slate-100">
                  <div className="relative shrink-0">
                    <button
                      type="button"
                      onClick={() => profileAvatarInputRef.current?.click()}
                      className="w-16 h-16 rounded-2xl overflow-hidden bg-indigo-100 hover:ring-2 hover:ring-indigo-500 transition-all flex items-center justify-center text-indigo-600 font-bold text-xl"
                      title="Changer la photo"
                    >
                      {(profileAvatar || profileAvatarUrl) ? (
                        <img
                          src={profileAvatar || profileAvatarUrl || ""}
                          alt={profile.email}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        profile.email[0]?.toUpperCase()
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => profileAvatarInputRef.current?.click()}
                      className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-indigo-600 hover:bg-indigo-700 text-white flex items-center justify-center shadow-md"
                      title="Changer la photo"
                    >
                      <Camera className="w-3.5 h-3.5" />
                    </button>
                    <input
                      ref={profileAvatarInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="hidden"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        e.target.value = "";
                        if (!file) return;
                        try {
                          const dataUrl = await readImageAsDataUrl(file);
                          setProfileAvatar(dataUrl);
                          setProfileFeedback({ type: "success", message: "Photo prête — cliquez sur Enregistrer pour la sauvegarder." });
                          setTimeout(() => setProfileFeedback(null), 4000);
                        } catch (err: any) {
                          setProfileFeedback({ type: "error", message: err.message });
                          setTimeout(() => setProfileFeedback(null), 4000);
                        }
                      }}
                    />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-slate-800 truncate">{profile.email}</p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {profileAvatar
                        ? "Nouvelle photo (non enregistrée)"
                        : isAdmin
                          ? "Administrateur"
                          : "Utilisateur"}
                    </p>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-bold text-slate-700">Adresse email</label>
                  <input
                    type="email"
                    value={profile.email}
                    onChange={(e) => setProfile({ ...profile, email: e.target.value })}
                    className="w-full px-5 py-3 bg-slate-50 border border-slate-200 rounded-2xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                  />
                </div>

                <div className="border-t border-slate-100 pt-4">
                  <p className="text-sm font-bold text-slate-700 mb-4">Changer le mot de passe</p>
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <label className="text-sm font-bold text-slate-700">Mot de passe actuel</label>
                      <input
                        type="password"
                        value={profile.currentPassword}
                        onChange={(e) => setProfile({ ...profile, currentPassword: e.target.value })}
                        className="w-full px-5 py-3 bg-slate-50 border border-slate-200 rounded-2xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                        placeholder="••••••••"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <label className="text-sm font-bold text-slate-700">Nouveau mot de passe</label>
                        <input
                          type="password"
                          value={profile.newPassword}
                          onChange={(e) => setProfile({ ...profile, newPassword: e.target.value })}
                          className="w-full px-5 py-3 bg-slate-50 border border-slate-200 rounded-2xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                          placeholder="••••••••"
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-bold text-slate-700">Confirmer</label>
                        <input
                          type="password"
                          value={profile.confirmPassword}
                          onChange={(e) => setProfile({ ...profile, confirmPassword: e.target.value })}
                          className="w-full px-5 py-3 bg-slate-50 border border-slate-200 rounded-2xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                          placeholder="••••••••"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                <button
                  onClick={handleSaveProfile}
                  disabled={savingProfile}
                  className="flex items-center justify-center gap-2 w-full px-6 py-3 rounded-2xl font-bold transition-all bg-indigo-600 text-white hover:bg-indigo-700 shadow-lg shadow-indigo-100 disabled:opacity-60"
                >
                  {savingProfile ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
                  Enregistrer les modifications
                </button>
              </div>
            </section>
          )}

          {/* Users — CRUD */}
          {activeTab === "users" && (
            <section className="bg-white p-8 rounded-[2.5rem] border border-slate-100 shadow-sm">
              <div className="flex items-center justify-between gap-4 flex-wrap mb-6">
                <h3 className="text-xl font-bold text-slate-900 flex items-center gap-2">
                  <UsersIcon className="w-5 h-5 text-indigo-600" />
                  Utilisateurs
                </h3>
                <button
                  onClick={openCreateUser}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm font-bold rounded-xl hover:bg-indigo-700 shadow-lg shadow-indigo-100 active:scale-95 transition-all"
                >
                  <Plus className="w-4 h-4" />
                  Ajouter un utilisateur
                </button>
              </div>

              {usersFeedback && (
                <div
                  className={`mb-4 px-4 py-3 rounded-2xl text-sm font-medium border ${
                    usersFeedback.type === "success"
                      ? "bg-emerald-50 border-emerald-200 text-emerald-700"
                      : "bg-red-50 border-red-200 text-red-700"
                  }`}
                >
                  {usersFeedback.message}
                </div>
              )}

              {usersLoading ? (
                <div className="py-12 flex items-center justify-center text-slate-400">
                  <Loader2 className="w-5 h-5 animate-spin mr-2" />
                  Chargement...
                </div>
              ) : users.length === 0 ? (
                <div className="py-12 text-center text-slate-400 text-sm">
                  Aucun utilisateur.
                </div>
              ) : (
                <div className="border border-slate-100 rounded-2xl overflow-x-auto">
                  <table className="w-full text-left">
                    <thead className="bg-slate-50">
                      <tr className="text-[10px] uppercase tracking-wider font-bold text-slate-500">
                        <th className="px-5 py-3">Email</th>
                        <th className="px-5 py-3 text-right whitespace-nowrap">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {users.map((u) => {
                        const isMe = u.id === currentUserId;
                        return (
                          <tr key={u.id} className="hover:bg-slate-50/50 transition-colors">
                            <td className="px-5 py-3">
                              <div className="flex items-center gap-3 min-w-0">
                                <div className="w-8 h-8 rounded-lg overflow-hidden bg-indigo-100 flex items-center justify-center text-indigo-600 font-bold text-sm shrink-0">
                                  {u.avatar_url ? (
                                    <img src={u.avatar_url} alt={u.email} className="w-full h-full object-cover" />
                                  ) : (
                                    u.email[0]?.toUpperCase()
                                  )}
                                </div>
                                <div className="font-medium text-slate-800 truncate min-w-0">{u.email}</div>
                                {u.is_admin && (
                                  <span
                                    title="Administrateur"
                                    className="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider bg-amber-50 text-amber-700 border border-amber-200"
                                  >
                                    👑 Admin
                                  </span>
                                )}
                                {isMe && (
                                  <span className="shrink-0 px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider bg-indigo-50 text-indigo-700 border border-indigo-100">
                                    Vous
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="px-5 py-3 text-right whitespace-nowrap">
                              <div className="inline-flex items-center gap-2">
                                <button
                                  onClick={() => openEditUser(u)}
                                  title="Modifier l'utilisateur"
                                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-indigo-50 text-indigo-700 border border-indigo-100 hover:bg-indigo-100 transition-all"
                                >
                                  <Edit2 className="w-3.5 h-3.5" />
                                  Modifier
                                </button>
                                <button
                                  onClick={() => handleUserDelete(u)}
                                  disabled={isMe || deletingId === u.id}
                                  title={isMe ? "Vous ne pouvez pas supprimer votre propre compte" : "Supprimer cet utilisateur"}
                                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-red-50 text-red-700 border border-red-100 hover:bg-red-100 transition-all disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-red-50"
                                >
                                  {deletingId === u.id
                                    ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                    : <Trash2 className="w-3.5 h-3.5" />}
                                  Supprimer
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}
        </div>
      </div>

      {/* User create/edit modal */}
      <AnimatePresence>
        {userModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setUserModalOpen(false)}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 16 }}
              className="relative w-full max-w-md bg-white rounded-[2rem] shadow-2xl overflow-hidden"
            >
              <div className="p-7 border-b border-slate-100 flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-bold text-slate-900">
                    {editingUser ? "Modifier l'utilisateur" : "Nouvel utilisateur"}
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {editingUser
                      ? "Mettez à jour l'email ou réinitialisez le mot de passe."
                      : "Définissez l'email et un mot de passe initial."}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setUserModalOpen(false)}
                  className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-slate-700 transition-all"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form onSubmit={handleUserSave} className="p-7 space-y-5">
                {/* Avatar picker */}
                <div className="flex flex-col items-center gap-2">
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => userAvatarInputRef.current?.click()}
                      className="w-20 h-20 rounded-full bg-slate-100 border-2 border-dashed border-slate-300 hover:border-indigo-500 hover:bg-indigo-50 transition-all flex items-center justify-center overflow-hidden focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      title="Choisir une photo"
                    >
                      {userForm.avatarPreview ? (
                        <img src={userForm.avatarPreview} alt="Aperçu" className="w-full h-full object-cover" />
                      ) : (
                        <Camera className="w-6 h-6 text-slate-400" />
                      )}
                    </button>
                    {userForm.avatarPreview && (
                      <button
                        type="button"
                        onClick={() => setUserForm((f) => ({ ...f, avatar: null, avatarPreview: null }))}
                        className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-red-500 hover:bg-red-600 text-white flex items-center justify-center shadow"
                        title="Retirer"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                  <p className="text-[11px] text-slate-400">
                    {userForm.avatarPreview ? "Photo sélectionnée" : "Photo (optionnel)"}
                  </p>
                  <input
                    ref={userAvatarInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={handleUserAvatarPick}
                    className="hidden"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-wider text-slate-500 ml-1">Email</label>
                  <input
                    type="email"
                    required
                    value={userForm.email}
                    onChange={(e) => setUserForm({ ...userForm, email: e.target.value })}
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 focus:bg-white outline-none transition-all"
                    placeholder="nom@exemple.com"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-wider text-slate-500 ml-1">
                    Mot de passe {editingUser && <span className="text-slate-400 font-normal normal-case ml-1">(laisser vide pour ne pas changer)</span>}
                  </label>
                  <div className="relative">
                    <input
                      type={userFormShowPassword ? "text" : "password"}
                      required={!editingUser}
                      minLength={6}
                      value={userForm.password}
                      onChange={(e) => setUserForm({ ...userForm, password: e.target.value })}
                      className="w-full pr-11 px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 focus:bg-white outline-none transition-all"
                      placeholder={editingUser ? "••••••••" : "Min. 6 caractères"}
                    />
                    <button
                      type="button"
                      onClick={() => setUserFormShowPassword((v) => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                    >
                      {userFormShowPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {/* Admin toggle — disabled when editing yourself to avoid lockout */}
                <label
                  className={`flex items-center justify-between gap-3 p-4 rounded-2xl border transition-all ${
                    userForm.is_admin
                      ? "bg-amber-50 border-amber-200"
                      : "bg-slate-50 border-slate-100"
                  } ${editingUser?.id === currentUserId ? "opacity-60 cursor-not-allowed" : "cursor-pointer"}`}
                  title={editingUser?.id === currentUserId ? "Vous ne pouvez pas modifier votre propre rôle ici" : ""}
                >
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">👑</span>
                    <div>
                      <p className="text-sm font-bold text-slate-800">Administrateur</p>
                      <p className="text-xs text-slate-500 mt-0.5">
                        Peut gérer tous les utilisateurs (créer, modifier, supprimer).
                      </p>
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={userForm.is_admin}
                    disabled={editingUser?.id === currentUserId}
                    onChange={(e) => setUserForm({ ...userForm, is_admin: e.target.checked })}
                    className="w-5 h-5 rounded border-slate-300 text-amber-600 focus:ring-amber-500"
                  />
                </label>

                <div className="flex gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setUserModalOpen(false)}
                    className="flex-1 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold text-sm transition-all"
                  >
                    Annuler
                  </button>
                  <button
                    type="submit"
                    disabled={userSaving}
                    className="flex-1 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold text-sm shadow-lg shadow-indigo-100 transition-all disabled:opacity-60 inline-flex items-center justify-center gap-2"
                  >
                    {userSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                    {editingUser ? "Enregistrer" : "Créer"}
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
