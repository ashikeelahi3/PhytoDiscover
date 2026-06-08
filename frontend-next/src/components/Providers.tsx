"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { ThemeProvider } from "next-themes";
import { SessionProvider } from "@/contexts/SessionContext";
import { CompoundSelectionProvider } from "@/contexts/CompoundSelectionContext";
import { ToastProvider } from "@/components/ui/Toast";

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 30_000, retry: 1 },
        },
      })
  );

  return (
    <ThemeProvider attribute="class" defaultTheme="dark" disableTransitionOnChange>
      <QueryClientProvider client={queryClient}>
        <SessionProvider>
          <CompoundSelectionProvider>
            <ToastProvider>{children}</ToastProvider>
          </CompoundSelectionProvider>
        </SessionProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
