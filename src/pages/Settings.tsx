import { useState } from "react";
import { 
  Settings as SettingsIcon, 
  Save, 
  Shield, 
  Bell, 
  Database, 
  Cpu,
  ChevronRight
} from "lucide-react";
import { motion } from "motion/react";

export default function Settings() {
  const [weights, setWeights] = useState({
    competition: 40,
    trend: 30,
    volume: 30
  });

  const [thresholds, setThresholds] = useState({
    ctrGap: 2.5,
    drift: 3
  });

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Paramètres</h1>
          <p className="text-slate-500 mt-1">Personnalisez votre moteur décisionnel SEO.</p>
        </div>
        <button className="flex items-center gap-2 px-6 py-3 bg-indigo-600 text-white rounded-2xl font-bold shadow-lg shadow-indigo-100 hover:bg-indigo-700 transition-all active:scale-95">
          <Save className="w-5 h-5" />
          Sauvegarder
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        {/* Sidebar Navigation */}
        <div className="space-y-2">
          {[
            { name: "Moteur de scoring", icon: Cpu, active: true },
            { name: "Seuils d'alertes", icon: Bell },
            { name: "Sécurité & API", icon: Shield },
            { name: "Base de données", icon: Database },
          ].map((item) => (
            <button 
              key={item.name}
              className={`w-full flex items-center justify-between px-4 py-3 rounded-xl text-sm font-bold transition-all ${item.active ? 'bg-indigo-50 text-indigo-600' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'}`}
            >
              <div className="flex items-center gap-3">
                <item.icon className="w-4 h-4" />
                {item.name}
              </div>
              <ChevronRight className={`w-4 h-4 ${item.active ? 'opacity-100' : 'opacity-0'}`} />
            </button>
          ))}
        </div>

        {/* Main Settings Content */}
        <div className="md:col-span-2 space-y-8">
          {/* Scoring Weights */}
          <section className="bg-white p-8 rounded-[2.5rem] border border-slate-100 shadow-sm">
            <h3 className="text-xl font-bold text-slate-900 mb-6 flex items-center gap-2">
              <Cpu className="w-5 h-5 text-indigo-500" />
              Pondération du scoring
            </h3>
            <div className="space-y-8">
              {[
                { key: 'competition', label: 'Poids de la compétition', value: weights.competition },
                { key: 'trend', label: 'Poids de la tendance', value: weights.trend },
                { key: 'volume', label: 'Poids du volume', value: weights.volume },
              ].map((item) => (
                <div key={item.key} className="space-y-4">
                  <div className="flex justify-between items-center">
                    <label className="text-sm font-bold text-slate-700">{item.label}</label>
                    <span className="text-sm font-bold text-indigo-600 bg-indigo-50 px-2 py-1 rounded-lg">{item.value}%</span>
                  </div>
                  <input 
                    type="range" 
                    min="0" 
                    max="100" 
                    value={item.value}
                    onChange={(e) => setWeights({...weights, [item.key]: parseInt(e.target.value)})}
                    className="w-full h-2 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                  />
                </div>
              ))}
            </div>
            <div className="mt-8 p-4 bg-slate-50 rounded-2xl text-xs text-slate-500 leading-relaxed">
              La somme des pondérations doit idéalement être égale à 100% pour un scoring équilibré.
            </div>
          </section>

          {/* Alert Thresholds */}
          <section className="bg-white p-8 rounded-[2.5rem] border border-slate-100 shadow-sm">
            <h3 className="text-xl font-bold text-slate-900 mb-6 flex items-center gap-2">
              <Bell className="w-5 h-5 text-amber-500" />
              Seuils d'alertes
            </h3>
            <div className="grid grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-700 ml-1">Seuil CTR gap (%)</label>
                <input 
                  type="number" 
                  step="0.1"
                  value={thresholds.ctrGap}
                  onChange={(e) => setThresholds({...thresholds, ctrGap: parseFloat(e.target.value)})}
                  className="w-full px-5 py-3.5 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all font-bold"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-700 ml-1">Seuil Drift (pos)</label>
                <input 
                  type="number" 
                  value={thresholds.drift}
                  onChange={(e) => setThresholds({...thresholds, drift: parseInt(e.target.value)})}
                  className="w-full px-5 py-3.5 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all font-bold"
                />
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
