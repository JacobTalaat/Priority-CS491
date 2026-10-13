"use client";

import Link from "next/link";
import { useMemo, useState, useSyncExternalStore } from "react";

type Priority = {
  id: number;
  title: string;
  project: string;
  time: string;
  level: "High" | "Medium" | "Low";
  completed: boolean;
};

const initialPriorities: Priority[] = [
  {
    id: 1,
    title: "Finalize research questions",
    project: "Senior capstone",
    time: "9:30 AM",
    level: "High",
    completed: false,
  },
  {
    id: 2,
    title: "Review week 6 lecture notes",
    project: "Human-computer interaction",
    time: "11:00 AM",
    level: "Medium",
    completed: false,
  },
  {
    id: 3,
    title: "Send draft to project team",
    project: "Senior capstone",
    time: "1:30 PM",
    level: "High",
    completed: false,
  },
  {
    id: 4,
    title: "Read chapter 4",
    project: "Ethics in technology",
    time: "3:00 PM",
    level: "Low",
    completed: false,
  },
];

type Filter = "All" | "High priority" | "Completed";

function subscribeToTheme(onChange: () => void) {
  window.addEventListener("priority-theme-change", onChange);
  return () => window.removeEventListener("priority-theme-change", onChange);
}

function getThemeSnapshot(): "dark" | "light" {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

function getServerThemeSnapshot(): "dark" {
  return "dark";
}

function SunIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="none">
      <circle cx="10" cy="10" r="3.5" />
      <path d="M10 1.75v2M10 16.25v2M18.25 10h-2M3.75 10h-2m14.08-5.83-1.41 1.41M5.58 14.42l-1.41 1.41m11.66 0-1.41-1.41M5.58 5.58 4.17 4.17" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="none">
      <path d="M16.45 12.3A7 7 0 0 1 7.7 3.55a7 7 0 1 0 8.75 8.75Z" />
    </svg>
  );
}

export default function PriorityDashboard() {
  const theme = useSyncExternalStore(
    subscribeToTheme,
    getThemeSnapshot,
    getServerThemeSnapshot,
  );
  const [filter, setFilter] = useState<Filter>("All");
  const [priorities, setPriorities] = useState(initialPriorities);

  const completedCount = priorities.filter((priority) => priority.completed).length;
  const visiblePriorities = useMemo(() => {
    if (filter === "Completed") {
      return priorities.filter((priority) => priority.completed);
    }
    if (filter === "High priority") {
      return priorities.filter((priority) => !priority.completed && priority.level === "High");
    }
    return priorities.filter((priority) => !priority.completed);
  }, [filter, priorities]);

  function togglePriority(id: number) {
    setPriorities((current) =>
      current.map((priority) =>
        priority.id === id ? { ...priority, completed: !priority.completed } : priority,
      ),
    );
  }

  function toggleTheme() {
    const nextTheme = theme === "dark" ? "light" : "dark";
    window.localStorage.setItem("priority-theme", nextTheme);
    document.documentElement.dataset.theme = nextTheme;
    window.dispatchEvent(new Event("priority-theme-change"));
  }

  const today = new Intl.DateTimeFormat("en", {
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(new Date());

  return (
    <main className="page-shell">
      <header className="topbar">
        <Link className="wordmark" href="/" aria-label="Priority home">
          <span className="wordmark-mark" aria-hidden="true">P.</span>
          <span>PRIORITY</span>
        </Link>
        <nav className="topbar-nav" aria-label="Main navigation">
          <a className="nav-link nav-link-active" href="#today">My priorities</a>
          <a className="nav-link" href="#priorities">Your plan</a>
        </nav>
        <button
          className="theme-toggle"
          type="button"
          onClick={toggleTheme}
          aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
          title={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
        >
          {theme === "dark" ? <SunIcon /> : <MoonIcon />}
          <span>{theme === "dark" ? "Light mode" : "Dark mode"}</span>
        </button>
      </header>

      <section className="intro-grid" id="today">
        <div className="intro-copy">
          <p className="eyebrow">Your day, with intention</p>
          <h1>MAKE ROOM<br />FOR WHAT MATTERS.</h1>
          <p className="intro-description">
            A little clarity goes a long way. Here&apos;s what deserves your attention today.
          </p>
        </div>
        <div className="date-block">
          <span className="eyebrow">Today</span>
          <span className="date-value">{today}</span>
          <span className="date-note">One step at a time.</span>
        </div>
      </section>

      <section className="overview-grid" aria-label="Daily progress">
        <div className="overview-cell">
          <span className="eyebrow">On your list</span>
          <span className="overview-value">{priorities.length.toString().padStart(2, "0")}</span>
          <span className="overview-note">priorities for today</span>
        </div>
        <div className="overview-cell">
          <span className="eyebrow">Completed</span>
          <span className="overview-value">{completedCount.toString().padStart(2, "0")}</span>
          <span className="overview-note">and counting</span>
        </div>
        <div className="overview-cell overview-message">
          <span className="eyebrow">A gentle reminder</span>
          <p>You don&apos;t have to do it all. Just the next right thing.</p>
        </div>
      </section>

      <section className="work-grid" id="priorities">
        <div className="priority-section">
          <div className="section-heading">
            <div>
              <p className="eyebrow">A clear path forward</p>
              <h2>YOUR PRIORITIES</h2>
            </div>
            <span className="section-count">{visiblePriorities.length} ITEMS</span>
          </div>

          <div className="filter-bar" role="tablist" aria-label="Filter priorities">
            {(["All", "High priority", "Completed"] as const).map((item) => (
              <button
                className={`filter-button${filter === item ? " filter-active" : ""}`}
                key={item}
                type="button"
                role="tab"
                aria-selected={filter === item}
                onClick={() => setFilter(item)}
              >
                {item}
                {item === "Completed" && completedCount > 0 && (
                  <span className="filter-count">{completedCount}</span>
                )}
              </button>
            ))}
          </div>

          {visiblePriorities.length > 0 ? (
            <ul className="priority-list">
              {visiblePriorities.map((priority, index) => (
                <li className="priority-row" key={priority.id}>
                  <span className="row-index">{String(index + 1).padStart(2, "0")}</span>
                  <button
                    className={`complete-button${priority.completed ? " is-complete" : ""}`}
                    type="button"
                    aria-label={`${priority.completed ? "Mark incomplete" : "Complete"}: ${priority.title}`}
                    onClick={() => togglePriority(priority.id)}
                  >
                    {priority.completed && (
                      <svg aria-hidden="true" viewBox="0 0 16 16" fill="none">
                        <path d="m3.5 8 3 3 6-6" />
                      </svg>
                    )}
                  </button>
                  <div className="priority-copy">
                    <span className={`priority-title${priority.completed ? " title-complete" : ""}`}>
                      {priority.title}
                    </span>
                    <span className="priority-project">{priority.project}</span>
                  </div>
                  <span className="priority-time">{priority.time}</span>
                  <span className={`priority-level level-${priority.level.toLowerCase()}`}>
                    {priority.level}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="empty-state">
              {filter === "Completed"
                ? "Nothing completed just yet. Take your first small step."
                : "You’re all caught up. Take a moment for yourself."}
            </p>
          )}
        </div>

        <aside className="focus-panel">
          <p className="eyebrow">Start where you are</p>
          <h2>ONE THING<br />AT A TIME.</h2>
          <p className="focus-description">
            Progress isn&apos;t about doing everything. It&apos;s about giving your attention to what matters most, then moving on with care.
          </p>
          <div className="focus-rule" />
          <div className="focus-stat">
            <span className="eyebrow">Today&apos;s momentum</span>
            <span className="focus-progress">
              {completedCount} <span>/ {priorities.length} complete</span>
            </span>
            <div
              className="progress-track"
              role="progressbar"
              aria-label="Today's completed priorities"
              aria-valuenow={completedCount}
              aria-valuemin={0}
              aria-valuemax={priorities.length}
            >
              <span
                className="progress-fill"
                style={{ width: `${priorities.length ? (completedCount / priorities.length) * 100 : 0}%` }}
              />
            </div>
          </div>
          <span className="focus-footnote">STEADY IS A KIND OF FAST.</span>
        </aside>
      </section>

      <footer className="page-footer">
        <span>MAKE TODAY COUNT, IN YOUR OWN WAY.</span>
        <a href="/api/health">API STATUS <span aria-hidden="true">↗</span></a>
      </footer>
    </main>
  );
}
