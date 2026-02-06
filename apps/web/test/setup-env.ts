declare const process: {
  env: {
    NODE_ENV?: string;
  };
};

declare global {
  // React Testing Library checks this flag to decide whether to warn about act()
  // usage outside a testing environment.
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

if (process.env.NODE_ENV !== "test") {
  process.env.NODE_ENV = "test";
}

if (!globalThis.IS_REACT_ACT_ENVIRONMENT) {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
}

export {};
