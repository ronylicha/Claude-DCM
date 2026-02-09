"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  FolderKanban,
  Clock,
  Users,
  Wrench,
  Route,
  MessageSquare,
  Radio,
  BrainCircuit,
  Layers,
  History,
  BookOpen,
  Gauge,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface NavGroup {
  label: string;
  items: { name: string; href: string; icon: React.ComponentType<{ className?: string }> }[];
}

const navigationGroups: NavGroup[] = [
  {
    label: "Overview",
    items: [
      { name: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
      { name: "Live Activity", href: "/live", icon: Radio },
      { name: "Waves", href: "/waves", icon: Layers },
    ],
  },
  {
    label: "Data",
    items: [
      { name: "Projects", href: "/projects", icon: FolderKanban },
      { name: "Sessions", href: "/sessions", icon: Clock },
      { name: "Agents", href: "/agents", icon: Users },
      { name: "Context", href: "/context", icon: BrainCircuit },
      { name: "Compact History", href: "/compact", icon: History },
    ],
  },
  {
    label: "System",
    items: [
      { name: "Tools", href: "/tools", icon: Wrench },
      { name: "Routing", href: "/routing", icon: Route },
      { name: "Messages", href: "/messages", icon: MessageSquare },
      { name: "Registry", href: "/registry", icon: BookOpen },
      { name: "Performance", href: "/performance", icon: Gauge },
    ],
  },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="fixed inset-y-0 left-0 z-50 w-64 border-r border-border bg-sidebar flex flex-col">
      {/* Logo */}
      <div className="flex h-16 items-center border-b border-border px-5">
        <div className="flex items-center gap-3">
          <div className="relative h-9 w-9 flex items-center justify-center">
            <svg width="36" height="36" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg" className="drop-shadow-[0_0_8px_rgba(79,70,229,0.3)]">
              <defs>
                <linearGradient id="sidebar-gp" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#4F46E5"/>
                  <stop offset="100%" stopColor="#7C3AED"/>
                </linearGradient>
                <linearGradient id="sidebar-ga" x1="0%" y1="100%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#06B6D4"/>
                  <stop offset="100%" stopColor="#14B8A6"/>
                </linearGradient>
              </defs>
              <rect width="36" height="36" rx="8" fill="url(#sidebar-gp)"/>
              <line x1="8" y1="8" x2="15" y2="15" stroke="white" strokeWidth="1" opacity="0.3"/>
              <line x1="28" y1="8" x2="21" y2="15" stroke="white" strokeWidth="1" opacity="0.3"/>
              <line x1="8" y1="28" x2="15" y2="21" stroke="white" strokeWidth="1" opacity="0.3"/>
              <line x1="28" y1="28" x2="21" y2="21" stroke="white" strokeWidth="1" opacity="0.3"/>
              <polygon points="18,12 23,15 23,21 18,24 13,21 13,15" fill="rgba(255,255,255,0.15)" stroke="white" strokeWidth="1.2"/>
              <circle cx="8" cy="8" r="2.5" fill="white" opacity="0.5"/>
              <circle cx="28" cy="8" r="2.5" fill="white" opacity="0.5"/>
              <circle cx="8" cy="28" r="2.5" fill="white" opacity="0.5"/>
              <circle cx="28" cy="28" r="2.5" fill="white" opacity="0.5"/>
            </svg>
          </div>
          <div>
            <span className="font-bold text-sm text-sidebar-foreground tracking-tight">
              DCM
            </span>
            <span className="block text-[10px] text-muted-foreground font-medium -mt-0.5">
              Context Manager
            </span>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-4 px-3">
        {navigationGroups.map((group) => (
          <div key={group.label} className="mb-6">
            <p className="px-3 mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">
              {group.label}
            </p>
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const isActive = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href));
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-200",
                      isActive
                        ? "bg-sidebar-accent text-sidebar-accent-foreground"
                        : "text-sidebar-foreground/60 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                    )}
                  >
                    {/* Active indicator */}
                    {isActive && (
                      <div className="absolute left-0 top-1/2 -translate-y-1/2 h-6 w-[3px] rounded-r-full bg-gradient-to-b from-indigo-500 to-violet-600" />
                    )}
                    <Icon className={cn(
                      "h-4 w-4 transition-colors",
                      isActive ? "text-indigo-500" : "text-muted-foreground group-hover:text-foreground"
                    )} />
                    {item.name}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Bottom section */}
      <div className="border-t border-border p-4">
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <div className="h-1.5 w-1.5 rounded-full bg-green-500 shadow-[0_0_6px_#22c55e] animate-pulse" />
          <span className="font-mono">WebSocket connected</span>
        </div>
        <div className="flex items-center gap-3 mt-2 text-[10px] text-muted-foreground/50 font-mono">
          <span>v3.0.0</span>
          <span className="ml-auto">API:3847</span>
        </div>
      </div>
    </aside>
  );
}
