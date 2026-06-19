import { createFileRoute, useRouter, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { refreshStockPrices } from "@/lib/stocks.functions";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { Trash2, RefreshCw, Plus, AlertTriangle, Wallet, TrendingUp } from "lucide-react";

function SpendingError({ error, reset }: { error: Error; reset: () => void }) {
  const router = useRouter();
  const msg = error?.message ?? "Unknown error";
  const lower = msg.toLowerCase();
  let hint = "I couldn't load your spending data.";
  if (lower.includes("jwt") || lower.includes("auth") || lower.includes("unauthorized")) {
    hint = "Your session expired. Sign back in and I'll fetch the ledger again.";
  } else if (lower.includes("permission") || lower.includes("rls") || lower.includes("policy")) {
    hint = "I don't have permission to read the transactions table. The access policy may be missing.";
  } else if (lower.includes("relation") && lower.includes("does not exist")) {
    hint = "The transactions table isn't set up yet. The latest migration may not have run.";
  } else if (lower.includes("network") || lower.includes("fetch")) {
    hint = "I can't reach the backend right now. Check your connection and try again.";
  }
  return (
    <div className="max-w-2xl">
      <Card className="p-6 space-y-4">
        <div className="flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-400" />
          <h1 className="text-2xl font-light">Spending ledger unavailable</h1>
        </div>
        <p className="text-sm text-muted-foreground">{hint}</p>
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer">Technical detail</summary>
          <pre className="mt-2 whitespace-pre-wrap break-words font-mono">{msg}</pre>
        </details>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => { router.invalidate(); reset(); }}>Retry</Button>
          <Button asChild variant="outline" size="sm"><Link to="/dashboard">Back to dashboard</Link></Button>
        </div>
      </Card>
    </div>
  );
}

export const Route = createFileRoute("/_authenticated/spending")({
  component: SpendingPage,
  errorComponent: SpendingError,
  notFoundComponent: () => (
    <Card className="p-6 max-w-xl">
      <h1 className="text-2xl font-light">No spending records found</h1>
      <p className="text-sm text-muted-foreground mt-2">
        I couldn't find any transactions for your account yet. Log one in chat or use the Add button on the Spending page once it loads.
      </p>
    </Card>
  ),
});

type Tx = {
  id: string;
  amount_cents: number;
  merchant: string | null;
  category: string;
  note: string | null;
  source: string;
  occurred_at: string;
};

const CATEGORIES = ["food", "transport", "entertainment", "bills", "shopping", "groceries", "transfer", "income", "other"];

function fmt(cents: number) {
  const v = Math.abs(cents) / 100;
  return `${cents < 0 ? "+" : ""}$${v.toFixed(2)}`;
}

function SpendingPage() {
  const qc = useQueryClient();
  const [syncing, setSyncing] = useState(false);
  const [adding, setAdding] = useState(false);

  const { data: txs = [], error: txError, isLoading, refetch } = useQuery({
    queryKey: ["transactions"],
    queryFn: async () => {
      const since = new Date(Date.now() - 90 * 86400000).toISOString();
      const { data, error } = await supabase.from("transactions")
        .select("*").gte("occurred_at", since)
        .order("occurred_at", { ascending: false }).limit(200);
      if (error) throw error;
      return data as Tx[];
    },
    retry: 1,
  });

  const now = Date.now();
  const week = txs.filter(t => now - new Date(t.occurred_at).getTime() < 7 * 86400000);
  const month = txs.filter(t => new Date(t.occurred_at).getMonth() === new Date().getMonth() && new Date(t.occurred_at).getFullYear() === new Date().getFullYear());
  const last30 = txs.filter(t => now - new Date(t.occurred_at).getTime() < 30 * 86400000);

  const sum = (arr: Tx[]) => arr.reduce((s, t) => s + Math.max(t.amount_cents, 0), 0);
  const byCat: Record<string, number> = {};
  for (const t of last30) byCat[t.category] = (byCat[t.category] ?? 0) + Math.max(t.amount_cents, 0);
  const catMax = Math.max(1, ...Object.values(byCat));

  async function sync() {
    setSyncing(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch("/api/public/hooks/ingest-cashapp", {
        method: "POST",
        headers: { Authorization: `Bearer ${session?.access_token}` },
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error ?? "Sync failed");
      toast.success(`Imported ${j.inserted ?? 0} Cash App transaction(s)`);
      qc.invalidateQueries({ queryKey: ["transactions"] });
    } catch (e: any) {
      toast.error(e.message ?? "Sync failed");
    } finally {
      setSyncing(false);
    }
  }

  async function del(id: string) {
    const { error } = await supabase.from("transactions").delete().eq("id", id);
    if (error) toast.error(error.message);
    else qc.invalidateQueries({ queryKey: ["transactions"] });
  }

  async function addManual(form: FormData) {
    const amount = parseFloat(String(form.get("amount") ?? "0"));
    if (!isFinite(amount) || amount === 0) return toast.error("Enter an amount");
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { error } = await supabase.from("transactions").insert({
      user_id: user.id,
      amount_cents: Math.round(amount * 100),
      merchant: String(form.get("merchant") ?? "") || null,
      category: String(form.get("category") ?? "other"),
      note: String(form.get("note") ?? "") || null,
      source: "manual",
    });
    if (error) toast.error(error.message);
    else {
      toast.success("Logged");
      setAdding(false);
      qc.invalidateQueries({ queryKey: ["transactions"] });
    }
  }

  return (
    
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-light tracking-wide">Spending</h1>
            <p className="text-sm text-muted-foreground">Cash App receipts auto-import hourly. Chat me amounts and I'll log them too.</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setAdding(v => !v)}><Plus className="w-4 h-4 mr-1" />Add</Button>
            <Button size="sm" onClick={sync} disabled={syncing}>
              <RefreshCw className={`w-4 h-4 mr-1 ${syncing ? "animate-spin" : ""}`} />
              {syncing ? "Syncing…" : "Sync Cash App"}
            </Button>
          </div>
        </div>

        {txError && (
          <Card className="p-4 border-amber-500/40">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5" />
              <div className="flex-1">
                <div className="text-sm font-medium">Couldn't load transactions</div>
                <div className="text-xs text-muted-foreground mt-1">{(txError as Error).message}</div>
              </div>
              <Button size="sm" variant="outline" onClick={() => refetch()}>Retry</Button>
            </div>
          </Card>
        )}

        {isLoading && !txError && (
          <div className="text-sm text-muted-foreground">Loading ledger…</div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
            { label: "This week", v: sum(week) },
            { label: "This month", v: sum(month) },
            { label: "Last 30 days", v: sum(last30) },
          ].map(s => (
            <Card key={s.label} className="p-5">
              <div className="text-xs uppercase tracking-widest text-muted-foreground">{s.label}</div>
              <div className="text-3xl font-light mt-1">${(s.v / 100).toFixed(2)}</div>
            </Card>
          ))}
        </div>

        {adding && (
          <Card className="p-4">
            <form className="grid grid-cols-2 md:grid-cols-5 gap-3" onSubmit={(e) => { e.preventDefault(); addManual(new FormData(e.currentTarget)); }}>
              <input name="amount" placeholder="Amount" type="number" step="0.01" className="px-3 py-2 rounded bg-background border" required />
              <input name="merchant" placeholder="Merchant" className="px-3 py-2 rounded bg-background border" />
              <select name="category" className="px-3 py-2 rounded bg-background border" defaultValue="other">
                {CATEGORIES.map(c => <option key={c}>{c}</option>)}
              </select>
              <input name="note" placeholder="Note" className="px-3 py-2 rounded bg-background border" />
              <Button type="submit">Save</Button>
            </form>
          </Card>
        )}

        <Card className="p-5">
          <h2 className="text-sm uppercase tracking-widest text-muted-foreground mb-3">Last 30 days by category</h2>
          {Object.keys(byCat).length === 0 && <p className="text-sm text-muted-foreground">No spending yet.</p>}
          <div className="space-y-2">
            {Object.entries(byCat).sort((a, b) => b[1] - a[1]).map(([cat, cents]) => (
              <div key={cat} className="space-y-1">
                <div className="flex justify-between text-sm">
                  <span className="capitalize">{cat}</span>
                  <span className="tabular-nums">${(cents / 100).toFixed(2)}</span>
                </div>
                <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                  <div className="h-full bg-primary" style={{ width: `${(cents / catMax) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card className="p-0 overflow-hidden">
          <div className="px-5 py-3 border-b text-sm uppercase tracking-widest text-muted-foreground">Recent transactions</div>
          <div className="divide-y">
            {txs.length === 0 && <div className="p-5 text-sm text-muted-foreground">Nothing logged yet.</div>}
            {txs.map(t => (
              <div key={t.id} className="flex items-center px-5 py-3 gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium truncate">{t.merchant ?? "—"}</span>
                    <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{t.category}</span>
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{t.source}</span>
                  </div>
                  {t.note && <div className="text-xs text-muted-foreground truncate">{t.note}</div>}
                  <div className="text-xs text-muted-foreground">{new Date(t.occurred_at).toLocaleString()}</div>
                </div>
                <div className={`tabular-nums font-medium ${t.amount_cents < 0 ? "text-emerald-500" : ""}`}>{fmt(t.amount_cents)}</div>
                <Button variant="ghost" size="icon" onClick={() => del(t.id)}><Trash2 className="w-4 h-4" /></Button>
              </div>
            ))}
          </div>
        </Card>
      </div>
    
  );
}
