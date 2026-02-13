import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "./index.css";
import { ThemeProvider } from "@/components/shared";

async function enableMocking() {
  if (import.meta.env.VITE_ENABLE_MOCKING !== "true") {
    return;
  }

  const { worker } = await import("../test/mocks/browser");

  return worker.start({
    onUnhandledRequest: "bypass",
  });
}

enableMocking().then(() => {
  const container = document.getElementById("root");
  if (container) {
    createRoot(container).render(
      <React.StrictMode>
        <ThemeProvider>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </ThemeProvider>
      </React.StrictMode>,
    );
  }
});
