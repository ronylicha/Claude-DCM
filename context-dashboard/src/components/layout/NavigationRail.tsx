'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  GitBranch,
  FolderOpen,
  Clock,
  Bot,
  Brain,
  Archive,
  Wrench,
  Route,
  MessageSquare,
  Database,
  Gauge,
  BarChart3,
  Settings,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { ThemeToggle } from './ThemeToggle';

interface NavItem {
  name: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const navigationGroups: NavGroup[] = [
  {
    label: 'Overview',
    items: [
      { name: 'Cockpit', href: '/cockpit', icon: LayoutDashboard },
      { name: 'Pipeline', href: '/pipeline', icon: GitBranch },
    ],
  },
  {
    label: 'Data',
    items: [
      { name: 'Projects', href: '/projects', icon: FolderOpen },
      { name: 'Sessions', href: '/sessions', icon: Clock },
      { name: 'Agents', href: '/agents', icon: Bot },
      { name: 'Context', href: '/context', icon: Brain },
      { name: 'Compact', href: '/compact', icon: Archive },
    ],
  },
  {
    label: 'System',
    items: [
      { name: 'Tools', href: '/tools', icon: Wrench },
      { name: 'Routing', href: '/routing', icon: Route },
      { name: 'Messages', href: '/messages', icon: MessageSquare },
      { name: 'Registry', href: '/registry', icon: Database },
      { name: 'Perf', href: '/performance', icon: Gauge },
      { name: 'Stats', href: '/stats', icon: BarChart3 },
      { name: 'Settings', href: '/settings', icon: Settings },
    ],
  },
];

export function NavigationRail() {
  const pathname = usePathname();

  return (
    <aside
      className="
        fixed inset-y-0 left-0 z-50
        w-[72px] flex flex-col
        bg-[var(--md-sys-color-surface)]
        border-r border-[var(--md-sys-color-outline-variant)]
      "
    >
      {/* Logo area — 64px to align with TopAppBar */}
      <div className="flex h-16 items-center justify-center shrink-0">
        <div
          className="flex items-center justify-center w-12 h-12"
          title="DCM — Distributed Context Manager"
        >
          <svg
            width="36"
            height="36"
            viewBox="0 0 36 36"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
          >
            <defs>
              <linearGradient id="rail-gp" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="var(--md-sys-color-primary)" />
                <stop offset="100%" stopColor="var(--md-sys-color-tertiary)" />
              </linearGradient>
            </defs>
            <rect
              width="36"
              height="36"
              rx="8"
              fill="url(#rail-gp)"
              opacity="0.9"
            />
            <line x1="8"  y1="8"  x2="15" y2="15" stroke="white" strokeWidth="1" opacity="0.3" />
            <line x1="28" y1="8"  x2="21" y2="15" stroke="white" strokeWidth="1" opacity="0.3" />
            <line x1="8"  y1="28" x2="15" y2="21" stroke="white" strokeWidth="1" opacity="0.3" />
            <line x1="28" y1="28" x2="21" y2="21" stroke="white" strokeWidth="1" opacity="0.3" />
            <polygon
              points="18,12 23,15 23,21 18,24 13,21 13,15"
              fill="rgba(255,255,255,0.15)"
              stroke="white"
              strokeWidth="1.2"
            />
            <circle cx="8"  cy="8"  r="2.5" fill="white" opacity="0.5" />
            <circle cx="28" cy="8"  r="2.5" fill="white" opacity="0.5" />
            <circle cx="8"  cy="28" r="2.5" fill="white" opacity="0.5" />
            <circle cx="28" cy="28" r="2.5" fill="white" opacity="0.5" />
          </svg>
        </div>
      </div>

      {/* M3 Divider after logo */}
      <div className="h-px mx-2 bg-[var(--md-sys-color-outline-variant)]" />

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto overflow-x-hidden py-2" aria-label="Main navigation">
        {navigationGroups.map((group, groupIndex) => (
          <div key={group.label}>
            {/* M3 Divider between groups (not before first) */}
            {groupIndex > 0 && (
              <div className="h-px mx-2 my-1 bg-[var(--md-sys-color-outline-variant)]" />
            )}

            {/* Group items */}
            <div className="py-1">
              {group.items.map((item) => {
                const isActive =
                  pathname === item.href ||
                  (item.href !== '/' && pathname.startsWith(item.href));
                const Icon = item.icon;

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-label={item.name}
                    aria-current={isActive ? 'page' : undefined}
                    className={cn(
                      'group relative flex flex-col items-center justify-center',
                      'w-full min-h-[48px] py-1 gap-0.5',
                      'transition-all duration-200 md-motion-standard',
                      'focus-visible:outline-2 focus-visible:outline-[var(--md-sys-color-primary)]',
                      'focus-visible:outline-offset-[-2px]',
                    )}
                  >
                    {/* Active/hover container */}
                    <div
                      className={cn(
                        'relative flex items-center justify-center',
                        'w-14 h-8 rounded-[var(--radius-md-full)]',
                        'transition-all duration-200 md-motion-standard',
                        isActive
                          ? 'bg-[var(--md-sys-color-primary-container)]'
                          : 'bg-transparent',
                      )}
                    >
                      {/* M3 state layer for hover */}
                      {!isActive && (
                        <span
                          aria-hidden="true"
                          className="
                            absolute inset-0 rounded-[var(--radius-md-full)]
                            bg-[var(--md-sys-color-on-surface-variant)]
                            opacity-0 group-hover:opacity-[0.08]
                            transition-opacity duration-200
                          "
                        />
                      )}

                      <Icon
                        className={cn(
                          'h-6 w-6 transition-colors duration-200',
                          isActive
                            ? 'text-[var(--md-sys-color-on-primary-container)]'
                            : 'text-[var(--md-sys-color-on-surface-variant)]',
                        )}
                        aria-hidden="true"
                      />
                    </div>

                    {/* Label */}
                    <span
                      className={cn(
                        'text-[11px] font-medium text-center leading-tight',
                        'transition-colors duration-200',
                        'max-w-[64px] truncate px-1',
                        isActive
                          ? 'text-[var(--md-sys-color-on-surface)]'
                          : 'text-[var(--md-sys-color-on-surface-variant)]',
                      )}
                    >
                      {item.name}
                    </span>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Bottom: ThemeToggle */}
      <div className="shrink-0 flex flex-col items-center pb-3 pt-1">
        <div className="h-px w-full mx-2 bg-[var(--md-sys-color-outline-variant)] mb-1" />
        <ThemeToggle />
      </div>
    </aside>
  );
}
