import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function TagCloud({ tags }: { tags: { tag: string; count: number }[] }) {
  if (tags.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Most common tags</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-1.5">
        {tags.map(({ tag, count }) => (
          <Badge key={tag} variant="secondary">
            {tag} · {count}
          </Badge>
        ))}
      </CardContent>
    </Card>
  );
}
