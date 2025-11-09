const ALPHAVANTAGE_BASE_URL = "https://www.alphavantage.co/query";

export type ChartRange = "1M" | "3M" | "6M" | "1Y";

const RANGE_TO_POINTS: Record<ChartRange, number> = {
  "1M": 22,
  "3M": 66,
  "6M": 132,
  "1Y": 252,
};

export type StockInsights = {
  symbol: string;
  companyName?: string;
  price: number;
  previousClose: number;
  change: number;
  changePercent: number;
  open: number;
  high: number;
  low: number;
  volume?: number;
  currency?: string;
  marketCap?: number;
  lastRefreshed: string;
  timezone?: string;
  range: ChartRange;
  chart: Array<{ date: string; close: number }>;
};

type AlphaVantageResponse = Record<string, unknown>;

async function callAlphaVantage(params: Record<string, string>): Promise<AlphaVantageResponse> {
  const apiKey = import.meta.env.VITE_ALPHA_VANTAGE_API_KEY;
  if (!apiKey) {
    throw new Error("Alpha Vantage API key is not configured. Set VITE_ALPHA_VANTAGE_API_KEY in your environment.");
  }

  const url = new URL(ALPHAVANTAGE_BASE_URL);
  Object.entries({ ...params, apikey: apiKey }).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`Alpha Vantage request failed with status ${response.status}`);
  }

  const data = (await response.json()) as AlphaVantageResponse;
  if ("Note" in data) {
    throw new Error("Alpha Vantage rate limit reached. Please wait a minute before trying again.");
  }
  if ("Information" in data) {
    throw new Error(String(data["Information"]));
  }
  if ("Error Message" in data) {
    throw new Error(String(data["Error Message"]));
  }

  return data;
}

function parseNumeric(value: unknown): number | undefined {
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  return undefined;
}

function toChartRange(range?: ChartRange): ChartRange {
  return (range ?? "1M");
}

export async function fetchStockInsights(symbol: string, range?: ChartRange): Promise<StockInsights> {
  const effectiveRange = toChartRange(range);
  const outputSize = effectiveRange === "1Y" ? "full" : "compact";

  const [seriesData, overviewData] = await Promise.all([
    callAlphaVantage({
      function: "TIME_SERIES_DAILY_ADJUSTED",
      symbol,
      outputsize: outputSize,
    }),
    callAlphaVantage({
      function: "OVERVIEW",
      symbol,
    }).catch(() => ({})),
  ]);

  const meta = seriesData["Meta Data"] as Record<string, string> | undefined;
  const series = seriesData["Time Series (Daily)"] as Record<string, Record<string, string>> | undefined;

  if (!series || Object.keys(series).length === 0) {
    throw new Error(`No daily price data found for symbol ${symbol.toUpperCase()}.`);
  }

  const orderedEntries = Object.entries(series)
    .map(([date, values]) => ({
      date,
      close: parseNumeric(values["4. close"]) ?? parseNumeric(values["5. adjusted close"]),
      open: parseNumeric(values["1. open"]),
      high: parseNumeric(values["2. high"]),
      low: parseNumeric(values["3. low"]),
      volume: parseNumeric(values["6. volume"]),
    }))
    .filter(entry => typeof entry.close === "number")
    .sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
    );

  if (orderedEntries.length === 0) {
    throw new Error(`Unable to parse price history for ${symbol.toUpperCase()}.`);
  }

  const latestEntry = orderedEntries[orderedEntries.length - 1];
  const previousEntry = orderedEntries[orderedEntries.length - 2] ?? latestEntry;
  const points = RANGE_TO_POINTS[effectiveRange];
  const chartSlice = orderedEntries.slice(-Math.min(points, orderedEntries.length));

  const price = latestEntry.close as number;
  const previousClose = previousEntry.close as number;
  const change = price - previousClose;
  const changePercent = previousClose !== 0 ? (change / previousClose) * 100 : 0;

  const overview = overviewData as Record<string, string>;

  return {
    symbol: symbol.toUpperCase(),
    companyName: overview?.Name ?? symbol.toUpperCase(),
    price,
    previousClose,
    change,
    changePercent,
    open: latestEntry.open ?? price,
    high: latestEntry.high ?? price,
    low: latestEntry.low ?? price,
    volume: latestEntry.volume,
    currency: overview?.Currency ?? "USD",
    marketCap: overview?.MarketCapitalization ? Number(overview.MarketCapitalization) : undefined,
    lastRefreshed: meta?.["3. Last Refreshed"] ?? latestEntry.date,
    timezone: meta?.["5. Time Zone"] ?? overview?.Country,
    range: effectiveRange,
    chart: chartSlice.map(point => ({
      date: point.date,
      close: point.close as number,
    })),
  };
}

