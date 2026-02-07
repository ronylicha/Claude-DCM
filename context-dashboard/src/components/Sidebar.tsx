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
  Zap,
  BrainCircuit,
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
    ],
  },
  {
    label: "Data",
    items: [
      { name: "Projects", href: "/projects", icon: FolderKanban },
      { name: "Sessions", href: "/sessions", icon: Clock },
      { name: "Agents", href: "/agents", icon: Users },
      { name: "Context", href: "/context", icon: BrainCircuit },
    ],
  },
  {
    label: "System",
    items: [
      { name: "Tools", href: "/tools", icon: Wrench },
      { name: "Routing", href: "/routing", icon: Route },
      { name: "Messages", href: "/messages", icon: MessageSquare },
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
          <div className="relative h-9 w-9 rounded-xl bg-gradient-to-br from-blue-500 to-violet-600 flex items-center justify-center shadow-lg shadow-blue-500/20">
            <Zap className="h-5 w-5 text-white" />
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
                      <div className="absolute left-0 top-1/2 -translate-y-1/2 h-6 w-[3px] rounded-r-full bg-gradient-to-b from-blue-500 to-violet-600" />
                    )}
                    <Icon className={cn(
                      "h-4 w-4 transition-colors",
                      isActive ? "text-blue-500" : "text-muted-foreground group-hover:text-foreground"
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
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <div className="h-2 w-2 rounded-full dot-healthy animate-pulse" />
          <span>API Connected</span>
          <span className="ml-auto opacity-50">v2.0.0</span>
        </div>
      </div>
    </aside>
  );
}
