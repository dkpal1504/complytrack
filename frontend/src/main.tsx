import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";

import { App } from "@/app/App";
import { AppErrorBoundary } from "@/app/AppErrorBoundary";
import { ToastProvider } from "@/components/ui/Feedback";
import { AuthProvider } from "@/features/auth/AuthProvider";
import { queryClient } from "@/lib/query";
import "@/index.css";

/*
 * Apply the saved theme before the first paint.
 *
 * Reading the preference here rather than in a React effect is what stops a
 * dark-mode user seeing a white flash on every navigation.
 */
try {
  const saved = localStorage.getItem("complytrack.theme");
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  if (saved === "dark" || (!saved && prefersDark)) {
    document.documentElement.classList.add("dark");
  }
} catch {
  /* Storage blocked — the default light theme is used. */
}

const container = document.getElementById("root");
if (!container) throw new Error("The #root element is missing from index.html.");

createRoot(container).render(
  <StrictMode>
    <AppErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <AuthProvider>
            <ToastProvider>
              <App />
            </ToastProvider>
          </AuthProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </AppErrorBoundary>
  </StrictMode>,
);

/*
 * Register the service worker so the app installs to a home screen and keeps
 * working over a flaky yard network. Failures are swallowed: a browser that
 * blocks service workers must not break the app.
 */
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    void import("virtual:pwa-register")
      .then(({ registerSW }) => registerSW({ immediate: true }))
      .catch(() => undefined);
  });
}
