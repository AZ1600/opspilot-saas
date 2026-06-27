import { join } from "node:path";

export function getWritableDataDir() {
  if (process.env.OPSPILOT_FILE_STORAGE_DIR) {
    return process.env.OPSPILOT_FILE_STORAGE_DIR;
  }

  if (process.env.VERCEL) {
    return join("/tmp", "opspilot-data");
  }

  return join(process.cwd(), "data");
}
