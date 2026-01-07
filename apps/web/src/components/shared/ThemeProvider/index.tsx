import { ThemeProvider as NextThemesProvider } from "next-themes";
import type * as React from "react";

function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider attribute="class" defaultTheme="light">
      {children}
    </NextThemesProvider>
  );
}

export default ThemeProvider;
