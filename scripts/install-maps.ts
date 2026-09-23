import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SC2_ROOT } from "../src/config.ts";

const PACK = "Ladder2019Season3";
const url = `http://blzdistsc2-a.akamaihd.net/MapPacks/${PACK}.zip`;
const mapsDir = join(SC2_ROOT, "Maps");
const target = join(mapsDir, PACK, "AcropolisLE.SC2Map");

if (existsSync(target)) {
	console.log(`already installed: ${target}`);
	process.exit(0);
}

mkdirSync(mapsDir, { recursive: true });
console.log(`downloading ${url}`);
const response = await fetch(url);
if (!response.ok) throw new Error(`map pack download failed: ${response.status}`);
const zipPath = join(tmpdir(), `${PACK}.zip`);
writeFileSync(zipPath, Buffer.from(await response.arrayBuffer()));
execFileSync("unzip", ["-o", "-P", "iagreetotheeula", zipPath, "-d", mapsDir], { stdio: "inherit" });
if (!existsSync(target)) throw new Error(`expected ${target} after extraction`);
console.log(`installed: ${target}`);
