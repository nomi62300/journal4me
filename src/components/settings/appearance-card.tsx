import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ThemeToggle } from "@/components/layout/theme-toggle";

/**
 * The sidebar carries the same ThemeToggle for quick access, but the
 * sidebar is `hidden` below `md:` — this card is the only place a mobile
 * user (bottom-tab nav, no sidebar at all) can reach it.
 */
export function AppearanceCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Appearance</CardTitle>
        <CardDescription>Light or dark, or match your system.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between text-sm">
          <span>Theme</span>
          <ThemeToggle />
        </div>
      </CardContent>
    </Card>
  );
}
