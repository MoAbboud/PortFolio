/**
 * Tiny logger. Info/warn are silenced in production builds; errors always log.
 * Never log secrets or tokens — log identifiers instead.
 */
const dev = typeof __DEV__ !== "undefined" && __DEV__;

export const logger = {
  info: (...args: unknown[]): void => {
    if (dev) console.log("[wyg]", ...args);
  },
  warn: (...args: unknown[]): void => {
    if (dev) console.warn("[wyg]", ...args);
  },
  error: (...args: unknown[]): void => {
    console.error("[wyg]", ...args);
  },
};
