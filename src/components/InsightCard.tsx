import { motion } from 'framer-motion';

interface InsightCardProps {
  insights: string[];
}

export function InsightCard({ insights }: InsightCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="apple-card"
    >
      <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-3">
        Insights Automáticos
      </h3>
      <div className="space-y-2.5">
        {insights.map((insight, i) => (
          <motion.p
            key={i}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.15 }}
            className="text-sm text-card-foreground leading-relaxed"
          >
            {insight}
          </motion.p>
        ))}
      </div>
    </motion.div>
  );
}
