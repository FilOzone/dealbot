/**
 * Creates a promise that resolves after a specified amount of time (in milliseconds).
 * Useful for testing asynchronous code or creating delays.
 * @param ms - The amount of time to wait (in milliseconds).
 * @returns A promise that resolves after the specified amount of time.
 */
export const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
