import { useEffect, useState } from "react";

// localStorage-backed selected project id, shared across pages.
// Reads on mount, persists on change, and syncs in-tab via a custom event
// (the native 'storage' event only fires across tabs).
const KEY = "selectedProjectId";
const EVT = "selected-project-changed";

export function useSelectedProject(): [string, (next: string) => void] {
  const [value, setValueState] = useState<string>(() => localStorage.getItem(KEY) ?? "");

  useEffect(() => {
    const sync = () => setValueState(localStorage.getItem(KEY) ?? "");
    window.addEventListener("storage", sync);     // cross-tab
    window.addEventListener(EVT, sync);            // same-tab
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener(EVT, sync);
    };
  }, []);

  const setValue = (next: string) => {
    if (next) localStorage.setItem(KEY, next);
    else localStorage.removeItem(KEY);
    setValueState(next);
    window.dispatchEvent(new Event(EVT));
  };

  return [value, setValue];
}
