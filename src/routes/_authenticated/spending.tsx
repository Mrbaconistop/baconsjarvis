import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { PageHeader } from "@/components/jarvis/HudBits";
import { getCashBalance, setCashBalance, getHoldings, addTransaction, updateLastPrice } from "@/lib/jarvis.functions";
import { toast } from "sonner";
import { Plus, DollarSign, Edit, RefreshCw, TrendingUp, TrendingDown } from "lucide-react";

export const Route = createFileRoute("/_authenticated/spending")({
  head: () => ({ meta: [{ title: "Portfolio — JARVIS" }] }),
  component: PortfolioPage,
});

function PortfolioPage() {
  const qc = useQueryClient();
  const getCash = useServerFn(getCashBalance);
  const setCash = useServerFn(setCashBalance);
  const getHoldingsFn = useServerFn(getHoldings);
  const addTx = useServerFn(addTransaction);
  const updatePrice = useServerFn(updateLastPrice);

  const { data: cash, refetch: refetchCash } = useQuery({
    queryKey: ["cash-balance"],
    queryFn: () => getCash(),
  });
  const { data: holdings, refetch: refetchHoldings } = useQuery({
    queryKey: ["stock-holdings"],
    queryFn: () => getHoldingsFn(),
  });

  const [showAdd, setShowAdd] = useState(false);
  const [showEditCash, setShowEditCash] = useState(false);
  const [newCash, setNewCash] = useState("");
  const [form, setForm] = useState({
    type: "buy" as "buy" | "sell",
    ticker: "",
    shares: "",
    price: "",
    note: "",
  });

  async function handleAddTx(e: React.FormEvent) {
    e.preventDefault();
    const shares = parseFloat(form.shares);
    const price = parseFloat(form.price);
    if (!form.ticker || isNaN(shares) || isNaN(price) || shares <= 0 || price <= 0) {
      toast.error("Please fill in all fields correctly.");
      return;
    }
    try {
      await addTx({
        data: {
          type: form.type,
          ticker: form.ticker.toUpperCase(),
          shares,
          price_per_share: price,
          note: form.note || undefined,
        },
      });
      toast.success(`${form.type === "buy" ? "Bought" : "Sold"} ${form.ticker.toUpperCase()}`);
      setShowAdd(false);
      setForm({ type: "buy", ticker: "", shares: "", price: "", note: "" });
      refetchCash();
      refetchHoldings();
      qc.invalidateQueries({ queryKey: ["transactions"] });
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  async function handleSetCash() {
    const cents = Math.round(parseFloat(newCash) * 100);
    if (isNaN(cents)) return toast.error("Enter a valid amount.");
    try {
      await setCash({ data: { amount_cents: cents } });
      toast.success("Cash balance updated.");
      setShowEditCash(false);
      setNewCash("");
      refetchCash();
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  async function handleUpdatePrice(ticker: string, currentPrice: number) {
    const input = window.prompt(`Enter current price for ${ticker}:`, currentPrice.toFixed(2));
    if (input === null) return;
    const price = parseFloat(input);
    if (isNaN(price) || price <= 0) return toast.error("Invalid price.");
    try {
      await updatePrice({ data: { ticker, last_price: price } });
      toast.success(`Price updated for ${ticker}`);
      refetchHoldings();
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  const totalValue = (holdings || []).reduce((sum: number, h: any) => {
    const price = h.last_price_cents ? h.last_price_cents / 100 : h.avg_cost_cents / 100;
    return sum + h.shares * price;
  }, 0);

  return (
    <div className="flex flex-col h-screen">
      <PageHeader
        tag="04 · PORTFOLIO"
        title="Portfolio Tracker"
        subtitle="Track your cash and stock holdings."
        right={
          <button
            onClick={() => setShowAdd(true)}
            className="text-xs flex items-center gap-1.5 px-3 py-2 rounded-md bg-arc text-arc-foreground shadow-arc hover:opacity-90 transition"
          >
            <Plus size={12} /> Add Transaction
          </button>
        }
      />

      <div className="flex-1 overflow-y-auto px-8 py-6 space-y-6">
        {/* Cash Balance */}
        <div className="glass-strong hud-corners rounded-xl p-5">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-mono text-[10px] tracking-[0.3em] text-arc">CASH BALANCE</div>
              <div className="font-display text-3xl mt-1 text-glow">${((cash || 0) / 100).toFixed(2)}</div>
            </div>
            <button
              onClick={() => setShowEditCash(true)}
              className="text-xs flex items-center gap-1.5 px-3 py-2 rounded-md border border-arc/30 hover:bg-arc/10"
            >
              <Edit size={12} /> Edit
            </button>
          </div>
        </div>

        {/* Holdings */}
        <div className="glass-strong hud-corners rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="font-mono text-[10px] tracking-[0.3em] text-arc">HOLDINGS</div>
            <div className="text-sm text-muted-foreground">
              Total Value: <span className="text-arc font-display">${totalValue.toFixed(2)}</span>
            </div>
          </div>
          {!holdings || holdings.length === 0 ? (
            <div className="text-sm text-muted-foreground">No stock holdings yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-hud-dim font-mono text-[10px] uppercase tracking-wider">
                    <th className="text-left py-2">Ticker</th>
                    <th className="text-right py-2">Shares</th>
                    <th className="text-right py-2">Avg Cost</th>
                    <th className="text-right py-2">Last Price</th>
                    <th className="text-right py-2">Value</th>
                    <th className="text-right py-2">P/L</th>
                    <th className="text-right py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {holdings.map((h: any) => {
                    const avgCost = h.avg_cost_cents / 100;
                    const lastPrice = h.last_price_cents ? h.last_price_cents / 100 : avgCost;
                    const value = h.shares * lastPrice;
                    const pl = h.shares * (lastPrice - avgCost);
                    return (
                      <tr key={h.ticker} className="border-t border-arc/10">
                        <td className="py-2 font-mono">{h.ticker}</td>
                        <td className="text-right">{h.shares}</td>
                        <td className="text-right">${avgCost.toFixed(2)}</td>
                        <td className="text-right">${lastPrice.toFixed(2)}</td>
                        <td className="text-right">${value.toFixed(2)}</td>
                        <td className={`text-right ${pl >= 0 ? "text-success" : "text-critical"}`}>${pl.toFixed(2)}</td>
                        <td className="text-right">
                          <button
                            onClick={() => handleUpdatePrice(h.ticker, lastPrice)}
                            className="text-xs text-hud-dim hover:text-arc"
                          >
                            <RefreshCw size={14} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Add Transaction Modal */}
      {showAdd && (
        <div
          className="fixed inset-0 bg-background/80 backdrop-blur-md z-50 flex items-center justify-center p-6"
          onClick={() => setShowAdd(false)}
        >
          <div className="glass-strong hud-corners rounded-xl p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-display text-lg mb-4">Add Transaction</h2>
            <form onSubmit={handleAddTx} className="space-y-4">
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setForm({ ...form, type: "buy" })}
                  className={`flex-1 py-2 rounded-md text-sm font-medium transition ${form.type === "buy" ? "bg-success/20 text-success border border-success/40" : "bg-background/40 border border-arc/20"}`}
                >
                  Buy
                </button>
                <button
                  type="button"
                  onClick={() => setForm({ ...form, type: "sell" })}
                  className={`flex-1 py-2 rounded-md text-sm font-medium transition ${form.type === "sell" ? "bg-critical/20 text-critical border border-critical/40" : "bg-background/40 border border-arc/20"}`}
                >
                  Sell
                </button>
              </div>
              <input
                value={form.ticker}
                onChange={(e) => setForm({ ...form, ticker: e.target.value.toUpperCase() })}
                placeholder="Ticker (e.g., MRVL)"
                className="w-full bg-background/60 border border-arc/20 rounded-md px-3 py-2 text-sm font-mono focus:border-arc focus:outline-none"
                required
              />
              <input
                type="number"
                step="any"
                value={form.shares}
                onChange={(e) => setForm({ ...form, shares: e.target.value })}
                placeholder="Shares"
                className="w-full bg-background/60 border border-arc/20 rounded-md px-3 py-2 text-sm focus:border-arc focus:outline-none"
                required
              />
              <input
                type="number"
                step="any"
                value={form.price}
                onChange={(e) => setForm({ ...form, price: e.target.value })}
                placeholder="Price per share"
                className="w-full bg-background/60 border border-arc/20 rounded-md px-3 py-2 text-sm focus:border-arc focus:outline-none"
                required
              />
              <input
                value={form.note}
                onChange={(e) => setForm({ ...form, note: e.target.value })}
                placeholder="Note (optional)"
                className="w-full bg-background/60 border border-arc/20 rounded-md px-3 py-2 text-sm focus:border-arc focus:outline-none"
              />
              <button
                type="submit"
                className="w-full bg-arc text-arc-foreground py-2 rounded-md shadow-arc hover:opacity-90 transition"
              >
                Add Transaction
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Edit Cash Modal */}
      {showEditCash && (
        <div
          className="fixed inset-0 bg-background/80 backdrop-blur-md z-50 flex items-center justify-center p-6"
          onClick={() => setShowEditCash(false)}
        >
          <div className="glass-strong hud-corners rounded-xl p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-display text-lg mb-4">Edit Cash Balance</h2>
            <input
              type="number"
              step="0.01"
              value={newCash}
              onChange={(e) => setNewCash(e.target.value)}
              placeholder="Enter current cash balance"
              className="w-full bg-background/60 border border-arc/20 rounded-md px-3 py-2 text-sm focus:border-arc focus:outline-none"
            />
            <button
              onClick={handleSetCash}
              className="w-full mt-4 bg-arc text-arc-foreground py-2 rounded-md shadow-arc hover:opacity-90 transition"
            >
              Update Cash
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
