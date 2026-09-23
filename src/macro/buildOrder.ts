import type { Sc2Client } from "../sc2/client.ts";
import { Ability, Unit, Upgrade } from "../sc2/ids.ts";
import type { Command, Point2 } from "../sc2/types.ts";
import type { GameContext } from "../state/context.ts";
import { distance, towards } from "../state/geometry.ts";
import { isIdle, type World } from "../state/world.ts";
import { Budget } from "./budget.ts";
import { build, chronoboost, distributeWorkers, freeGeyser, trainProbes } from "./economy.ts";
import { Placer } from "./placement.ts";
import { produceArmy } from "./production.ts";

interface StructureStep {
	unitType: number;
	ability: number;
	want: (w: World) => number;
	ready: (w: World) => boolean;
}

const gates = (w: World) => w.count(Unit.GATEWAY) + w.all(Unit.WARPGATE).length;
const bases = (w: World) => w.count(Unit.NEXUS);
const has = (w: World, type: number) => w.ready(type).length > 0;

const STEPS: StructureStep[] = [
	{ unitType: Unit.GATEWAY, ability: Ability.BUILD_GATEWAY, want: () => 1, ready: (w) => has(w, Unit.PYLON) },
	{ unitType: Unit.ASSIMILATOR, ability: Ability.BUILD_ASSIMILATOR, want: (w) => (w.supplyUsed >= 17 ? 2 : 1), ready: (w) => gates(w) >= 1 },
	{ unitType: Unit.NEXUS, ability: Ability.BUILD_NEXUS, want: () => 2, ready: (w) => w.supplyUsed >= 19 },
	{ unitType: Unit.CYBERNETICSCORE, ability: Ability.BUILD_CYBERNETICSCORE, want: () => 1, ready: (w) => has(w, Unit.GATEWAY) || w.all(Unit.WARPGATE).length > 0 },
	{ unitType: Unit.GATEWAY, ability: Ability.BUILD_GATEWAY, want: () => 2, ready: (w) => bases(w) >= 2 && w.count(Unit.CYBERNETICSCORE) >= 1 },
	{ unitType: Unit.ROBOTICSFACILITY, ability: Ability.BUILD_ROBOTICSFACILITY, want: () => 1, ready: (w) => has(w, Unit.CYBERNETICSCORE) && bases(w) >= 2 },
	{ unitType: Unit.ASSIMILATOR, ability: Ability.BUILD_ASSIMILATOR, want: () => 4, ready: (w) => w.ready(Unit.NEXUS).length >= 2 && w.supplyUsed >= 36 },
	{ unitType: Unit.TWILIGHTCOUNCIL, ability: Ability.BUILD_TWILIGHTCOUNCIL, want: () => 1, ready: (w) => w.supplyUsed >= 44 && w.count(Unit.ROBOTICSFACILITY) >= 1 },
	{ unitType: Unit.GATEWAY, ability: Ability.BUILD_GATEWAY, want: () => 4, ready: (w) => w.supplyUsed >= 48 },
	{ unitType: Unit.FORGE, ability: Ability.BUILD_FORGE, want: () => 1, ready: (w) => w.supplyUsed >= 52 },
	{ unitType: Unit.NEXUS, ability: Ability.BUILD_NEXUS, want: () => 3, ready: (w) => w.seconds >= 330 },
	{ unitType: Unit.ASSIMILATOR, ability: Ability.BUILD_ASSIMILATOR, want: () => 6, ready: (w) => w.ready(Unit.NEXUS).length >= 3 },
	{ unitType: Unit.GATEWAY, ability: Ability.BUILD_GATEWAY, want: () => 8, ready: (w) => w.ready(Unit.NEXUS).length >= 3 },
	{ unitType: Unit.NEXUS, ability: Ability.BUILD_NEXUS, want: () => 4, ready: (w) => w.seconds >= 600 && w.minerals > 500 },
	{ unitType: Unit.GATEWAY, ability: Ability.BUILD_GATEWAY, want: () => 12, ready: (w) => w.ready(Unit.NEXUS).length >= 4 },
];

interface Research { building: number; ability: number; upgrade: number; ready: (w: World) => boolean }

const RESEARCH: Research[] = [
	{ building: Unit.CYBERNETICSCORE, ability: Ability.RESEARCH_WARPGATE, upgrade: Upgrade.WARPGATE, ready: () => true },
	{ building: Unit.TWILIGHTCOUNCIL, ability: Ability.RESEARCH_BLINK, upgrade: Upgrade.BLINK, ready: () => true },
	{ building: Unit.FORGE, ability: Ability.RESEARCH_GROUND_WEAPONS_1, upgrade: Upgrade.GROUND_WEAPONS_1, ready: () => true },
	{ building: Unit.FORGE, ability: Ability.RESEARCH_GROUND_ARMOR_1, upgrade: Upgrade.GROUND_ARMOR_1, ready: (w) => w.upgrades.has(Upgrade.GROUND_WEAPONS_1) },
	{ building: Unit.FORGE, ability: Ability.RESEARCH_GROUND_WEAPONS_2, upgrade: Upgrade.GROUND_WEAPONS_2, ready: (w) => has(w, Unit.TWILIGHTCOUNCIL) && w.upgrades.has(Upgrade.GROUND_WEAPONS_1) },
];

const RESEARCH_COSTS: Record<number, [number, number]> = {
	[Ability.RESEARCH_WARPGATE]: [50, 50],
	[Ability.RESEARCH_BLINK]: [150, 150],
	[Ability.RESEARCH_GROUND_WEAPONS_1]: [100, 100],
	[Ability.RESEARCH_GROUND_ARMOR_1]: [100, 100],
	[Ability.RESEARCH_GROUND_WEAPONS_2]: [150, 150],
};

export class Macro {
	private readonly placer: Placer;

	constructor(
		private readonly client: Sc2Client,
		private readonly ctx: GameContext,
	) {
		this.placer = new Placer(client, ctx);
	}

	async tick(world: World, rally: Point2): Promise<Command[]> {
		const budget = new Budget(this.ctx, world);
		const commands: Command[] = [...distributeWorkers(world), ...chronoboost(world)];
		commands.push(...(await this.supply(world, budget)));
		commands.push(...this.research(world, budget));
		commands.push(...(await this.structures(world, budget)));
		commands.push(...trainProbes(world, budget));
		commands.push(...(await produceArmy(this.client, this.placer, world, budget, rally)));
		return commands;
	}

	private async supply(world: World, budget: Budget): Promise<Command[]> {
		const pylons = world.count(Unit.PYLON);
		const pending = pylons - world.ready(Unit.PYLON).length;
		const production = world.ready(Unit.NEXUS).length + gates(world) + world.count(Unit.ROBOTICSFACILITY) * 2;
		const needed =
			(pylons === 0 && world.supplyUsed >= 14) ||
			(pylons > 0 && world.supplyLeft < 2 + production * 2 && pending < (world.supplyCap >= 100 ? 3 : 1) && world.supplyCap + pending * 8 < 200);
		if (!needed) return [];
		if (!budget.canAfford(Unit.PYLON)) {
			budget.reserve(Unit.PYLON);
			return [];
		}
		const nexuses = world.ready(Unit.NEXUS);
		const base = pylons === 0 || nexuses.length === 1 ? this.ctx.myStart : nexuses[pylons % nexuses.length].pos;
		const spot = await this.placer.pylonSpot(world, base);
		if (!spot) return [];
		budget.spend(Unit.PYLON);
		return build(world, Ability.BUILD_PYLON, spot);
	}

	private research(world: World, budget: Budget): Command[] {
		const commands: Command[] = [];
		for (const r of RESEARCH) {
			if (world.upgrades.has(r.upgrade) || world.ordersFor(r.ability) > 0 || !r.ready(world)) continue;
			const building = world.ready(r.building).find(isIdle);
			if (!building) continue;
			const [minerals, gas] = RESEARCH_COSTS[r.ability];
			if (!budget.canAffordRaw(minerals, gas)) {
				budget.spendRaw(minerals, gas);
				continue;
			}
			budget.spendRaw(minerals, gas);
			commands.push({ abilityId: r.ability, unitTags: [building.tag] });
		}
		return commands;
	}

	private async structures(world: World, budget: Budget): Promise<Command[]> {
		for (const step of STEPS) {
			const current = step.unitType === Unit.GATEWAY ? gates(world) : world.count(step.unitType);
			if (current >= step.want(world) || !step.ready(world)) continue;
			if (!budget.canAfford(step.unitType)) {
				budget.reserve(step.unitType);
				return [];
			}
			const commands = await this.place(world, step);
			if (commands.length > 0) budget.spend(step.unitType);
			return commands;
		}
		return [];
	}

	private async place(world: World, step: StructureStep): Promise<Command[]> {
		if (step.unitType === Unit.ASSIMILATOR) {
			const geyser = freeGeyser(world);
			return geyser ? build(world, Ability.BUILD_ASSIMILATOR, geyser.pos, geyser.tag) : [];
		}
		if (step.unitType === Unit.NEXUS) {
			const taken = [...world.nexuses.map((n) => n.pos), ...Array.from(world.memory.structures.values(), (s) => s.pos)];
			const next = this.ctx.expansions.find((e) => !taken.some((t) => distance(t, e.pos) < 8));
			if (!next) return [];
			const [ok] = await this.client.placements(Ability.BUILD_NEXUS, [next.pos]);
			return ok ? build(world, Ability.BUILD_NEXUS, next.pos) : [];
		}
		const near = world.ready(Unit.NEXUS).length >= 2 && step.unitType === Unit.GATEWAY && gates(world) >= 4
			? towards(this.ctx.natural.pos, this.ctx.mapCenter, 4)
			: this.ctx.myStart;
		const spot = await this.placer.buildingSpot(world, step.ability, near);
		return spot ? build(world, step.ability, spot) : [];
	}
}
