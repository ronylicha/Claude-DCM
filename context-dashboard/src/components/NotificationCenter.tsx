"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import {
  Bell,
  XCircle,
  Archive,
  CheckCircle,
  AlertTriangle,
  Layers,
  AlertOctagon,
  Package,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useRealtimeEvents, type WSEvent, type EventType } from "@/hooks/useWebSocket";
import { cn } from "@/lib/utils";

// ============================================
// Types
// ============================================

interface Notification extends WSEvent {
  id: string;
  read: boolean;
}

type NotificationEventType =
  | "subtask.failed"
  | "proactive.compact"
  | "subtask.completed"
  | "capacity.warning"
  | "wave.transitioned"
  | "conflict.detected"
  | "batch.completed";

// ============================================
// Event Configuration
// ============================================

const EVENT_CONFIG: Record<
  NotificationEventType,
  {
    icon: typeof XCircle;
    color: string;
    bgColor: string;
    label: string;
  }
> = {
  "subtask.failed": {
    icon: XCircle,
    color: "text-red-400",
    bgColor: "bg-red-500/10",
    label: "Task Failed",
  },
  "proactive.compact": {
    icon: Archive,
    color: "text-amber-400",
    bgColor: "bg-amber-500/10",
    label: "Compact Triggered",
  },
  "subtask.completed": {
    icon: CheckCircle,
    color: "text-green-400",
    bgColor: "bg-green-500/10",
    label: "Task Completed",
  },
  "capacity.warning": {
    icon: AlertTriangle,
    color: "text-orange-400",
    bgColor: "bg-orange-500/10",
    label: "Capacity Warning",
  },
  "wave.transitioned": {
    icon: Layers,
    color: "text-violet-400",
    bgColor: "bg-violet-500/10",
    label: "Wave Transition",
  },
  "conflict.detected": {
    icon: AlertOctagon,
    color: "text-red-400",
    bgColor: "bg-red-500/10",
    label: "Conflict Detected",
  },
  "batch.completed": {
    icon: Package,
    color: "text-blue-400",
    bgColor: "bg-blue-500/10",
    label: "Batch Completed",
  },
};

// Notification event types to listen for
const NOTIFICATION_EVENT_TYPES: EventType[] = [
  "subtask.failed",
  "proactive.compact",
  "subtask.completed",
  "capacity.warning",
  "wave.transitioned",
  "conflict.detected",
  "batch.completed",
];

// ============================================
// Utility Functions
// ============================================

function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString();
}

function getNotificationMessage(event: WSEvent): string {
  const data = event.data as Record<string, unknown> | null;

  switch (event.event) {
    case "subtask.failed":
      return data?.task_name
        ? `Task "${data.task_name}" failed`
        : "A subtask has failed";
    case "proactive.compact":
      return data?.reason
        ? `Compact triggered: ${data.reason}`
        : "Context compact triggered";
    case "subtask.completed":
      return data?.task_name
        ? `Task "${data.task_name}" completed`
        : "A subtask has completed";
    case "capacity.warning":
      return data?.message
        ? String(data.message)
        : "System capacity warning";
    case "wave.transitioned":
      return data?.from_wave !== undefined && data?.to_wave !== undefined
        ? `Wave transitioned from ${data.from_wave} to ${data.to_wave}`
        : "Wave transition occurred";
    case "conflict.detected":
      return data?.message
        ? String(data.message)
        : "Resource conflict detected";
    case "batch.completed":
      return data?.batch_name
        ? `Batch "${data.batch_name}" completed`
        : "A batch has completed";
    default:
      return "New system event";
  }
}

// ============================================
// NotificationItem Component
// ============================================

interface NotificationItemProps {
  notification: Notification;
  onMarkRead: (id: string) => void;
  onRemove: (id: string) => void;
}

export function NotificationItem({
  notification,
  onMarkRead,
  onRemove,
}: NotificationItemProps) {
  const config = EVENT_CONFIG[notification.event as NotificationEventType];

  // Fallback for unknown event types
  if (!config) {
    return null;
  }

  const Icon = config.icon;
  const message = getNotificationMessage(notification);
  const relativeTime = formatRelativeTime(notification.timestamp);

  return (
    <div
      className={cn(
        "group relative flex items-start gap-3 border-b border-zinc-800 p-3 transition-colors hover:bg-zinc-800/50",
        !notification.read && "bg-zinc-800/30"
      )}
    >
      {/* Icon */}
      <div className={cn("rounded-lg p-2", config.bgColor)}>
        <Icon className={cn("h-4 w-4", config.color)} />
      </div>

      {/* Content */}
      <div className="flex-1 space-y-1">
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-medium text-zinc-100">{config.label}</p>
          <button
            onClick={() => onRemove(notification.id)}
            className="opacity-0 transition-opacity group-hover:opacity-100"
            aria-label="Remove notification"
          >
            <X className="h-3.5 w-3.5 text-zinc-500 hover:text-zinc-300" />
          </button>
        </div>
        <p className="text-xs text-zinc-400">{message}</p>
        <div className="flex items-center gap-2">
          <span className="text-xs text-zinc-500">{relativeTime}</span>
          {!notification.read && (
            <button
              onClick={() => onMarkRead(notification.id)}
              className="text-xs text-blue-400 hover:text-blue-300 hover:underline"
            >
              Mark as read
            </button>
          )}
        </div>
      </div>

      {/* Unread indicator */}
      {!notification.read && (
        <div className="absolute left-1 top-1/2 h-2 w-2 -translate-y-1/2 rounded-full bg-blue-500" />
      )}
    </div>
  );
}

// ============================================
// NotificationCenter Component
// ============================================

export function NotificationCenter() {
  const [isOpen, setIsOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // WebSocket events
  const { events } = useRealtimeEvents({
    channels: ["global"],
    eventTypes: NOTIFICATION_EVENT_TYPES,
    maxEvents: 50,
  });

  // Convert WSEvents to Notifications
  useEffect(() => {
    if (events.length > 0) {
      const newNotifications = events.map((event) => ({
        ...event,
        id: `notif_${event.timestamp}_${Math.random().toString(36).substring(2, 9)}`,
        read: false,
      }));
      setNotifications(newNotifications.slice(0, 50));
    }
  }, [events]);

  // Count unread notifications
  const unreadCount = useMemo(
    () => notifications.filter((n) => !n.read).length,
    [notifications]
  );

  // Mark notification as read
  const markAsRead = useCallback((id: string) => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read: true } : n))
    );
  }, []);

  // Mark all as read
  const markAllAsRead = useCallback(() => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  }, []);

  // Remove notification
  const removeNotification = useCallback((id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  }, []);

  // Click outside to close
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => {
        document.removeEventListener("mousedown", handleClickOutside);
      };
    }
  }, [isOpen]);

  // Escape key to close
  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape" && isOpen) {
        setIsOpen(false);
      }
    }

    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isOpen]);

  return (
    <div className="relative">
      {/* Bell Button */}
      <Button
        ref={buttonRef}
        variant="ghost"
        size="icon"
        onClick={() => setIsOpen(!isOpen)}
        className="relative h-8 w-8 rounded-lg"
        aria-label="Notifications"
        aria-expanded={isOpen}
      >
        <Bell className="h-4 w-4" />
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </Button>

      {/* Dropdown Panel */}
      {isOpen && (
        <div
          ref={dropdownRef}
          className="absolute right-0 top-full z-50 mt-2 w-80 animate-in fade-in slide-in-from-top-2 rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl duration-200"
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-zinc-800 p-3">
            <h3 className="text-sm font-semibold text-zinc-100">
              Notifications
            </h3>
            {unreadCount > 0 && (
              <button
                onClick={markAllAsRead}
                className="text-xs text-blue-400 hover:text-blue-300 hover:underline"
              >
                Mark all read
              </button>
            )}
          </div>

          {/* Notification List */}
          <div className="max-h-80 overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 py-12">
                <Bell className="h-8 w-8 text-zinc-700" />
                <p className="text-sm text-zinc-500">No notifications</p>
              </div>
            ) : (
              notifications.map((notification) => (
                <NotificationItem
                  key={notification.id}
                  notification={notification}
                  onMarkRead={markAsRead}
                  onRemove={removeNotification}
                />
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
