// Cross-platform copy of the built client into server/public
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const src = path.join(root, "client", "dist");
const dest = path.join(root, "server", "public");

if (!fs.existsSync(src)) {
  console.error("Build not found at", src, "- run the client build first.");
  process.exit(1);
}
fs.rmSync(dest, { recursive: true, force: true });
fs.cpSync(src, dest, { recursive: true });
console.log("Copied client build ->", dest);
