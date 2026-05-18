import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useState, useEffect } from "react";
import Login from "./pages/Login";
import Hub from "./pages/Hub";
import Projects from "./pages/Projects";
import Dashboard from "./pages/Dashboard";
import Opportunities from "./pages/Opportunities";
import Tracking from "./pages/Tracking";
import Calendar from "./pages/Calendar";
import Settings from "./pages/Settings";
import ResetPassword from "./pages/ResetPassword";
import Layout from "./components/Layout";

// Global 401 interceptor: any /api/* response with 401 forces logout + redirect.
// Installed once, before any component mounts.
if (typeof window !== "undefined" && !(window as any).__authFetchPatched) {
  (window as any).__authFetchPatched = true;
  const orig = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const res = await orig(input, init);
    const url = typeof input === "string" ? input : (input as any)?.url ?? "";
    if (res.status === 401 && String(url).includes("/api/")) {
      localStorage.removeItem("user");
      localStorage.removeItem("token");
      if (window.location.pathname !== "/login") {
        window.location.assign("/login");
      }
    }
    return res;
  };
}

export default function App() {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const theme = localStorage.getItem("theme");
    if (theme === "dark") document.documentElement.classList.add("dark");

    const storedUser = localStorage.getItem("user");
    const token = localStorage.getItem("token");
    if (storedUser && token) {
      setUser(JSON.parse(storedUser));
    }
    setLoading(false);

    // Reload user from localStorage when another component (e.g. Settings)
    // writes to it — keeps the sidebar avatar in sync after profile updates.
    const refresh = () => {
      const fresh = localStorage.getItem("user");
      if (fresh) setUser(JSON.parse(fresh));
    };
    window.addEventListener("user-updated", refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener("user-updated", refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  const handleLogin = (userData: any, token: string) => {
    localStorage.setItem("user", JSON.stringify(userData));
    localStorage.setItem("token", token);
    setUser(userData);
  };

  const handleLogout = () => {
    localStorage.removeItem("user");
    localStorage.removeItem("token");
    setUser(null);
  };

  if (loading) return <div className="h-screen w-screen flex items-center justify-center">Loading...</div>;

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={user ? <Navigate to="/" /> : <Login onLogin={handleLogin} />} />
        <Route path="/reset-password" element={<ResetPassword />} />

        <Route element={user ? <Layout user={user} onLogout={handleLogout} /> : <Navigate to="/login" />}>
          <Route path="/" element={<Hub />} />
          <Route path="/projects" element={<Projects />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/opportunities" element={<Opportunities />} />
          <Route path="/tracking" element={<Tracking />} />
          <Route path="/calendar" element={<Calendar />} />
          <Route path="/settings" element={<Settings />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
