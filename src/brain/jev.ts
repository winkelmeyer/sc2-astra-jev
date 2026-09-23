import { experimental_evaluate } from "ai";
import type { Squad, SquadOrders } from "../army/types.ts";
import { JEV_MODEL } from "../config.ts";
import { type CallCost, callCost } from "../cost.ts";
import { Buff, Upgrade } from "../sc2/ids.ts";
import type { Point2, RawUnit } from "../sc2/types.ts";
import { centroid, distance } from "../state/geometry.ts";
import { hpFraction, type World } from "../state/world.ts";
import { averageHp, composition, gameClock } from "./summary.ts";

type BooleanQuestion = { type: "boolean"; instructions: string; criteria?: { true: string; false: string } };
type ChoiceQuestion = { type: "choice"; instructions: string; criteria: Record<string, string> };
export type JevQuestions = Record<string, BooleanQuestion | ChoiceQuestion>;

export interface JevAnswers {
	probabilities: Record<string, number>;
	focus?: string;
	cost: CallCost;
}

function describeOwn(world: World, unit: RawUnit, blinkReady: boolean): string {
	const parts = [
		world.ctx.name(unit.unitType),
		`hp ${Math.round(hpFraction(unit) * 100)}%`,
		`shield ${Math.round(unit.shield ?? 0)}/${Math.round(unit.shieldMax ?? 0)}`,
	];
	if ((unit.energyMax ?? 0) > 0) parts.push(`energy ${Math.round(unit.energy ?? 0)}`);
	parts.push((unit.weaponCooldown ?? 0) > 0 ? "weapon cooling down" : "weapon ready");
	if (blinkReady) parts.push("blink ready");
	if ((unit.buffIds ?? []).includes(Buff.GUARDIAN_SHIELD)) parts.push("under guardian shield");
	return parts.join(", ");
}

function enemyGroups(world: World, enemies: RawUnit[], from: Point2): string[] {
	const byType = new Map<number, RawUnit[]>();
	for (const e of enemies) byType.set(e.unitType, [...(byType.get(e.unitType) ?? []), e]);
	return [...byType.entries()].map(([type, list]) => {
		const nearest = Math.min(...list.map((e) => distance(e.pos, from)));
		return `${world.ctx.name(type)} x${list.length}, avg hp ${averageHp(list)}%, nearest ${nearest.toFixed(1)} away, range ${world.ctx.weaponRange(type).toFixed(1)}`;
	});
}

export function buildJevRequest(
	world: World,
	squad: Squad,
	orders: SquadOrders,
	allies: Squad[],
	blinkReady: Set<number>,
): { state: Record<string, string>; questions: JevQuestions; focusOptions: string[] } {
	const center = centroid(squad.units.map((u) => u.pos));
	const enemyCenter = centroid(squad.nearbyEnemies.map((e) => e.pos));
	const nearbyAllies = allies.filter((a) => a !== squad && a.units.length > 0 && distance(centroid(a.units.map((u) => u.pos)), center) < 15);
	const terrain = world.ctx.isHighGround(enemyCenter, center)
		? "the enemy holds higher ground than us (we cannot see up without vision)"
		: world.ctx.isHighGround(center, enemyCenter)
			? "we hold higher ground than the enemy"
			: "even ground";
	const state: Record<string, string> = {
		gameTime: gameClock(world.loop),
		squad: `${squad.id} (${squad.kind}, role ${orders.role}): ${squad.units.length} units, avg hp ${averageHp(squad.units)}%`,
		ownUnits: squad.units.map((u) => describeOwn(world, u, blinkReady.has(u.tag))).join("; "),
		enemiesInRange: enemyGroups(world, squad.nearbyEnemies, center).join("; "),
		alliesNearby:
			nearbyAllies.map((a) => `${a.id}: ${Object.entries(composition(world, a.units)).map(([n, c]) => `${c} ${n}`).join(", ")} at ${averageHp(a.units)}% hp`).join("; ") ||
			"none",
		terrain,
		distanceToObjective: `${distance(center, orders.target).toFixed(0)}`,
		plan: `${orders.objective}. Focus priority: ${orders.focusPriority.join(" > ") || "none given"}.`,
		currentStance: `${squad.decision.stance} for ${((world.loop - squad.decision.loop) / 22.4).toFixed(1)}s`,
	};

	const questions: JevQuestions = {
		engage: {
			type: "boolean",
			instructions: "Should this squad actively fight the enemies in range right now?",
			criteria: { true: orders.engageWhen, false: "Holding position or pulling back is the better move right now." },
		},
		retreat: {
			type: "boolean",
			instructions: "Should this squad disengage and fall back to the rally point right now?",
			criteria: { true: orders.retreatWhen, false: "Staying in the fight or holding ground is better." },
		},
	};

	const visibleTypes = [...new Set(squad.nearbyEnemies.map((e) => world.ctx.name(e.unitType)))];
	const ordered = [...orders.focusPriority.filter((t) => visibleTypes.includes(t)), ...visibleTypes.filter((t) => !orders.focusPriority.includes(t))];
	const focusOptions = ordered.slice(0, 6);
	if (focusOptions.length >= 2) {
		questions.focus = {
			type: "choice",
			instructions: "Which enemy unit type should this squad focus fire right now?",
			criteria: Object.fromEntries(focusOptions.map((t) => [t, `Focus the ${t}s`])),
		};
	}

	if (squad.kind === "stalker" && world.upgrades.has(Upgrade.BLINK)) {
		questions.blinkBack = {
			type: "boolean",
			instructions: "Should the stalkers with depleted shields blink backward right now to save them?",
			criteria: { true: "Some stalkers have no shields left and are being targeted; blinking them back keeps them alive.", false: "Shields are fine or blinking would strand units." },
		};
	}
	if (squad.kind === "sentry") {
		questions.forcefield = {
			type: "boolean",
			instructions: "Would casting a force field right now split the enemy army or cut off enemies that are chasing or charging us?",
			criteria: { true: "Enemy melee or a clumped enemy group is charging in, or we need to cover a retreat.", false: "Enemies are spread, far, or a force field would block our own units." },
		};
		questions.guardianShield = {
			type: "boolean",
			instructions: "Is Guardian Shield worth casting right now (reduces ranged damage for nearby allies)?",
			criteria: { true: "Enemy ranged attackers are shooting our clumped army.", false: "Few ranged enemies, or the shield is already up." },
		};
	}
	return { state, questions, focusOptions };
}

async function evaluate(state: Record<string, string>, questions: JevQuestions) {
	try {
		return await experimental_evaluate({ model: JEV_MODEL, state, questions });
	} catch (error) {
		const tiedChoice = String(error).includes('"focus" did not select a highest-probability option');
		if (!tiedChoice) throw error;
		const { focus: _tied, ...rest } = questions;
		return experimental_evaluate({ model: JEV_MODEL, state, questions: rest });
	}
}

export async function askJev(state: Record<string, string>, questions: JevQuestions): Promise<JevAnswers> {
	const result = await evaluate(state, questions);
	const probabilities: Record<string, number> = {};
	let focus: string | undefined;
	for (const [key, answer] of Object.entries(result.answers)) {
		if (answer.type === "boolean") probabilities[key] = answer.probability;
		if (answer.type === "choice") focus = String(answer.choice);
	}
	return { probabilities, focus, cost: callCost(result.usage, result.providerMetadata) };
}

if (process.argv.includes("--probe")) {
	const started = Date.now();
	const answers = await askJev(
		{
			gameTime: "7:52",
			squad: "stalkers-1 (stalker, role ranged): 6 units, avg hp 41%",
			ownUnits: "Stalker hp 20%, shield 0/80, weapon ready, blink ready; Stalker hp 65%, shield 30/80, weapon cooling down, blink ready",
			enemiesInRange: "Marine x12, avg hp 90%, nearest 4.1 away, range 5; Marauder x3, avg hp 100%, nearest 5.5 away, range 6",
			alliesNearby: "none",
			terrain: "even ground",
			distanceToObjective: "18",
			plan: "Poke the natural and pull back if bio stims in. Focus priority: Marauder > Marine.",
			currentStance: "engage for 3.0s",
		},
		{
			engage: { type: "boolean", instructions: "Should this squad actively fight the enemies in range right now?", criteria: { true: "We have at least as many units and more health.", false: "Holding or pulling back is better." } },
			retreat: { type: "boolean", instructions: "Should this squad disengage now?", criteria: { true: "Most stalkers below 40% health against a healthy bio army.", false: "Staying is better." } },
			focus: { type: "choice", instructions: "Which enemy type to focus?", criteria: { Marauder: "Focus the Marauders", Marine: "Focus the Marines" } },
			blinkBack: { type: "boolean", instructions: "Should stalkers with depleted shields blink back now?" },
		},
	);
	console.log(`jev ${Date.now() - started}ms`, JSON.stringify(answers));
}
