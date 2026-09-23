import type { Sc2Client } from "../sc2/client.ts";
import { Ability, Unit, Upgrade } from "../sc2/ids.ts";
import type { Command, Point2 } from "../sc2/types.ts";
import { closest } from "../state/geometry.ts";
import { isIdle, type World } from "../state/world.ts";
import type { Budget } from "./budget.ts";
import type { Placer } from "./placement.ts";

const MAX_IMMORTALS = 6;

function sentryTarget(world: World): number {
	return world.seconds < 300 ? 1 : 3;
}

function gatewayUnit(world: World, budget: Budget): number | undefined {
	if (world.count(Unit.SENTRY) < sentryTarget(world) && budget.canAfford(Unit.SENTRY)) return Unit.SENTRY;
	if (budget.canAfford(Unit.STALKER)) return Unit.STALKER;
	if (budget.gas < 50 && budget.minerals >= 300 && budget.canAfford(Unit.ZEALOT)) return Unit.ZEALOT;
	return undefined;
}

const TRAIN: Record<number, number> = { [Unit.STALKER]: Ability.TRAIN_STALKER, [Unit.SENTRY]: Ability.TRAIN_SENTRY, [Unit.ZEALOT]: Ability.TRAIN_ZEALOT };
const WARP: Record<number, number> = { [Unit.STALKER]: Ability.WARP_STALKER, [Unit.SENTRY]: Ability.WARP_SENTRY, [Unit.ZEALOT]: Ability.WARP_ZEALOT };

export async function produceArmy(client: Sc2Client, placer: Placer, world: World, budget: Budget, rally: Point2): Promise<Command[]> {
	const commands: Command[] = [];

	for (const robo of world.ready(Unit.ROBOTICSFACILITY).filter(isIdle)) {
		const observers = world.count(Unit.OBSERVER) + world.all(Unit.OBSERVERSIEGEMODE).length;
		const wanted = observers < 1 ? Unit.OBSERVER : world.count(Unit.IMMORTAL) < MAX_IMMORTALS ? Unit.IMMORTAL : undefined;
		if (wanted === undefined || !budget.canAfford(wanted)) continue;
		budget.spend(wanted);
		commands.push({ abilityId: wanted === Unit.OBSERVER ? Ability.TRAIN_OBSERVER : Ability.TRAIN_IMMORTAL, unitTags: [robo.tag] });
	}

	const warpgateDone = world.upgrades.has(Upgrade.WARPGATE);
	for (const gateway of world.ready(Unit.GATEWAY).filter(isIdle)) {
		if (warpgateDone) {
			commands.push({ abilityId: Ability.MORPH_WARPGATE, unitTags: [gateway.tag] });
			continue;
		}
		const unit = gatewayUnit(world, budget);
		if (unit === undefined) break;
		budget.spend(unit);
		commands.push({ abilityId: TRAIN[unit], unitTags: [gateway.tag] });
	}

	const warpgates = world.ready(Unit.WARPGATE);
	if (warpgates.length === 0) return commands;
	const available = await client.availableAbilities(warpgates.map((w) => w.tag));
	const ready = warpgates.filter((w) => available.get(w.tag)?.has(Ability.WARP_STALKER));
	const readyPylons = new Set(world.ready(Unit.PYLON).map((p) => p.tag));
	const pylon = closest(world.powerSources.filter((p) => readyPylons.has(p.tag)), rally);
	if (ready.length === 0 || !pylon) return commands;
	const spots = await placer.warpSpots(Ability.WARP_STALKER, pylon.pos, ready.length);
	ready.forEach((gate, i) => {
		const spot = spots[i];
		const unit = spot ? gatewayUnit(world, budget) : undefined;
		if (!spot || unit === undefined) return;
		budget.spend(unit);
		commands.push({ abilityId: WARP[unit], unitTags: [gate.tag], targetWorldSpacePos: spot });
	});
	return commands;
}
