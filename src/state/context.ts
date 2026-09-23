import type { Sc2Client } from "../sc2/client.ts";
import type { GameInfo, Point2, RawUnit, UnitTypeData } from "../sc2/types.ts";
import { Alliance } from "../sc2/ids.ts";
import { centroid, clusterByDistance, distance, towards } from "./geometry.ts";
import { Grid } from "./grid.ts";

const STRUCTURE_ATTRIBUTE = 8;

export interface Expansion {
	pos: Point2;
	resourceCenter: Point2;
	groundDistance: number;
}

export class GameContext {
	readonly placement: Grid;
	readonly pathing: Grid;
	readonly height: Grid;
	readonly mapCenter: Point2;

	private constructor(
		readonly info: GameInfo,
		readonly data: Map<number, UnitTypeData>,
		readonly myStart: Point2,
		readonly enemyStart: Point2,
		readonly expansions: Expansion[],
	) {
		this.placement = new Grid(info.startRaw.placementGrid);
		this.pathing = new Grid(info.startRaw.pathingGrid);
		this.height = new Grid(info.startRaw.terrainHeight);
		const area = info.startRaw.playableArea;
		this.mapCenter = { x: (area.p0.x + area.p1.x) / 2, y: (area.p0.y + area.p1.y) / 2 };
	}

	static async build(client: Sc2Client, info: GameInfo, units: RawUnit[]): Promise<GameContext> {
		const data = await client.unitTypeData();
		const myNexus = units.find((u) => u.alliance === Alliance.Self && nameOf(data, u.unitType) === "Nexus");
		if (!myNexus) throw new Error("no starting Nexus in first observation");
		const enemyStart = info.startRaw.startLocations[0];
		if (!enemyStart) throw new Error("map reports no enemy start location");
		const placement = new Grid(info.startRaw.placementGrid);
		const resources = units.filter((u) => isMineral(data, u.unitType) || isGeyser(data, u.unitType));
		const clusters = clusterByDistance(resources, 8.5).filter((c) => c.length >= 5);
		const spots = clusters.map((cluster) => ({
			resourceCenter: centroid(cluster.map((u) => u.pos)),
			pos: nexusSpot(cluster, data, placement, myNexus.pos),
		}));
		const pathStart = towards(myNexus.pos, info.startRaw.startLocations[0], 6);
		const distances = await client.pathDistances(spots.map((s) => ({ from: pathStart, to: towards(s.pos, s.resourceCenter, -4) })));
		const expansions = spots
			.map((s, i) => ({ ...s, groundDistance: distance(s.pos, myNexus.pos) < 1 ? 0 : distances[i] }))
			.filter((e) => e.groundDistance > 0 || distance(e.pos, myNexus.pos) < 1)
			.sort((a, b) => a.groundDistance - b.groundDistance);
		return new GameContext(info, data, myNexus.pos, enemyStart, expansions);
	}

	name(unitType: number): string {
		return nameOf(this.data, unitType);
	}

	isStructure(unitType: number): boolean {
		return this.data.get(unitType)?.attributes?.includes(STRUCTURE_ATTRIBUTE) ?? false;
	}

	isMineral(unitType: number): boolean {
		return isMineral(this.data, unitType);
	}

	isGeyser(unitType: number): boolean {
		return isGeyser(this.data, unitType);
	}

	weaponRange(unitType: number): number {
		return Math.max(0, ...(this.data.get(unitType)?.weapons ?? []).map((w) => w.range ?? 0));
	}

	cost(unitType: number): { minerals: number; gas: number; supply: number } {
		const d = this.data.get(unitType);
		if (!d) throw new Error(`no unit data for type ${unitType}`);
		return { minerals: d.mineralCost ?? 0, gas: d.vespeneCost ?? 0, supply: d.foodRequired ?? 0 };
	}

	get natural(): Expansion {
		return this.expansions[1];
	}

	get enemyNatural(): Expansion {
		const others = this.expansions.filter((e) => distance(e.pos, this.enemyStart) > 3);
		return others.reduce((best, e) => (distance(e.pos, this.enemyStart) < distance(best.pos, this.enemyStart) ? e : best));
	}

	isHighGround(a: Point2, b: Point2): boolean {
		return this.height.value(a.x, a.y) > this.height.value(b.x, b.y) + 8;
	}
}

function nameOf(data: Map<number, UnitTypeData>, unitType: number): string {
	return data.get(unitType)?.name ?? `Unit${unitType}`;
}

function isMineral(data: Map<number, UnitTypeData>, unitType: number): boolean {
	return nameOf(data, unitType).includes("MineralField");
}

function isGeyser(data: Map<number, UnitTypeData>, unitType: number): boolean {
	return nameOf(data, unitType).includes("Geyser");
}

function nexusSpot(cluster: RawUnit[], data: Map<number, UnitTypeData>, placement: Grid, myStart: Point2): Point2 {
	const center = centroid(cluster.map((u) => u.pos));
	if (distance(center, myStart) < 12) return myStart;
	let best: Point2 | undefined;
	let bestScore = Number.POSITIVE_INFINITY;
	for (let dx = -12; dx <= 12; dx++) {
		for (let dy = -12; dy <= 12; dy++) {
			const p = { x: Math.floor(center.x) + dx + 0.5, y: Math.floor(center.y) + dy + 0.5 };
			const clear = cluster.every((u) => distance(u.pos, p) >= (isGeyser(data, u.unitType) ? 7 : 6));
			if (!clear || !placement.isFree(p, 5)) continue;
			const score = cluster.reduce((sum, u) => sum + distance(u.pos, p), 0);
			if (score < bestScore) {
				best = p;
				bestScore = score;
			}
		}
	}
	if (!best) throw new Error(`no nexus spot found near resource cluster at ${center.x},${center.y}`);
	return best;
}
