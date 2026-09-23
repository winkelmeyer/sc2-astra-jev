import { generateText, Output } from "ai";
import { z } from "zod";
import { ASTRA_MODEL, ASTRA_TIMEOUT_MS } from "../config.ts";
import { type CallCost, callCost } from "../cost.ts";

const PointSchema = z.object({ x: z.number(), y: z.number() });

export const EngagementPlanSchema = z.object({
	intent: z.enum(["attack", "defend", "poke", "retreat"]),
	summary: z.string().describe("One sentence: what the army does in this engagement and why."),
	target: PointSchema,
	rally: PointSchema.describe("Where squads fall back to when they retreat."),
	squads: z.array(
		z.object({
			squadId: z.string(),
			role: z.enum(["frontline", "ranged", "flank", "support", "harass"]),
			target: PointSchema,
			objective: z.string(),
			focusPriority: z.array(z.string()).describe("Enemy unit type names, most important first, e.g. ['SiegeTank','Marauder','Marine']."),
			engageWhen: z.string().describe("Concrete, locally observable condition under which this squad should fight."),
			retreatWhen: z.string().describe("Concrete, locally observable condition under which this squad should disengage."),
		}),
	),
	abortWhen: z.string(),
});

export type EngagementPlan = z.infer<typeof EngagementPlanSchema>;

const SYSTEM = `You are Astra, the strategic commander of a Protoss army in a StarCraft II game against the built-in computer AI.
You are called rarely: once when an engagement starts or the situation changes. You write the plan; you do not control units directly.
Every squad and key unit is run by a fast tactical agent (Jev) that re-decides about twice per second. Jev only sees its own units, the enemies within about 13 range, and the text you write for its squad. Each tick Jev answers: engage now? retreat now? which enemy type to focus? (plus blink, force field, guardian shield for the units that have them).
So write engageWhen and retreatWhen as conditions Jev can check from local state: unit counts, health percentages, enemy types present, whether the enemy is in range. Avoid global conditions Jev cannot see.
Use coordinates from the provided map data; every target must be a real point on the map. Give every squad in mySquads an entry, using its exact squadId.
Unit type names use SC2 internal names (Marine, Marauder, SiegeTank, SiegeTankSieged, Zergling, Roach, Hydralisk, Baneling, Stalker, Immortal, Colossus, etc).`;

export async function planEngagement(summary: Record<string, unknown>): Promise<{ plan: EngagementPlan; latencyMs: number; cost: CallCost }> {
	const started = Date.now();
	const { output, usage, providerMetadata } = await generateText({
		model: ASTRA_MODEL,
		system: SYSTEM,
		prompt: `Battlefield state:\n${JSON.stringify(summary, null, 1)}\n\nWrite the engagement plan.`,
		output: Output.object({ schema: EngagementPlanSchema }),
		abortSignal: AbortSignal.timeout(ASTRA_TIMEOUT_MS),
		maxRetries: 1,
	});
	return { plan: output, latencyMs: Date.now() - started, cost: callCost(usage, providerMetadata) };
}

if (process.argv.includes("--probe")) {
	const { plan, latencyMs, cost } = await planEngagement({
		trigger: "army ready to attack",
		gameTime: "7:40",
		economy: { minerals: 420, gas: 180, supply: "112/134", armySupply: 62 },
		upgrades: { blink: true, groundWeapons: 1 },
		mySquads: [
			{ squadId: "stalkers-1", kind: "stalker", units: { Stalker: 8 }, avgHpPercent: 100, center: { x: 120, y: 60 } },
			{ squadId: "immortals", kind: "immortal", units: { Immortal: 3 }, avgHpPercent: 100, center: { x: 118, y: 58 } },
			{ squadId: "sentry-2", kind: "sentry", units: { Sentry: 1 }, avgHpPercent: 100, center: { x: 119, y: 59 } },
		],
		visibleEnemyArmy: [{ center: { x: 60, y: 130 }, units: { Marine: 14, Marauder: 4, SiegeTankSieged: 2 }, avgHpPercent: 100 }],
		knownEnemyTownhalls: [{ x: 33.5, y: 138.5 }, { x: 57.5, y: 121.5 }],
		map: { myMain: { x: 142.5, y: 33.5 }, enemyMain: { x: 33.5, y: 138.5 }, enemyNatural: { x: 57.5, y: 121.5 }, center: { x: 88, y: 86 } },
	});
	console.log(`astra ${latencyMs}ms $${cost.cost.toFixed(4)} (${cost.inputTokens} in / ${cost.outputTokens} out)`);
	console.log(JSON.stringify(plan, null, 2));
}
