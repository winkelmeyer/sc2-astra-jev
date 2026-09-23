import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CostMeter } from "../src/cost.ts";

const dir = "logs";
const all = new CostMeter();
const rows: string[] = [];
for (const file of readdirSync(dir).filter((f) => f.endsWith(".jsonl")).sort()) {
	const game = new CostMeter();
	let result = "running/aborted";
	let gameTime = "";
	for (const line of readFileSync(join(dir, file), "utf8").split("\n")) {
		if (!line) continue;
		const event = JSON.parse(line) as { type: string; cost?: { inputTokens: number; outputTokens: number; cost: number; marketCost: number }; result?: string; gameTime?: string };
		if (event.cost && (event.type === "jev" || event.type === "astra")) {
			const model = event.type === "jev" ? "typesafe-ai/jev" : "openai/gpt-6-astra";
			game.add(model, event.cost);
			all.add(model, event.cost);
		}
		if (event.type === "end") {
			result = event.result ?? result;
			gameTime = event.gameTime ?? "";
		}
	}
	if (game.marketTotal > 0) rows.push(`${file}  ${result.padEnd(9)} ${gameTime.padStart(5)}  $${game.total.toFixed(4)} (market $${game.marketTotal.toFixed(4)})`);
}
console.log(rows.join("\n") || "no games with cost data yet");
console.log(JSON.stringify(all.snapshot(), null, 2));
