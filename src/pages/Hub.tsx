import { motion } from "motion/react";
import { 
  LayoutDashboard, 
  Target, 
  LineChart, 
  Briefcase, 
  Calendar, 
  Settings,
  ChevronRight
} from "lucide-react";
import { Link } from "react-router-dom";

const cards = [
  { 
    title: "Dashboard", 
    desc: "Vue synthétique du SEO global et KPIs principaux.", 
    icon: LayoutDashboard, 
    path: "/dashboard", 
    color: "bg-blue-500",
    lightColor: "bg-blue-50"
  },
  { 
    title: "Opportunités", 
    desc: "Identifiez les mots-clés faciles à positionner.", 
    icon: Target, 
    path: "/opportunities", 
    color: "bg-emerald-500",
    lightColor: "bg-emerald-50"
  },
  { 
    title: "Suivi", 
    desc: "Monitoring et contrôle des mots-clés travaillés.", 
    icon: LineChart, 
    path: "/tracking", 
    color: "bg-indigo-500",
    lightColor: "bg-indigo-50"
  },
  { 
    title: "Projets", 
    desc: "Gérez vos sites web et configurations dédiées.", 
    icon: Briefcase, 
    path: "/projects", 
    color: "bg-amber-500",
    lightColor: "bg-amber-50"
  },
  { 
    title: "Calendrier", 
    desc: "Planifiez vos optimisations et rappels stratégiques.", 
    icon: Calendar, 
    path: "/calendar", 
    color: "bg-rose-500",
    lightColor: "bg-rose-50"
  },
  { 
    title: "Paramètres", 
    desc: "Personnalisation du moteur décisionnel et scoring.", 
    icon: Settings, 
    path: "/settings", 
    color: "bg-slate-500",
    lightColor: "bg-slate-50"
  },
];

export default function Hub() {
  return (
    <div className="max-w-6xl mx-auto">
      <header className="mb-12">
        <h1 className="text-4xl font-bold text-slate-900 tracking-tight">Menu</h1>
        <p className="text-slate-500 mt-2 text-lg">Accédez rapidement à toutes les fonctionnalités de votre cockpit SEO.</p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
        {cards.map((card, index) => (
          <motion.div
            key={card.path}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.1 }}
          >
            <Link 
              to={card.path}
              className="group block bg-white p-8 rounded-[2rem] border border-slate-100 shadow-sm hover:shadow-xl hover:shadow-slate-200/50 transition-all duration-300 relative overflow-hidden"
            >
              <div className={`w-14 h-14 ${card.lightColor} rounded-2xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform duration-300`}>
                <card.icon className={`w-7 h-7 ${card.color.replace('bg-', 'text-')}`} />
              </div>
              
              <h3 className="text-xl font-bold text-slate-900 mb-2">{card.title}</h3>
              <p className="text-slate-500 leading-relaxed mb-6">{card.desc}</p>
              
              <div className="flex items-center text-sm font-bold text-indigo-600 gap-1 group-hover:gap-2 transition-all">
                Ouvrir la page
                <ChevronRight className="w-4 h-4" />
              </div>

              {/* Decorative background element */}
              <div className={`absolute -right-4 -bottom-4 w-24 h-24 ${card.lightColor} opacity-50 rounded-full blur-2xl group-hover:scale-150 transition-transform duration-500`} />
            </Link>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
