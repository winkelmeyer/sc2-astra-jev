import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { ASTRA_MODEL, JEV_MODEL } from "./config.ts";
import { type CallCost, CostMeter } from "./cost.ts";
import { DecisionFeed } from "./hud/feed.ts";

export class GameLog {
	readonly path: string;
	private readonly jevLatencies: number[] = [];
	private jevErrors = 0;
	private astraCalls = 0;
	private astraFailures = 0;
	readonly cost = new CostMeter();
	readonly feed = new DecisionFeed();

	constructor(dir = "logs") {
		mkdirSync(dir, { recursive: true });
		this.path = join(dir, `game-${new Date().toISOString().replace(/[:.]/g, "-")}.jsonl`);
	}

	write(event: Record<string, unknown>): void {
		appendFileSync(this.path, `${JSON.stringify({ at: Date.now(), ...event })}\n`);
	}

	jev(event: Record<string, unknown> & { latencyMs: number; cost: CallCost }): void {
		this.jevLatencies.push(event.latencyMs);
		this.cost.add(JEV_MODEL, event.cost);
		this.write({ type: "jev", ...event });
	}

	jevError(event: Record<string, unknown>): void {
		this.jevErrors++;
		this.write({ type: "jev_error", ...event });
		console.error(`[jev] error ${JSON.stringify(event)}`);
	}

	astra(event: Record<string, unknown> & { cost?: CallCost }, ok: boolean): void {
		this.astraCalls++;
		if (event.cost) this.cost.add(ASTRA_MODEL, event.cost);
		if (!ok) this.astraFailures++;
		this.write({ type: ok ? "astra" : "astra_error", ...event });
	}

	summary(): Record<string, unknown> {
		const sorted = [...this.jevLatencies].sort((a, b) => a - b);
		const pct = (p: number) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : null);
		return {
			jevCalls: sorted.length,
			jevErrors: this.jevErrors,
			jevP50Ms: pct(0.5),
			jevP95Ms: pct(0.95),
			astraCalls: this.astraCalls,
			astraFailures: this.astraFailures,
			...this.cost.snapshot(),
		};
	}
}
