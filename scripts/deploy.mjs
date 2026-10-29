// Copies the built plugin into a vault: OBSIDIAN_VAULT=/path/to/vault npm run deploy
import { copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const vault = process.env.OBSIDIAN_VAULT;
if (!vault) {
  console.error("Set OBSIDIAN_VAULT to the path of your vault, e.g. OBSIDIAN_VAULT=~/Documents/MyVault npm run deploy");
  process.exit(1);
}
const target = join(vault, ".obsidian/plugins/shelfmark");
mkdirSync(target, { recursive: true });
for (const f of ["main.js", "manifest.json", "styles.css"]) copyFileSync(f, join(target, f));
console.log(`Deployed to ${target}`);
