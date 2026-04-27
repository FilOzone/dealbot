declare const process: {
  env: {
    NODE_ENV?: string;
  };
};

declare global {
  // React Testing Library checks this flag to decide whether to warn about act()
  // usage outside a testing environment.
  interface GlobalThis {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  }
}

if (process.env.NODE_ENV !== "test") {
  process.env.NODE_ENV = "test";
}

const globalWithAct = globalThis as GlobalThis;

if (!globalWithAct.IS_REACT_ACT_ENVIRONMENT) {
  globalWithAct.IS_REACT_ACT_ENVIRONMENT = true;
}

if (typeof window !== "undefined") {
  window.__DEALBOT_CONFIG__ = {
    API_BASE_URL: "",
  };
}

export {};
