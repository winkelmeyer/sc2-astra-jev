import { ARMY_TYPES, Alliance, Unit } from "../sc2/ids.ts";
import type { Observation, Point2, PowerSource, RawUnit } from "../sc2/types.ts";
import type { GameContext } from "./context.ts";
import { distance } from "./geometry.ts";

const WORKER_TYPES = new Set([45, 104, 84, 268]);
const HARMLESS_TYPES = new Set([151, 103, 106, 129, 82, 1911, 8, 150, 113]);
const THREAT_STRUCTURE_TYPES = new Set([66, 24, 98, 99, 23, 130, 1910, 139]);

export interface RememberedStructure { tag: number; unitType: number; pos: Point2 }

export class EnemyMemory {
	readonly structures = new Map<number, RememberedStructure>();

	update(ctx: GameContext, observation: Observation, own: RawUnit[]): void {
		for (const tag of observation.rawData.event?.deadUnits ?? []) this.structures.delete(tag);
		const visible = new Set<number>();
		for (const unit of observation.rawData.units ?? []) {
			if (unit.alliance !== Alliance.Enemy || !ctx.isStructure(unit.unitType)) continue;
			visible.add(unit.tag);
			this.structures.set(unit.tag, { tag: unit.tag, unitType: unit.unitType, pos: unit.pos });
		}
		for (const remembered of this.structures.values()) {
			if (visible.has(remembered.tag)) continue;
			if (own.some((u) => distance(u.pos, remembered.pos) < 4)) this.structures.delete(remembered.tag);
		}
	}
}

export class World {
	readonly loop: number;
	readonly minerals: number;
	readonly gas: number;
	readonly supplyUsed: number;
	readonly supplyCap: number;
	readonly armySupply: number;
	readonly own: RawUnit[];
	readonly enemies: RawUnit[];
	readonly mineralFields: RawUnit[];
	readonly geysers: RawUnit[];
	readonly upgrades: Set<number>;
	readonly powerSources: PowerSource[];
	private readonly byType = new Map<number, RawUnit[]>();

	constructor(
		readonly ctx: GameContext,
		readonly observation: Observation,
		readonly memory: EnemyMemory,
	) {
		const common = observation.playerCommon;
		this.loop = observation.gameLoop;
		this.minerals = common.minerals ?? 0;
		this.gas = common.vespene ?? 0;
		this.supplyUsed = common.foodUsed ?? 0;
		this.supplyCap = common.foodCap ?? 0;
		this.armySupply = common.foodArmy ?? 0;
		const units = observation.rawData.units ?? [];
		this.own = units.filter((u) => u.alliance === Alliance.Self);
		this.enemies = units.filter((u) => u.alliance === Alliance.Enemy && !u.isHallucination && u.displayType !== 2);
		this.mineralFields = units.filter((u) => u.alliance === Alliance.Neutral && ctx.isMineral(u.unitType));
		this.geysers = units.filter((u) => u.alliance === Alliance.Neutral && ctx.isGeyser(u.unitType));
		this.upgrades = new Set(observation.rawData.player.upgradeIds ?? []);
		this.powerSources = observation.rawData.player.powerSources ?? [];
		for (const unit of this.own) {
			const list = this.byType.get(unit.unitType) ?? [];
			list.push(unit);
			this.byType.set(unit.unitType, list);
		}
		memory.update(ctx, observation, this.own);
	}

	get seconds(): number {
		return this.loop / 22.4;
	}

	get supplyLeft(): number {
		return this.supplyCap - this.supplyUsed;
	}

	all(unitType: number): RawUnit[] {
		return this.byType.get(unitType) ?? [];
	}

	ready(unitType: number): RawUnit[] {
		return this.all(unitType).filter((u) => (u.buildProgress ?? 1) >= 1);
	}

	ordersFor(abilityId: number): number {
		return this.own.reduce((n, u) => n + (u.orders ?? []).filter((o) => o.abilityId === abilityId).length, 0);
	}

	count(unitType: number): number {
		const ability = this.ctx.data.get(unitType)?.abilityId;
		return this.all(unitType).length + (ability ? this.ordersFor(ability) : 0);
	}

	get probes(): RawUnit[] {
		return this.all(Unit.PROBE);
	}

	get nexuses(): RawUnit[] {
		return this.all(Unit.NEXUS);
	}

	get army(): RawUnit[] {
		return this.own.filter((u) => ARMY_TYPES.has(u.unitType));
	}

	get enemyCombat(): RawUnit[] {
		return this.enemies.filter(
			(u) =>
				!WORKER_TYPES.has(u.unitType) &&
				!HARMLESS_TYPES.has(u.unitType) &&
				(!this.ctx.isStructure(u.unitType) || THREAT_STRUCTURE_TYPES.has(u.unitType)),
		);
	}

	get enemyWorkers(): RawUnit[] {
		return this.enemies.filter((u) => WORKER_TYPES.has(u.unitType));
	}

	canAfford(unitType: number): boolean {
		const cost = this.ctx.cost(unitType);
		return this.minerals >= cost.minerals && this.gas >= cost.gas && (cost.supply === 0 || this.supplyLeft >= cost.supply);
	}
}

export function hpFraction(unit: RawUnit): number {
	const max = (unit.healthMax ?? 0) + (unit.shieldMax ?? 0);
	return max === 0 ? 1 : ((unit.health ?? 0) + (unit.shield ?? 0)) / max;
}

export function isIdle(unit: RawUnit): boolean {
	return (unit.orders ?? []).length === 0;
}
