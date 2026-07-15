import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";

type AuthOAuth = {
  getAuthorizationDetails: (id: string) => Promise<{
    data: { client?: { name?: string }; redirect_url?: string; redirect_to?: string; scope?: string } | null;
    error: { message: string } | null;
  }>;
  approveAuthorization: (id: string) => Promise<{
    data: { redirect_url?: string; redirect_to?: string } | null;
    error: { message: string } | null;
  }>;
  denyAuthorization: (id: string) => Promise<{
    data: { redirect_url?: string; redirect_to?: string } | null;
    error: { message: string } | null;
  }>;
};

function oauthApi(): AuthOAuth {
  return (supabase.auth as unknown as { oauth: AuthOAuth }).oauth;
}

function isSafeNext(v: string | null | undefined): v is string {
  return !!v && v.startsWith("/") && !v.startsWith("//");
}

export const Route = createFileRoute("/.lovable/oauth/consent")({
  ssr: false,
  validateSearch: (s: Record<string, unknown>) => ({
    authorization_id: typeof s.authorization_id === "string" ? s.authorization_id : "",
  }),
  beforeLoad: async ({ search, location }) => {
    if (!search.authorization_id) throw new Error("Missing authorization_id");
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      const next = location.pathname + location.searchStr;
      throw redirect({ to: "/auth", search: { next } as never });
    }
  },
  loader: async ({ location }) => {
    const authorizationId = new URLSearchParams(location.search).get("authorization_id")!;
    const { data, error } = await oauthApi().getAuthorizationDetails(authorizationId);
    if (error) throw new Error(error.message);
    const immediate = data?.redirect_url ?? data?.redirect_to;
    if (immediate && !data?.client) {
      window.location.href = immediate;
      return data;
    }
    return data;
  },
  component: Consent,
  errorComponent: ({ error }) => (
    <main className="min-h-screen flex items-center justify-center p-8 text-sm">
      <div className="glass-strong rounded-xl p-6 max-w-md">
        <h1 className="font-display text-xl mb-2">Authorization error</h1>
        <p className="text-hud-dim">{String((error as Error)?.message ?? error)}</p>
      </div>
    </main>
  ),
});

function Consent() {
  const details = Route.useLoaderData();
  const { authorization_id } = Route.useSearch();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function decide(approve: boolean) {
    setBusy(true);
    setError(null);
    const api = oauthApi();
    const { data, error } = approve
      ? await api.approveAuthorization(authorization_id)
      : await api.denyAuthorization(authorization_id);
    if (error) {
      setBusy(false);
      setError(error.message);
      return;
    }
    const target = data?.redirect_url ?? data?.redirect_to;
    if (!target) {
      setBusy(false);
      setError("No redirect returned by the authorization server.");
      return;
    }
    window.location.href = target;
  }

  const clientName = details?.client?.name ?? "an app";

  return (
    <main className="min-h-screen flex items-center justify-center p-8">
      <div className="glass-strong hud-corners rounded-2xl p-8 max-w-md w-full space-y-5">
        <div>
          <div className="font-mono text-[10px] tracking-[0.4em] text-arc">[ AUTHORIZE ]</div>
          <h1 className="font-display text-2xl mt-2 text-glow">Connect {clientName} to JARVIS</h1>
        </div>
        <p className="text-sm text-hud-dim">
          {clientName} will be able to call JARVIS tools (notes, reminders, chat memory, holdings) while you are signed in.
          This does not bypass JARVIS's own permissions.
        </p>
        {details?.scope ? (
          <p className="font-mono text-[11px] text-hud-dim">Requested scope: {details.scope}</p>
        ) : null}
        {error && <p role="alert" className="text-destructive text-sm">{error}</p>}
        <div className="flex gap-3">
          <button
            disabled={busy}
            onClick={() => decide(true)}
            className="flex-1 rounded-md bg-arc py-2.5 font-medium text-arc-foreground shadow-arc hover:opacity-90 transition disabled:opacity-50"
          >
            {busy ? "Working…" : "Approve"}
          </button>
          <button
            disabled={busy}
            onClick={() => decide(false)}
            className="flex-1 rounded-md border border-arc/30 py-2.5 text-sm hover:border-arc transition disabled:opacity-50"
          >
            Deny
          </button>
        </div>
      </div>
    </main>
  );
}

// silence unused-import warning for the helper
void isSafeNext;
