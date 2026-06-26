import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { SWRConfig } from "swr";
import { ThemeProvider } from "@/components/shared";
import App from "./App";
import "./index.css";

const container = document.getElementById("root");
if (container) {
  createRoot(container).render(
    <React.StrictMode>
      <SWRConfig value={{ revalidateOnFocus: false, shouldRetryOnError: false }}>
        <ThemeProvider>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </ThemeProvider>
      </SWRConfig>
    </React.StrictMode>,
  );
}
