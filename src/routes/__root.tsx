import "@fontsource/space-grotesk/400.css";
import "@fontsource/space-grotesk/500.css";
import "@fontsource/space-grotesk/600.css";
import "@fontsource/space-grotesk/700.css";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Outlet, Link, createRootRouteWithContext, useRouter, HeadContent, Scripts } from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { installDebugConsole } from "../lib/debug-console";
import { supabase } from "@/integrations/supabase/client";
import { Toaster } from "@/components/ui/sonner";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 grid-bg">
      <div className="glass-strong hud-corners rounded-xl p-10 max-w-md text-center">
        <div className="text-arc font-mono text-xs tracking-[0.3em]">ERROR · 404</div>
        <h1 className="mt-4 text-4xl font-display text-glow">Signal lost</h1>
        <p className="mt-3 text-sm text-muted-foreground">That coordinate isn't in my records, Sir.</p>
        <Link
          to="/"
          className="inline-flex mt-6 items-center justify-center rounded-md bg-arc px-5 py-2 text-sm font-medium text-arc-foreground shadow-arc hover:opacity-90 transition"
        >
          Return to command
        </Link>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 grid-bg">
      <div className="glass-critical rounded-xl p-10 max-w-md text-center">
        <div className="text-critical font-mono text-xs tracking-[0.3em]">SYSTEM · FAULT</div>
        <h1 className="mt-4 text-2xl font-display">A subsystem went dark</h1>
        <p className="mt-3 text-sm text-muted-foreground">Apologies, Sir — recovering.</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="rounded-md bg-arc px-4 py-2 text-sm font-medium text-arc-foreground"
          >
            Retry
          </button>
          <a href="/" className="rounded-md border border-arc/40 px-4 py-2 text-sm">
            Home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "JARVIS — Your Personal Command Center" },
      {
        name: "description",
        content:
          "An AI-powered command center that triages your inbox, calendar, and social signals — and tells you what matters.",
      },
      { name: "author", content: "JARVIS" },
      { property: "og:title", content: "JARVIS — Your Personal Command Center" },
      {
        property: "og:description",
        content:
          "An AI-powered command center that triages your inbox, calendar, and social signals — and tells you what matters.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "JARVIS — Your Personal Command Center" },
      {
        name: "twitter:description",
        content:
          "An AI-powered command center that triages your inbox, calendar, and social signals — and tells you what matters.",
      },
      {
        property: "og:image",
        content:
          "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/425dd43d-724b-4676-aea5-a6da6fa0e91f/id-preview-cbc1b64c--e66d9074-0ef6-403c-a793-7588e4485a5f.lovable.app-1781886736548.png",
      },
      {
        name: "twitter:image",
        content:
          "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/425dd43d-724b-4676-aea5-a6da6fa0e91f/id-preview-cbc1b64c--e66d9074-0ef6-403c-a793-7588e4485a5f.lovable.app-1781886736548.png",
      },
      // CSP meta tag to allow Google Maps eval (required for geocoder to work)
      {
        httpEquiv: "Content-Security-Policy",
        content: "script-src 'self' https://maps.googleapis.com 'unsafe-eval' 'unsafe-inline';",
      },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "stylesheet", href: "https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css", integrity: "sha384-nB0miv6/jRmo5UMMR1wu3Gz6NLsoTkbqJghGIsx//Rlm+ZU03BU6SQNC66uf4l5+", crossOrigin: "anonymous" },
      { rel: "icon", href: "/favicon.ico" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const router = useRouter();

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event !== "SIGNED_IN" && event !== "SIGNED_OUT" && event !== "USER_UPDATED") return;
      router.invalidate();
      if (event !== "SIGNED_OUT") queryClient.invalidateQueries();
    });
    return () => sub.subscription.unsubscribe();
  }, [router, queryClient]);

  return (
    <QueryClientProvider client={queryClient}>
      <Outlet />
      <Toaster theme="dark" />
    </QueryClientProvider>
  );
}
