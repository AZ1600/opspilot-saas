import { getRuntimeConfigReport } from "../lib/server/config.ts";

const report = getRuntimeConfigReport();

console.log(JSON.stringify(report, null, 2));

if (!report.ok) {
  process.exitCode = 1;
}
