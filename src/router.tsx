import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        // Serve cached data instantly on tab switches, refresh in background.
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: false,
        refetchOnMount: false,
        retry: 1,
      },
    },
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    // Preload route code + data on link hover/focus so clicks feel instant.
    defaultPreload: "intent",
    defaultPreloadDelay: 40,
    // Let TanStack Query own cache freshness.
    defaultPreloadStaleTime: 0,
    // Keep previously rendered route visible while the next one loads —
    // eliminates the flash of blank/pending UI when switching tabs.
    defaultPendingMs: 300,
    defaultPendingMinMs: 0,
  });

  return router;
};
