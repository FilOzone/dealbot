import { Logger } from "@nestjs/common";
import { executeUpload } from "filecoin-pin";
import { toJsonSafe, toStructuredError } from "./logging.js";

export type FilecoinPinLogger = Parameters<typeof executeUpload>[3]["logger"];

export function createFilecoinPinLogger(logger: Logger): FilecoinPinLogger {
  const formatEntry = (payload: unknown, message?: string) => {
    const fallbackMessage = typeof payload === "string" && payload.length > 0 ? payload : "filecoin-pin event";
    const entry: Record<string, unknown> = {
      event: "filecoin_pin_log",
      message: message ?? fallbackMessage,
    };

    if (payload instanceof Error) {
      entry.error = toStructuredError(payload);
      return entry;
    }

    if (payload !== undefined && payload !== null && typeof payload !== "string") {
      entry.payload = toJsonSafe(payload);
    }

    return entry;
  };

  return {
    info: (payload: unknown, message?: string) => logger.log(formatEntry(payload, message)),
    warn: (payload: unknown, message?: string) => logger.warn(formatEntry(payload, message)),
    error: (payload: unknown, message?: string) => logger.error(formatEntry(payload, message)),
    debug: (payload: unknown, message?: string) => logger.debug(formatEntry(payload, message)),
  } as FilecoinPinLogger;
}
