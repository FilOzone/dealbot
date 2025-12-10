import { join } from "node:path";

/**
 * Version file path constant
 * Single source of truth for version.json location
 */
export const VERSION_FILE_PATH = join(process.cwd(), "dist", "version.json");
