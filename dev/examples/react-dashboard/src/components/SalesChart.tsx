/** Sales per day this week, Monday to Sunday. */
const WEEKLY_SALES = [32, 48, 40, 65, 54, 72, 61];

const CHART_WIDTH = 40;
const CHART_GAP = 14;
const CHART_HEIGHT = 120;

/** A small SVG bar chart, no charting library: one <rect> per day. */
export function SalesChart() {
  const max = Math.max(...WEEKLY_SALES);
  return (
    <section className="chart-card">
      <h3>Sales this week</h3>
      <svg
        className="sales-chart"
        viewBox={`0 0 ${WEEKLY_SALES.length * (CHART_WIDTH + CHART_GAP)} ${CHART_HEIGHT}`}
        role="img"
        aria-label="Bar chart of sales per day this week"
      >
        {WEEKLY_SALES.map((value, i) => {
          const barHeight = (value / max) * CHART_HEIGHT;
          return (
            <rect
              key={i}
              className="chart-bar"
              x={i * (CHART_WIDTH + CHART_GAP)}
              y={CHART_HEIGHT - barHeight}
              width={CHART_WIDTH}
              height={barHeight}
            />
          );
        })}
      </svg>
    </section>
  );
}
