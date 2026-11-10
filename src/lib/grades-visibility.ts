import { useSyncExternalStore } from "react";

const SHOW_GRADES_KEY = "priority.classes.showGrades";

// Like the theme in the dashboard, the toggle reads storage through a store
// subscription with a server snapshot, so the first server paint always shows
// grades and the client corrects itself without a setState-in-effect.
const GRADES_VISIBILITY_EVENT = "priority-grades-visibility-change";

// The snapshot is cached so a blocked write cannot flip what the toggle already
// applied. Every mount re-reads the saved choice, and an external storage event
// (another tab, or settings elsewhere) invalidates the cache first.
let showGradesCache: boolean | null = null;

function subscribeToGradesVisibility(onChange: () => void): () => void {
  showGradesCache = null;
  const onExternalChange = () => {
    showGradesCache = null;
    onChange();
  };
  window.addEventListener(GRADES_VISIBILITY_EVENT, onChange);
  window.addEventListener("storage", onExternalChange);
  return () => {
    window.removeEventListener(GRADES_VISIBILITY_EVENT, onChange);
    window.removeEventListener("storage", onExternalChange);
  };
}

function readShowGrades(): boolean {
  if (showGradesCache === null) {
    try {
      showGradesCache = localStorage.getItem(SHOW_GRADES_KEY) !== "false";
    } catch {
      showGradesCache = true;
    }
  }
  return showGradesCache;
}

function writeStoredShowGrades(showGrades: boolean): void {
  showGradesCache = showGrades;
  try {
    localStorage.setItem(SHOW_GRADES_KEY, showGrades ? "true" : "false");
  } catch {
    return;
  }
}

// One shared hide-grades choice for the Classes grid and each class page, so a
// number hidden in one place stays hidden in the other.
export function useShowGrades(): [showGrades: boolean, toggle: () => void] {
  const showGrades = useSyncExternalStore(subscribeToGradesVisibility, readShowGrades, () => true);
  function toggle() {
    writeStoredShowGrades(!showGrades);
    window.dispatchEvent(new Event(GRADES_VISIBILITY_EVENT));
  }
  return [showGrades, toggle];
}
