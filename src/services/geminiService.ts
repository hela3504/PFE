import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

export async function getDashboardInterpretation(stats: any, keywords: any[]) {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Analyze the following SEO data and provide a concise, professional interpretation (in French). 
      Stats: ${JSON.stringify(stats)}
      Top Keywords: ${JSON.stringify(keywords.slice(0, 5))}
      
      Focus on:
      1. Overall performance trend.
      2. Specific areas of concern (e.g., high competition, low CTR).
      3. One actionable recommendation.
      
      Format the response as a short paragraph followed by 3 bullet points.`,
      config: {
        systemInstruction: "Tu es un expert en SEO et Business Intelligence. Tu fournis des analyses précises et exploitables.",
      },
    });
    return response.text;
  } catch (error) {
    console.error("Gemini Error:", error);
    return "Désolé, l'interprétation IA n'est pas disponible pour le moment.";
  }
}

export async function getSeasonalSuggestions(domain: string = "Général", location: string = "France") {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Quels sont les prochains événements saisonniers majeurs (ex: Soldes, Black Friday, Vacances d'été, fêtes religieuses ou nationales) à venir dans les 3 prochains mois pour le domaine "${domain}" en "${location}" ? 
      Fournis une liste de 3 suggestions stratégiques avec une recommandation SEO spécifique pour chacune. 
      Prends en compte les spécificités culturelles et commerciales de la localisation demandée.`,
      config: {
        tools: [{ googleSearch: {} }],
        systemInstruction: "Tu es un planificateur stratégique SEO expert. Tu identifies les opportunités saisonnières basées sur l'actualité, les tendances de recherche et le contexte local.",
      },
    });
    return response.text;
  } catch (error) {
    console.error("Gemini Error:", error);
    return "Désolé, les suggestions IA ne sont pas disponibles pour le moment.";
  }
}

export async function qualifyKeywords(projectId: number, keywords: any[], date: string) {
  try {
    const token = localStorage.getItem("token");
    const response = await fetch("/api/nlp/qualify", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify({ projectId, keywords, date })
    });
    
    if (!response.ok) throw new Error("Failed to qualify keywords");
    return await response.json();
  } catch (error) {
    console.error("NLP Qualification Error:", error);
    return null;
  }
}
