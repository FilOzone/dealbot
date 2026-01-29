import { Logger } from "@nestjs/common";
import { executeUpload } from "filecoin-pin";

export type FilecoinPinLogger = Parameters<typeof executeUpload>[3]["logger"];

export function appendPayload(message: string, payload: unknown): string {
  if (payload === undefined || payload === null) {
    return message;
  }

  let serialized: string;
  if (payload instanceof Error) {
    serialized = payload.stack ?? payload.message;
  } else {
    try {
      serialized = JSON.stringify(payload, (_key, value) => (typeof value === "bigint" ? value.toString() : value));
    } catch {
      serialized = String(payload);
    }
  }

  if (!message) {
    return serialized;
  }

  return `${message} ${serialized}`;
}

export function createFilecoinPinLogger(logger: Logger): FilecoinPinLogger {
  const formatMessage = (payload: unknown, message?: string): string => {
    if (message) {
      return appendPayload(message, payload);
    }
    if (typeof payload === "string") {
      return payload;
    }
    return appendPayload("", payload);
  };

  return {
    info: (payload: unknown, message?: string) => logger.log(formatMessage(payload, message)),
    warn: (payload: unknown, message?: string) => logger.warn(formatMessage(payload, message)),
    error: (payload: unknown, message?: string) => logger.error(formatMessage(payload, message)),
    debug: (payload: unknown, message?: string) => logger.debug(formatMessage(payload, message)),
  } as FilecoinPinLogger;
}
