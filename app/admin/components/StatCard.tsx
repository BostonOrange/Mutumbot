interface StatCardProps {
  title: string;
  value: number | string;
  subtitle?: string;
}

export default function StatCard({ title, value, subtitle }: StatCardProps) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg p-6">
      <p className="text-sm font-medium text-gray-400 uppercase tracking-wider">
        {title}
      </p>
      <p className="mt-2 text-4xl font-bold text-amber-400">
        {value}
      </p>
      {subtitle && (
        <p className="mt-1 text-sm text-gray-500">{subtitle}</p>
      )}
    </div>
  );
}
