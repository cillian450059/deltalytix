"use client";

import * as React from "react";
import {
  ComposedChart,
  Area,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Cell,
} from "recharts";
import { useData } from "@/context/data-provider";
import { runMonteCarloSimulation, buildHistogram, type MonteCarloParams, type MonteCarloResult } from "@/lib/monte-carlo";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

// ── Helpers ──────────────────────────────────────────────────────────────

function fmt$(v: number) {
  return v >= 0
    ? `+$${Math.round(v).toLocaleString()}`
    : `-$${Math.abs(Math.round(v)).toLocaleString()}`;
}
function fmtPct(v: number, decimals = 1) {
  return `${v >= 0 ? "+" : ""}${v.toFixed(decimals)}%`;
}
function fmtK(v: number) {
  if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
  return `$${Math.round(v)}`;
}

// ── Sub-components ────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  sub,
  color,
}: {
  label: string;
  value: string;
  sub?: string;
  color?: "green" | "yellow" | "red" | "default";
}) {
  const colorCls =
    color === "green"
      ? "text-green-400"
      : color === "yellow"
      ? "text-yellow-400"
      : color === "red"
      ? "text-red-400"
      : "text-foreground";
  return (
    <div className="flex flex-col gap-0.5 rounded-lg bg-muted/40 px-3 py-2">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <span className={cn("text-lg font-bold tabular-nums", colorCls)}>
        {value}
      </span>
      {sub && <span className="text-[10px] text-muted-foreground">{sub}</span>}
    </div>
  );
}

// ── Equity-curve chart ────────────────────────────────────────────────────

function EquityCurveChart({ result }: { result: MonteCarloResult }) {
  const data = result.tradeIndices.map((t, i) => ({
    t,
    p5: result.equityP5[i],
    p25: result.equityP25[i],
    p50: result.equityP50[i],
    p75: result.equityP75[i],
    p95: result.equityP95[i],
    orig: result.originalCurve[i] ?? null,
  }));

  const allVals = [
    ...result.equityP5,
    ...result.equityP95,
    ...result.originalCurve,
  ].filter(Boolean);
  const yMin = Math.min(...allVals) * 0.98;
  const yMax = Math.max(...allVals) * 1.02;

  return (
    <ResponsiveContainer width="100%" height={260}>
      <ComposedChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
        <XAxis
          dataKey="t"
          tick={{ fontSize: 10, fill: "#888" }}
          label={{ value: "Trade #", position: "insideBottom", offset: -2, fontSize: 10, fill: "#888" }}
          height={28}
        />
        <YAxis
          tickFormatter={fmtK}
          tick={{ fontSize: 10, fill: "#888" }}
          domain={[yMin, yMax]}
          width={54}
        />
        <Tooltip
          formatter={(v: number, name: string) => [fmtK(v), name]}
          labelFormatter={(l) => `Trade ${l}`}
          contentStyle={{ background: "#1a1a2e", border: "1px solid #333", fontSize: 11 }}
        />

        {/* Outer band p5–p95 */}
        <Area
          type="monotone"
          dataKey="p95"
          fill="rgba(99,102,241,0.12)"
          stroke="rgba(99,102,241,0.3)"
          strokeWidth={1}
          strokeDasharray="4 3"
          dot={false}
          name="95th %ile"
        />
        <Area
          type="monotone"
          dataKey="p5"
          fill="rgba(17,17,34,1)"
          stroke="rgba(99,102,241,0.3)"
          strokeWidth={1}
          strokeDasharray="4 3"
          dot={false}
          name="5th %ile"
        />

        {/* Inner band p25–p75 */}
        <Area
          type="monotone"
          dataKey="p75"
          fill="rgba(99,102,241,0.18)"
          stroke="rgba(99,102,241,0.5)"
          strokeWidth={1}
          dot={false}
          name="75th %ile"
        />
        <Area
          type="monotone"
          dataKey="p25"
          fill="rgba(17,17,34,1)"
          stroke="rgba(99,102,241,0.5)"
          strokeWidth={1}
          dot={false}
          name="25th %ile"
        />

        {/* Median */}
        <Line
          type="monotone"
          dataKey="p50"
          stroke="rgba(99,102,241,0.9)"
          strokeWidth={2}
          dot={false}
          name="Median"
        />

        {/* Original historical curve */}
        <Line
          type="monotone"
          dataKey="orig"
          stroke="#f59e0b"
          strokeWidth={2}
          dot={false}
          name="Historical"
          strokeDasharray="6 3"
        />

        {/* Breakeven line */}
        <ReferenceLine
          y={result.initialCapital}
          stroke="rgba(255,255,255,0.2)"
          strokeDasharray="3 3"
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

// ── Histogram chart ───────────────────────────────────────────────────────

function ReturnHistogram({ result }: { result: MonteCarloResult }) {
  const bins = buildHistogram(result.finalReturns, 40);
  return (
    <ResponsiveContainer width="100%" height={180}>
      <BarChart data={bins} margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
        <XAxis
          dataKey="x"
          tickFormatter={(v) => `${v.toFixed(0)}%`}
          tick={{ fontSize: 9, fill: "#888" }}
          height={22}
        />
        <YAxis tick={{ fontSize: 9, fill: "#888" }} width={28} />
        <Tooltip
          formatter={(v: number, _: string) => [`${v.toFixed(1)}%`, "Frequency"]}
          labelFormatter={(l: number) => `Return ≈ ${l.toFixed(1)}%`}
          contentStyle={{ background: "#1a1a2e", border: "1px solid #333", fontSize: 11 }}
        />
        <ReferenceLine x={0} stroke="rgba(255,255,255,0.3)" strokeDasharray="3 3" />
        <Bar dataKey="pct" radius={[2, 2, 0, 0]}>
          {bins.map((b, i) => (
            <Cell
              key={i}
              fill={b.x >= 0 ? "rgba(34,197,94,0.7)" : "rgba(239,68,68,0.7)"}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// ── Main widget ───────────────────────────────────────────────────────────

export default function MonteCarloWidget() {
  const { formattedTrades } = useData();

  // Build PnL array from closed trades
  const pnls = React.useMemo(
    () => formattedTrades.filter((t) => t.pnl !== undefined).map((t) => t.pnl as number),
    [formattedTrades]
  );

  // Estimate initial capital from cumulative P&L history (rough heuristic)
  const guessedCapital = React.useMemo(() => {
    if (pnls.length === 0) return 10_000;
    const totalPnl = pnls.reduce((s, v) => s + v, 0);
    // Assume total P&L is ~20% of initial capital as a rough seed
    const guess = Math.max(10_000, Math.round(Math.abs(totalPnl) * 5 / 1000) * 1000);
    return Math.min(guess, 500_000);
  }, [pnls]);

  // ── Parameters ─────────────────────────────────────────────────────────
  const [nSimulations, setNSimulations] = React.useState(3000);
  const [nTrades, setNTrades] = React.useState(0); // 0 = use historical count
  const [ruinPct, setRuinPct] = React.useState(50); // -50%
  const [method, setMethod] = React.useState<"bootstrap" | "reshuffle">("bootstrap");
  const [initialCapital, setInitialCapital] = React.useState(0); // 0 = use guess

  // ── State ───────────────────────────────────────────────────────────────
  const [result, setResult] = React.useState<MonteCarloResult | null>(null);
  const [isRunning, setIsRunning] = React.useState(false);

  const effectiveTrades = nTrades > 0 ? nTrades : pnls.length;
  const effectiveCapital = initialCapital > 0 ? initialCapital : guessedCapital;

  function runSimulation() {
    if (pnls.length < 10) return;
    setIsRunning(true);
    // Yield to React first so button state updates
    setTimeout(() => {
      const params: MonteCarloParams = {
        nSimulations,
        nTrades: effectiveTrades,
        ruinThreshold: -(ruinPct / 100),
        method,
        initialCapital: effectiveCapital,
      };
      const r = runMonteCarloSimulation(pnls, params);
      setResult(r);
      setIsRunning(false);
    }, 16);
  }

  const ruinColor =
    result && result.ruinProbability < 5
      ? "green"
      : result && result.ruinProbability < 20
      ? "yellow"
      : "red";

  const medianReturnColor =
    result && result.finalReturnStats.p50 > 5
      ? "green"
      : result && result.finalReturnStats.p50 > 0
      ? "yellow"
      : "red";

  // ── No data state ───────────────────────────────────────────────────────
  if (pnls.length < 10) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
        <p className="text-sm font-medium text-muted-foreground">
          Need at least 10 closed trades for Monte Carlo simulation
        </p>
        <p className="text-xs text-muted-foreground">
          {pnls.length} trade{pnls.length !== 1 ? "s" : ""} available
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-3">
      {/* ── Controls ─────────────────────────────────────────────────── */}
      <details className="group rounded-lg border border-border/50 bg-muted/20">
        <summary className="flex cursor-pointer select-none items-center justify-between px-3 py-2 text-xs font-medium text-muted-foreground">
          <span>Parameters</span>
          <span className="text-[10px] group-open:hidden">
            {nSimulations.toLocaleString()} sims · {effectiveTrades} trades ·
            {" "}{method} · −{ruinPct}% ruin
          </span>
        </summary>

        <div className="grid gap-4 px-3 pb-3 pt-2 sm:grid-cols-2">
          {/* Simulations */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] text-muted-foreground">
              Simulations: <strong className="text-foreground">{nSimulations.toLocaleString()}</strong>
            </label>
            <Slider
              min={500}
              max={10000}
              step={500}
              value={[nSimulations]}
              onValueChange={([v]) => setNSimulations(v)}
            />
          </div>

          {/* Trades per simulation */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] text-muted-foreground">
              Trades/simulation:{" "}
              <strong className="text-foreground">
                {nTrades === 0 ? `${pnls.length} (historical)` : nTrades}
              </strong>
            </label>
            <Slider
              min={0}
              max={Math.max(1000, pnls.length * 2)}
              step={pnls.length > 100 ? 50 : 10}
              value={[nTrades]}
              onValueChange={([v]) => setNTrades(v)}
            />
          </div>

          {/* Ruin threshold */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] text-muted-foreground">
              Ruin threshold: <strong className="text-foreground">−{ruinPct}%</strong>
            </label>
            <Slider
              min={10}
              max={90}
              step={5}
              value={[ruinPct]}
              onValueChange={([v]) => setRuinPct(v)}
            />
          </div>

          {/* Initial capital */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] text-muted-foreground">
              Initial capital:{" "}
              <strong className="text-foreground">
                {initialCapital === 0 ? `${fmtK(effectiveCapital)} (auto)` : fmtK(initialCapital)}
              </strong>
            </label>
            <Slider
              min={0}
              max={500_000}
              step={5_000}
              value={[initialCapital]}
              onValueChange={([v]) => setInitialCapital(v)}
            />
          </div>

          {/* Method toggle */}
          <div className="col-span-full flex items-center gap-2">
            <span className="text-[11px] text-muted-foreground">Sampling:</span>
            {(["bootstrap", "reshuffle"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMethod(m)}
                className={cn(
                  "rounded px-2 py-0.5 text-[11px] font-medium transition-colors",
                  method === m
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                )}
              >
                {m === "bootstrap" ? "Bootstrap (w/ replacement)" : "Reshuffle (w/o replacement)"}
              </button>
            ))}
          </div>
        </div>
      </details>

      {/* ── Run button ───────────────────────────────────────────────── */}
      <Button
        onClick={runSimulation}
        disabled={isRunning}
        className="w-full"
        size="sm"
      >
        {isRunning
          ? `Running ${nSimulations.toLocaleString()} simulations…`
          : result
          ? `Re-run Monte Carlo (${nSimulations.toLocaleString()} sims)`
          : `Run Monte Carlo (${nSimulations.toLocaleString()} sims)`}
      </Button>

      {/* ── Results ──────────────────────────────────────────────────── */}
      {result && (
        <>
          {/* Key metrics */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <StatCard
              label="Ruin probability"
              value={`${result.ruinProbability.toFixed(1)}%`}
              sub={`−${ruinPct}% threshold`}
              color={ruinColor}
            />
            <StatCard
              label="Median final return"
              value={fmtPct(result.finalReturnStats.p50)}
              sub={`mean ${fmtPct(result.finalReturnStats.mean)}`}
              color={medianReturnColor}
            />
            <StatCard
              label="Worst 5% return"
              value={fmtPct(result.finalReturnStats.p5)}
              sub="5th percentile"
              color={result.finalReturnStats.p5 >= 0 ? "green" : "red"}
            />
            <StatCard
              label="95th %ile max DD"
              value={`−${result.maxDrawdownStats.p95.toFixed(1)}%`}
              sub={`median −${result.maxDrawdownStats.p50.toFixed(1)}%`}
              color={
                result.maxDrawdownStats.p95 <= 15
                  ? "green"
                  : result.maxDrawdownStats.p95 <= 35
                  ? "yellow"
                  : "red"
              }
            />
          </div>

          {/* Equity curve */}
          <div>
            <div className="mb-1 flex items-center gap-2">
              <span className="text-xs font-medium text-muted-foreground">
                Equity Curve Confidence Bands
              </span>
              <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                <span className="flex items-center gap-1">
                  <span className="inline-block h-2 w-4 rounded bg-indigo-500/40" />
                  5–95%
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block h-2 w-4 rounded bg-indigo-500/60" />
                  25–75%
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block h-0.5 w-4 bg-indigo-400" />
                  Median
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block h-0.5 w-4 bg-amber-400" style={{ borderTop: "2px dashed" }} />
                  Historical
                </span>
              </div>
            </div>
            <EquityCurveChart result={result} />
          </div>

          {/* Distribution */}
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">
              Final Return Distribution
              <span className="ml-2 text-[10px]">
                (green = profit · red = loss ·{" "}
                {result.finalReturns.filter((r) => r >= 0).length} / {result.nSimulations} profitable)
              </span>
            </p>
            <ReturnHistogram result={result} />
          </div>

          {/* Percentile table */}
          <div className="overflow-x-auto rounded-lg border border-border/50">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="border-b border-border/50 bg-muted/30">
                  <th className="px-3 py-1.5 text-left text-muted-foreground">Percentile</th>
                  <th className="px-3 py-1.5 text-right text-muted-foreground">Final equity</th>
                  <th className="px-3 py-1.5 text-right text-muted-foreground">Return</th>
                  <th className="px-3 py-1.5 text-right text-muted-foreground">Max drawdown</th>
                </tr>
              </thead>
              <tbody>
                {(
                  [
                    { label: "5th (worst 5%)", pctKey: "p5" as const },
                    { label: "25th", pctKey: "p25" as const },
                    { label: "50th (median)", pctKey: "p50" as const },
                    { label: "75th", pctKey: "p75" as const },
                    { label: "95th (best 5%)", pctKey: "p95" as const },
                  ] as const
                ).map(({ label, pctKey }) => {
                  const ret = result.finalReturnStats[pctKey];
                  const dd = result.maxDrawdownStats[pctKey];
                  const equity = result.initialCapital * (1 + ret / 100);
                  return (
                    <tr key={pctKey} className="border-b border-border/30 last:border-0 hover:bg-muted/20">
                      <td className="px-3 py-1.5 text-muted-foreground">{label}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{fmtK(equity)}</td>
                      <td
                        className={cn(
                          "px-3 py-1.5 text-right tabular-nums",
                          ret >= 0 ? "text-green-400" : "text-red-400"
                        )}
                      >
                        {fmtPct(ret)}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-red-400">
                        −{dd.toFixed(1)}%
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Timing */}
          <p className="text-center text-[10px] text-muted-foreground">
            {result.nSimulations.toLocaleString()} simulations × {result.nTrades} trades
            {" "}computed in {result.durationMs.toFixed(0)} ms
          </p>
        </>
      )}
    </div>
  );
}
