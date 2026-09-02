"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { ImagePlus, Trash2, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  deleteTradeScreenshot,
  uploadTradeScreenshot,
} from "@/lib/trades/actions";
import { SCREENSHOT_KINDS, type ScreenshotKind, type TradeScreenshot } from "@/lib/trades/types";

type ScreenshotWithUrl = TradeScreenshot & { url: string | null };

export function TradeScreenshots({
  tradeId,
  screenshots,
}: {
  tradeId: number;
  screenshots: ScreenshotWithUrl[];
}) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<ScreenshotKind>("context");
  const [pending, startTransition] = useTransition();
  const [preview, setPreview] = useState<ScreenshotWithUrl | null>(null);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const fd = new FormData();
    fd.set("file", file);

    startTransition(async () => {
      const result = await uploadTradeScreenshot(tradeId, kind, fd);
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success("Screenshot added.");
        router.refresh();
      }
      if (fileInputRef.current) fileInputRef.current.value = "";
    });
  }

  function handleDelete(screenshot: ScreenshotWithUrl) {
    startTransition(async () => {
      try {
        await deleteTradeScreenshot(screenshot.id, screenshot.storage_path);
        toast.success("Screenshot removed.");
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Couldn't remove that screenshot.");
      }
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={kind} onValueChange={(v) => setKind(v as ScreenshotKind)} disabled={pending}>
          <SelectTrigger className="w-[120px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SCREENSHOT_KINDS.map((k) => (
              <SelectItem key={k.value} value={k.value}>
                {k.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={() => fileInputRef.current?.click()}
          className="gap-1.5"
        >
          <ImagePlus className="size-4" />
          {pending ? "Uploading…" : "Add screenshot"}
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/avif"
          className="hidden"
          onChange={handleFileChange}
        />
      </div>

      {screenshots.length > 0 ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {screenshots.map((s) => (
            <div key={s.id} className="group relative aspect-video overflow-hidden rounded-md border">
              {s.url ? (
                <button
                  type="button"
                  className="block h-full w-full"
                  onClick={() => setPreview(s)}
                >
                  <Image
                    src={s.url}
                    alt={s.caption ?? `${s.kind} screenshot`}
                    fill
                    className="object-cover"
                    unoptimized
                  />
                </button>
              ) : (
                <div className="bg-muted text-muted-foreground flex h-full items-center justify-center text-xs">
                  Unavailable
                </div>
              )}
              <button
                type="button"
                onClick={() => handleDelete(s)}
                disabled={pending}
                className="bg-background/80 absolute top-1 right-1 rounded-md p-1 opacity-0 transition-opacity group-hover:opacity-100"
                aria-label="Remove screenshot"
              >
                <Trash2 className="size-3.5 text-destructive" />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-muted-foreground text-xs">No screenshots yet.</p>
      )}

      {preview?.url ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setPreview(null)}
        >
          <button
            type="button"
            className="absolute top-4 right-4 text-white"
            onClick={() => setPreview(null)}
            aria-label="Close"
          >
            <X className="size-6" />
          </button>
          <Image
            src={preview.url}
            alt={preview.caption ?? `${preview.kind} screenshot`}
            width={1200}
            height={800}
            className="max-h-full max-w-full object-contain"
            unoptimized
          />
        </div>
      ) : null}
    </div>
  );
}
