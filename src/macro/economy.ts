import { Ability, Buff, Unit } from "../sc2/ids.ts";
import type { Command, RawUnit } from "../sc2/types.ts";
import { closest, distance, within } from "../state/geometry.ts";
import { isIdle, type World } from "../state/world.ts";
import type { Budget } from "./budget.ts";

const MAX_PROBES = 70;
const GATHER_ABILITIES = new Set([Ability.HARVEST_GATHER, Ability.HARVEST_RETURN, 298, 299]);

export function trainProbes(world: World, budget: Budget): Command[] {
	const commands: Command[] = [];
	const target = Math.min(MAX_PROBES, world.ready(Unit.NEXUS).length * 22 + 2);
	let probes = world.count(Unit.PROBE);
	for (const nexus of world.ready(Unit.NEXUS)) {
		if (probes >= target || !isIdle(nexus) || !budget.canAfford(Unit.PROBE)) continue;
		budget.spend(Unit.PROBE);
		probes++;
		commands.push({ abilityId: Ability.TRAIN_PROBE, unitTags: [nexus.tag] });
	}
	return commands;
}

export function isGathering(probe: RawUnit): boolean {
	const order = probe.orders?.[0];
	return order === undefined ? false : GATHER_ABILITIES.has(order.abilityId);
}

export function pickBuilder(world: World, target: { x: number; y: number }): RawUnit | undefined {
	const candidates = world.probes.filter(
		(p) => isGathering(p) && p.orders?.[0]?.abilityId !== Ability.HARVEST_RETURN && p.orders?.[0]?.abilityId !== 299,
	);
	return closest(candidates.length > 0 ? candidates : world.probes.filter(isIdle), target);
}

export function build(world: World, abilityId: number, pos: { x: number; y: number }, targetUnitTag?: number): Command[] {
	const builder = pickBuilder(world, pos);
	if (!builder) return [];
	const mineral = closest(world.mineralFields, builder.pos);
	const commands: Command[] = [
		targetUnitTag === undefined
			? { abilityId, unitTags: [builder.tag], targetWorldSpacePos: pos }
			: { abilityId, unitTags: [builder.tag], targetUnitTag },
	];
	if (mineral) commands.push({ abilityId: Ability.HARVEST_GATHER, unitTags: [builder.tag], targetUnitTag: mineral.tag, queueCommand: true });
	return commands;
}

export function distributeWorkers(world: World): Command[] {
	const commands: Command[] = [];
	const nexuses = world.ready(Unit.NEXUS);
	if (nexuses.length === 0) return commands;
	const gasNeeds = world
		.ready(Unit.ASSIMILATOR)
		.concat(world.ready(Unit.ASSIMILATORRICH))
		.filter((a) => (a.vespeneContents ?? 0) > 0 && (a.assignedHarvesters ?? 0) < (a.idealHarvesters ?? 3));
	const mineralNeeds = nexuses.filter((n) => (n.assignedHarvesters ?? 0) < (n.idealHarvesters ?? 0));
	const oversaturated = nexuses.filter((n) => (n.assignedHarvesters ?? 0) > (n.idealHarvesters ?? 0) + 1);

	const movable = world.probes.filter(isIdle);
	for (const nexus of oversaturated) {
		const extra = (nexus.assignedHarvesters ?? 0) - (nexus.idealHarvesters ?? 0);
		movable.push(...within(world.probes.filter(isGathering), nexus.pos, 10).slice(0, extra));
	}

	for (const probe of movable) {
		const gas = gasNeeds.find((a) => (a.assignedHarvesters ?? 0) < (a.idealHarvesters ?? 3));
		if (gas && world.minerals > 100) {
			gas.assignedHarvesters = (gas.assignedHarvesters ?? 0) + 1;
			commands.push({ abilityId: Ability.HARVEST_GATHER, unitTags: [probe.tag], targetUnitTag: gas.tag });
			continue;
		}
		const base = mineralNeeds.find((n) => (n.assignedHarvesters ?? 0) < (n.idealHarvesters ?? 0)) ?? closest(nexuses, probe.pos);
		if (!base) continue;
		base.assignedHarvesters = (base.assignedHarvesters ?? 0) + 1;
		const mineral = closest(within(world.mineralFields, base.pos, 10), base.pos);
		if (mineral) commands.push({ abilityId: Ability.HARVEST_GATHER, unitTags: [probe.tag], targetUnitTag: mineral.tag });
	}
	return commands;
}

export function chronoboost(world: World): Command[] {
	const commands: Command[] = [];
	const busy = (u: RawUnit) => (u.orders ?? []).length > 0 && (u.buffIds ?? []).every((b) => b !== Buff.CHRONOBOOST);
	const priorities = [
		...world.ready(Unit.CYBERNETICSCORE),
		...world.ready(Unit.TWILIGHTCOUNCIL),
		...world.ready(Unit.FORGE),
		...world.ready(Unit.ROBOTICSFACILITY),
		...world.ready(Unit.GATEWAY),
		...world.ready(Unit.NEXUS),
	].filter(busy);
	for (const nexus of world.ready(Unit.NEXUS)) {
		if ((nexus.energy ?? 0) < 50) continue;
		const target = priorities.shift();
		if (!target) break;
		commands.push({ abilityId: Ability.CHRONOBOOST, unitTags: [nexus.tag], targetUnitTag: target.tag });
	}
	return commands;
}

export function freeGeyser(world: World): RawUnit | undefined {
	const taken = [...world.all(Unit.ASSIMILATOR), ...world.all(Unit.ASSIMILATORRICH)];
	const pending = world.probes.flatMap((p) => (p.orders ?? []).filter((o) => o.abilityId === Ability.BUILD_ASSIMILATOR));
	return world.ready(Unit.NEXUS)
		.flatMap((n) => within(world.geysers, n.pos, 10))
		.find(
			(g) =>
				(g.vespeneContents ?? 0) > 0 &&
				!taken.some((a) => distance(a.pos, g.pos) < 1) &&
				!pending.some((o) => o.targetUnitTag === g.tag),
		);
}
