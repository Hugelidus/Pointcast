import { Card, CardContent, CardTitle } from "@/components/ui/card";
import { formatValue, type Stat } from "@/lib/data";

/** Server Component shared by the three cards of the overview. */
export function StatCard({ stat }: { stat: Stat }) {
  return (
    <Card>
      <CardTitle>{stat.label}</CardTitle>
      <CardContent>
        <div className="stat-value">{formatValue(stat.value, stat.unit)}</div>
        <p className="muted">{stat.change}</p>
      </CardContent>
    </Card>
  );
}
