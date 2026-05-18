const apiCall = async (path: string, body: object) => {
  const token = localStorage.getItem("token");
  const res = await fetch(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return res.json();
};

export async function getDashboardInterpretation(stats: any, keywords: any[]) {
  try {
    const data = await apiCall("/api/ai/dashboard-interpretation", { stats, keywords });
    return data.text as string;
  } catch (error: any) {
    console.error("Interpretation error:", error);
    return error?.message || "Désolé, l'interprétation IA n'est pas disponible pour le moment.";
  }
}

export type AssistantMessage = { role: "user" | "assistant"; content: string };

export type StreamAssistantArgs = {
  messages: AssistantMessage[];
  useProjectContext?: boolean;
  projectId?: number | null;
  onDelta: (delta: string) => void;
  onDone?: () => void;
  onError?: (message: string) => void;
  signal?: AbortSignal;
};

// Streams the conversational SEO assistant via SSE. The backend writes
// "data: {\"delta\": \"...\"}\n\n" frames followed by "data: [DONE]\n\n".
// We accumulate bytes, split on the SSE record separator, parse each frame
// and forward deltas to the caller — keeping React state cheap.
export async function streamAssistant({
  messages,
  useProjectContext = false,
  projectId = null,
  onDelta,
  onDone,
  onError,
  signal,
}: StreamAssistantArgs) {
  const token = localStorage.getItem("token");
  try {
    const res = await fetch("/api/ai/assistant", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ messages, useProjectContext, projectId }),
      signal,
    });

    // Non-streaming error path (validation, auth, quota before stream start)
    if (!res.ok || !res.body) {
      const data = await res.json().catch(() => ({}));
      onError?.(data.error || `Erreur ${res.status}`);
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE frames are separated by a blank line — split, keep tail in buffer.
      const frames = buffer.split("\n\n");
      buffer = frames.pop() ?? "";

      for (const frame of frames) {
        const line = frame.trim();
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (payload === "[DONE]") {
          onDone?.();
          return;
        }
        try {
          const parsed = JSON.parse(payload);
          if (parsed.error) {
            onError?.(parsed.error);
            return;
          }
          if (typeof parsed.delta === "string") {
            onDelta(parsed.delta);
          }
        } catch {
          // Ignore malformed frames rather than aborting the whole stream
        }
      }
    }
    onDone?.();
  } catch (err: any) {
    if (err?.name === "AbortError") return;
    console.error("streamAssistant error:", err);
    onError?.(err?.message || "Erreur réseau lors de l'appel à l'assistant.");
  }
}

export async function qualifyKeywords(projectId: number, keywords: any[], date: string) {
  try {
    const token = localStorage.getItem("token");
    const response = await fetch("/api/nlp/qualify", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ projectId, keywords, date }),
    });
    if (!response.ok) throw new Error("Failed to qualify keywords");
    return await response.json();
  } catch (error) {
    console.error("NLP Qualification Error:", error);
    return null;
  }
}
