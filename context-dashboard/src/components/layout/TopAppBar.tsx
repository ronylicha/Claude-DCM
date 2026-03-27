'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Wifi, WifiOff } from 'lucide-react';
import { useWebSocket } from '@/hooks/useWebSocket';
import { cn } from '@/lib/utils';

function getPageTitle(pathname: string): string {
  const segment = pathname.split('/').filter(Boolean)[0] ?? '';
  if (!segment) return 'Dashboard';

  const titles: Record<string, string> = {
    cockpit: 'Cockpit',
    live: 'Live Activity',
    waves: 'Waves',
    flows: 'Flows',
    projects: 'Projects',
    sessions: 'Sessions',
    agents: 'Agents',
    context: 'Context',
    compact: 'Compact History',
    tools: 'Tools',
    routing: 'Routing',
    messages: 'Messages',
    registry: 'Registry',
    performance: 'Performance',
    dashboard: 'Dashboard',
  };

  return (
    titles[segment] ??
    segment.charAt(0).toUpperCase() + segment.slice(1).replace(/-/g, ' ')
  );
}

export function TopAppBar() {
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);
  const mainRef = useRef<Element | null>(null);

  const { connected, connecting } = useWebSocket({
    channels: ['metrics'],
    autoConnect: true,
  });

  // Detect scroll on the main content area (sibling element)
  useEffect(() => {
    // Find the main element — it's a sibling in the layout
    const main = document.querySelector('main');
    if (!main) return;
    mainRef.current = main;

    const handleScroll = () => {
      setScrolled(main.scrollTop > 8);
    };

    main.addEventListener('scroll', handleScroll, { passive: true });
    return () => main.removeEventListener('scroll', handleScroll);
  }, []);

  const title = getPageTitle(pathname);

  const wsStatus: 'connected' | 'connecting' | 'disconnected' = connected
    ? 'connected'
    : connecting
      ? 'connecting'
      : 'disconnected';

  return (
    <header
      className={cn(
        'sticky top-0 z-40 flex items-center justify-between',
        'h-16 px-6',
        'bg-[var(--md-sys-color-surface)]',
        'border-b border-[var(--md-sys-color-outline-variant)]',
        'transition-shadow duration-200 md-motion-standard',
        scrolled && 'md-elevation-2',
      )}
    >
      {/* Page title */}
      <h1
        className="
          text-[22px] font-normal leading-tight
          text-[var(--md-sys-color-on-surface)]
          truncate
        "
      >
        {title}
      </h1>

      {/* Right controls */}
      <div className="flex items-center gap-3">
        {/* WebSocket status indicator */}
        <div
          className="flex items-center gap-1.5"
          title={
            wsStatus === 'connected'
              ? 'WebSocket connected'
              : wsStatus === 'connecting'
                ? 'Connecting…'
                : 'WebSocket disconnected'
          }
          aria-label={`WebSocket status: ${wsStatus}`}
        >
          <span
            className={cn(
              'relative flex h-2 w-2 rounded-full',
              wsStatus === 'connected' && 'bg-[var(--dcm-zone-green)]',
              wsStatus === 'connecting' && 'bg-[var(--dcm-zone-yellow)] animate-pulse',
              wsStatus === 'disconnected' && 'bg-[var(--dcm-zone-red)]',
            )}
          >
            {wsStatus === 'connected' && (
              <span
                aria-hidden="true"
                className="
                  absolute inline-flex h-full w-full rounded-full
                  bg-[var(--dcm-zone-green)] opacity-75 animate-ping
                "
              />
            )}
          </span>
          <span className="hidden sm:inline text-[11px] font-medium text-[var(--md-sys-color-on-surface-variant)]">
            {wsStatus === 'connected' ? (
              <Wifi className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <WifiOff className="h-3.5 w-3.5" aria-hidden="true" />
            )}
          </span>
        </div>
      </div>
    </header>
  );
}
