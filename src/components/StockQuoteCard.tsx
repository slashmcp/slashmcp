import { memo, useMemo } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { format } from "date-fns";
import { StockInsights } from "@/lib/alphaVantage";
import { cn } from "@/lib/utils";

interface StockQuoteCardProps {
  title: string;
  insights: StockInsights;
}

const formatCurrency = (value: number, currency: string) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);

const formatCompactNumber = (value?: number) => {
  if (!value || !Number.isFinite(value)) return "—";
  if (value >= 1e12) return `${(value / 1e12).toFixed(2)}T`;
  if (value >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(2)}K`;
  return value.toLocaleString();
};

const parseChartDate = (date: string) => {
  const normalized = date.includes("T") ? date : `${date}T00:00:00`;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
};

type TooltipPoint = {
  payload?: {
    formattedDate?: string;
    formattedClose?: string;
  };
};

interface StockTooltipProps {
  active?: boolean;
  payload?: TooltipPoint[];
}

const StockTooltip = ({ active, payload }: StockTooltipProps) => {
  if (!active || !payload?.length) return null;
  const point = payload[0]?.payload;
  if (!point) return null;
  return (
    <div className="rounded-md border border-border/40 bg-background/95 px-3 py-2 text-xs shadow-md">
      <p className="font-medium text-foreground/80">{point.formattedDate}</p>
      <p className="text-foreground/70">Close: {point.formattedClose}</p>
    </div>
  );
};

export const StockQuoteCard = memo(({ title, insights }: StockQuoteCardProps) => {
  const currency = insights.currency ?? "USD";
  const isUp = insights.change >= 0;

  const chartData = useMemo(() => {
    if (!insights.chart.length) return [];
    const useMonthlyTicks = insights.chart.length > 90;
    return insights.chart.map(point => {
      const date = parseChartDate(point.date);
      return {
        ...point,
        formattedDate: format(date, useMonthlyTicks ? "MMM yyyy" : "MMM d"),
        formattedClose: formatCurrency(point.close, currency),
        axisLabel: format(date, useMonthlyTicks ? "MMM yy" : "MMM d"),
      };
    });
  }, [insights.chart, currency]);

  const priceDisplay = formatCurrency(insights.price, currency);
  const changeDisplay = `${isUp ? "+" : ""}${insights.change.toFixed(2)} ${currency}`;
  const percentDisplay = `${isUp ? "+" : ""}${insights.changePercent.toFixed(2)}%`;

  return (
    <div className="w-full overflow-hidden rounded-2xl bg-gradient-glass backdrop-blur-xl border border-glass-border/30">
      <div className="border-b border-border/40 bg-background/60 px-5 py-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-foreground/60">Stock Quote</p>
            <h3 className="mt-1 text-xl font-semibold text-foreground">{title}</h3>
            {insights.companyName && (
              <p className="text-sm text-foreground/60">{insights.companyName}</p>
            )}
          </div>
          <div className="text-right">
            <p className="text-2xl font-semibold text-foreground">{priceDisplay}</p>
            <p
              className={cn(
                "mt-1 text-sm font-medium",
                isUp ? "text-emerald-500" : "text-red-500",
              )}
            >
              {changeDisplay} · {percentDisplay}
            </p>
            <p className="mt-1 text-xs text-foreground/50">
              Updated {insights.lastRefreshed}
              {insights.timezone ? ` (${insights.timezone})` : ""}
            </p>
          </div>
        </div>
      </div>

      <div className="px-5 py-4">
        <div className="h-52">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="priceGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={isUp ? "#34d399" : "#ef4444"} stopOpacity={0.35} />
                  <stop offset="95%" stopColor={isUp ? "#34d399" : "#ef4444"} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#ffffff0a" strokeDasharray="4 8" vertical={false} />
              <XAxis
                dataKey="axisLabel"
                interval="preserveStartEnd"
                tick={{ fill: "rgba(255,255,255,0.55)", fontSize: 12 }}
                axisLine={{ stroke: "rgba(255,255,255,0.08)" }}
                tickLine={false}
              />
              <YAxis
                domain={["auto", "auto"]}
                tick={{ fill: "rgba(255,255,255,0.55)", fontSize: 12 }}
                axisLine={{ stroke: "rgba(255,255,255,0.08)" }}
                tickLine={false}
                tickFormatter={value => formatCurrency(value as number, currency)}
              />
              <Tooltip content={<StockTooltip />} cursor={{ stroke: "rgba(255,255,255,0.2)" }} />
              <Area
                type="monotone"
                dataKey="close"
                stroke={isUp ? "#10b981" : "#f87171"}
                strokeWidth={2}
                fill="url(#priceGradient)"
                dot={false}
                activeDot={{ r: 4 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <div className="rounded-xl border border-border/40 bg-background/40 px-4 py-3 text-sm">
            <p className="text-foreground/60">Day Range</p>
            <p className="mt-1 font-medium text-foreground">
              {formatCurrency(insights.low, currency)} – {formatCurrency(insights.high, currency)}
            </p>
          </div>
          <div className="rounded-xl border border-border/40 bg-background/40 px-4 py-3 text-sm">
            <p className="text-foreground/60">Open · Prev Close</p>
            <p className="mt-1 font-medium text-foreground">
              {formatCurrency(insights.open, currency)} · {formatCurrency(insights.previousClose, currency)}
            </p>
          </div>
          <div className="rounded-xl border border-border/40 bg-background/40 px-4 py-3 text-sm">
            <p className="text-foreground/60">Volume</p>
            <p className="mt-1 font-medium text-foreground">
              {formatCompactNumber(insights.volume)}
            </p>
          </div>
          <div className="rounded-xl border border-border/40 bg-background/40 px-4 py-3 text-sm">
            <p className="text-foreground/60">Market Cap</p>
            <p className="mt-1 font-medium text-foreground">
              {formatCompactNumber(insights.marketCap)}
            </p>
          </div>
        </div>

        <p className="mt-5 text-xs text-foreground/40">
          Showing {insights.range} price trend via Alpha Vantage.
        </p>
      </div>
    </div>
  );
});

StockQuoteCard.displayName = "StockQuoteCard";

