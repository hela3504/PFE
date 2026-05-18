import { Outlet, Link, useLocation, useNavigate } from "react-router-dom";
import { 
  LayoutDashboard, 
  Briefcase, 
  Target, 
  LineChart, 
  Calendar as CalendarIcon, 
  Settings as SettingsIcon, 
  LogOut,
  Menu,
  ChevronRight,
  Search
} from "lucide-react";
import { useState } from "react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface LayoutProps {
  user: any;
  onLogout: () => void;
}

export default function Layout({ user, onLogout }: LayoutProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  const navItems = [
    { name: "Menu", path: "/", icon: Menu },
    { name: "Projets", path: "/projects", icon: Briefcase },
    { name: "Tableau de bord", path: "/dashboard", icon: LayoutDashboard },
    { name: "Opportunités", path: "/opportunities", icon: Target },
    { name: "Suivi", path: "/tracking", icon: LineChart },
    { name: "Calendrier", path: "/calendar", icon: CalendarIcon },
    { name: "Paramètres", path: "/settings", icon: SettingsIcon },
  ];

  return (
    <div className="flex h-screen bg-[#F5F5F5] dark:bg-slate-950 font-sans text-slate-900 dark:text-slate-100">
      {/* Sidebar */}
      <aside className={cn(
        "bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-700 transition-all duration-300 flex flex-col",
        isSidebarOpen ? "w-64" : "w-20"
      )}>
        <div className="p-6 flex items-center gap-3">
          <img
            src="/logo-bleu-waoo.png"
            alt="Waoo"
            className="h-8 w-auto object-contain select-none shrink-0"
            draggable={false}
          />
          {isSidebarOpen && (
            <div className="flex flex-col leading-tight min-w-0">
              <span className="font-bold text-base tracking-tight text-slate-900 dark:text-white truncate">SEO BI</span>
              <span className="text-[10px] font-medium text-slate-400 dark:text-slate-500 uppercase tracking-[0.18em]">par Waoo</span>
            </div>
          )}
        </div>

        <nav className="flex-1 px-4 space-y-2 mt-4">
          {navItems.map((item) => {
            const isActive = location.pathname === item.path;
            return (
              <Link
                key={item.path}
                to={item.path}
                className={cn(
                  "flex items-center gap-3 px-3 py-2 rounded-xl transition-all group",
                  isActive 
                    ? "bg-indigo-50 text-indigo-600 font-medium" 
                    : "text-slate-500 hover:bg-slate-50 hover:text-slate-900"
                )}
              >
                <item.icon className={cn("w-5 h-5", isActive ? "text-indigo-600" : "text-slate-400 group-hover:text-slate-600")} />
                {isSidebarOpen && <span>{item.name}</span>}
              </Link>
            );
          })}
        </nav>

<div className="p-4 border-t border-slate-100 dark:border-slate-700">
            <button
            onClick={onLogout}
            className="flex items-center gap-3 px-3 py-2 w-full text-slate-500 hover:bg-red-50 hover:text-red-600 rounded-xl transition-all"
          >
            <LogOut className="w-5 h-5" />
            {isSidebarOpen && <span>Déconnexion</span>}
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Topbar */}
        <header className="h-16 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between px-8">
          <div className="flex items-center gap-4">
            <button 
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
              className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
            >
              <Menu className="w-5 h-5 text-slate-500" />
            </button>
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input 
                type="text" 
                placeholder="Rechercher..." 
                className="pl-10 pr-4 py-2 bg-slate-50 dark:bg-slate-800 dark:text-slate-100 border-none rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 w-64"              />
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="text-right">
              <div className="text-sm font-medium">{user.email}</div>
              <div className="text-xs text-slate-500">Administrateur</div>
            </div>
            <div className="w-10 h-10 rounded-full overflow-hidden bg-slate-200 flex items-center justify-center font-bold text-slate-600">
              {user.avatar_url ? (
                <img src={user.avatar_url} alt={user.email} className="w-full h-full object-cover" />
              ) : (
                user.email[0].toUpperCase()
              )}
            </div>
          </div>
        </header>

        {/* Page Content */}
        <div className="flex-1 overflow-y-auto p-8 dark:bg-slate-950">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
