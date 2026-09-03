import Link from "next/link";
import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";

import { StrategyForm } from "@/components/strategies/strategy-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = { title: "New strategy" };

export default function NewStrategyPage() {
  return (
    <div className="mx-auto max-w-2xl p-4 md:p-6">
      <Link
        href="/strategies"
        className="text-muted-foreground mb-4 inline-flex items-center gap-1 text-sm hover:underline"
      >
        <ArrowLeft className="size-3.5" />
        Strategies
      </Link>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">New strategy</CardTitle>
        </CardHeader>
        <CardContent>
          <StrategyForm />
        </CardContent>
      </Card>
    </div>
  );
}
