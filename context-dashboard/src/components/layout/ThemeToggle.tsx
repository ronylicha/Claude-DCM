'use client';

import { useCallback, useSyncExternalStore } from 'react';
import { Sun, Moon } from 'lucide-react';

function getThemeSnapshot(): boolean {
  if (typeof window === 'undefined') return false;
  return document.documentElement.classList.contains('dark');
}

function getServerSnapshot(): boolean {
  return false;
}

function subscribeToTheme(callback: () => void): () => void {
  const observer = new MutationObserver(callback);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class'],
  });
  return () => observer.disconnect();
}

export function ThemeToggle() {
  const isDark = useSyncExternalStore(
    subscribeToTheme,
    getThemeSnapshot,
    getServerSnapshot,
  );

  const toggleTheme = useCallback(() => {
    const newIsDark = !document.documentElement.classList.contains('dark');
    document.documentElement.classList.toggle('dark', newIsDark);
    localStorage.setItem('dcm-theme', newIsDark ? 'dark' : 'light');
  }, []);

  return (
    <button
      onClick={toggleTheme}
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      className="
        relative flex items-center justify-center
        w-12 h-12 rounded-[var(--radius-md-full)]
        text-[var(--md-sys-color-on-surface-variant)]
        transition-all duration-200 md-motion-standard
        overflow-hidden
        focus-visible:outline-2 focus-visible:outline-[var(--md-sys-color-primary)]
        focus-visible:outline-offset-2
        group
      "
    >
      {/* M3 state layer */}
      <span
        aria-hidden="true"
        className="
          absolute inset-0 rounded-[var(--radius-md-full)]
          bg-[var(--md-sys-color-on-surface-variant)]
          opacity-0 group-hover:opacity-[0.08]
          transition-opacity duration-200
        "
      />
      {isDark ? (
        <Sun className="h-5 w-5 relative z-10" />
      ) : (
        <Moon className="h-5 w-5 relative z-10" />
      )}
    </button>
  );
}
