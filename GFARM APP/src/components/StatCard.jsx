import { Card } from '@/components/ui/card';

export default function StatCard({ icon: Icon, title, value, subtitle, colorClass }) {
  return (
    <Card className="p-5 hover:shadow-md transition-shadow">
      <div className="flex items-center justify-between">
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground font-medium">{title}</p>
          <p className="text-2xl font-bold mt-1 truncate">{value}</p>
          {subtitle && (
            <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>
          )}
        </div>
        <div className={`p-3 rounded-xl shrink-0 ${colorClass}`}>
          <Icon className="w-6 h-6" />
        </div>
      </div>
    </Card>
  );
}