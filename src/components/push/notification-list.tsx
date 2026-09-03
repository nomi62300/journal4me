"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { BellDot, CheckCheck } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { markAllNotificationsRead, markNotificationRead } from "@/lib/push/actions";
import type { NotificationRow } from "@/lib/push/queries";
import { cn } from "@/lib/utils";

/** "3h ago" / "2d ago" — coarse on purpose, this is a glance list, not a log. */
function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(ms / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

export function NotificationList({ notifications }: { notifications: NotificationRow[] }) {
  const [items, setItems] = useState(notifications);
  const [pending, startTransition] = useTransition();
  const unreadCount = items.filter((n) => !n.read_at).length;

  function markRead(id: number) {
    setItems((prev) =>
      prev.map((n) => (n.id === id && !n.read_at ? { ...n, read_at: new Date().toISOString() } : n)),
    );
    startTransition(async () => {
      const result = await markNotificationRead(id);
      if (result.error) toast.error(result.error);
    });
  }

  function markAllRead() {
    const now = new Date().toISOString();
    setItems((prev) => prev.map((n) => (n.read_at ? n : { ...n, read_at: now })));
    startTransition(async () => {
      const result = await markAllNotificationsRead();
      if (result.error) toast.error(result.error);
    });
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <BellDot className="size-4" />
              Recent alerts
            </CardTitle>
            <CardDescription>
              {unreadCount > 0 ? `${unreadCount} unread` : "You're all caught up."}
            </CardDescription>
          </div>
          {unreadCount > 0 ? (
            <Button size="sm" variant="ghost" onClick={markAllRead} disabled={pending} className="gap-1.5">
              <CheckCheck className="size-4" />
              Mark all read
            </Button>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {items.length === 0 ? (
          <p className="text-muted-foreground px-6 py-8 text-center text-sm">
            Nothing yet — alerts for rule breaches, targets and payout gates will show up here.
          </p>
        ) : (
          <div className="divide-y">
            {items.map((n) => {
              const unread = !n.read_at;
              const content = (
                <>
                  <span
                    className={cn(
                      "mt-1.5 size-1.5 shrink-0 rounded-full",
                      unread ? "bg-primary" : "bg-transparent",
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <p className={cn("truncate", unread ? "font-medium" : "text-muted-foreground")}>
                      {n.title}
                    </p>
                    <p className="text-muted-foreground mt-0.5 line-clamp-2 text-xs">{n.body}</p>
                  </div>
                  <span className="text-muted-foreground shrink-0 text-xs whitespace-nowrap">
                    {relativeTime(n.created_at)}
                  </span>
                </>
              );
              const rowClass = "flex items-start gap-3 px-6 py-3 text-sm transition-colors";

              // Two different elements, not one div with a conditional
              // onClick — a Link already handles the click-to-mark-read via
              // its own onClick; adding the same handler to a child inside
              // it would fire twice (React bubbles synthetic events through
              // the component tree same as the DOM).
              return n.url ? (
                <Link
                  key={n.id}
                  href={n.url}
                  onClick={() => unread && markRead(n.id)}
                  className={cn(rowClass, "hover:bg-accent/50")}
                >
                  {content}
                </Link>
              ) : (
                <div
                  key={n.id}
                  className={cn(rowClass, unread && "hover:bg-accent/50 cursor-pointer")}
                  onClick={() => unread && markRead(n.id)}
                >
                  {content}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
