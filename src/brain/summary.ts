import type { Squad } from "../army/types.ts";
import { Upgrade } from "../sc2/ids.ts";
import type { Point2, RawUnit } from "../sc2/types.ts";
import { centroid, clusterByDistance, round1 } from "../state/geometry.ts";
import { hpFraction, type World } from "../state/world.ts";

const TOWNHALL = /Nexus|Hatchery|Lair|Hive|CommandCenter|OrbitalCommand|PlanetaryFortress/;

export function composition(world: World, units: RawUnit[]): Record<string, number> {
	const counts: Record<string, number> = {};
	for (const u of units) {
		const name = world.ctx.name(u.unitType);
		counts[name] = (counts[name] ?? 0) + 1;
	}
	return counts;
}

export function averageHp(units: RawUnit[]): number {
	if (units.length === 0) return 0;
	return Math.round((units.reduce((sum, u) => sum + hpFraction(u), 0) / units.length) * 100);
}

export function gameClock(loop: number): string {
	const seconds = Math.floor(loop / 22.4);
	return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function battlefieldSummary(world: World, squads: Squad[], trigger: string, rally: Point2): Record<string, unknown> {
	const ctx = world.ctx;
	const enemyGroups = clusterByDistance(world.enemyCombat, 8).map((group) => ({
		center: round1(centroid(group.map((u) => u.pos))),
		units: composition(world, group),
		avgHpPercent: averageHp(group),
	}));
	const structures = [...world.memory.structures.values()];
	const structureCounts: Record<string, number> = {};
	for (const s of structures) structureCounts[ctx.name(s.unitType)] = (structureCounts[ctx.name(s.unitType)] ?? 0) + 1;
	return {
		trigger,
		gameTime: gameClock(world.loop),
		economy: { minerals: world.minerals, gas: world.gas, supply: `${world.supplyUsed}/${world.supplyCap}`, armySupply: world.armySupply },
		upgrades: { blink: world.upgrades.has(Upgrade.BLINK), groundWeapons: world.upgrades.has(Upgrade.GROUND_WEAPONS_2) ? 2 : world.upgrades.has(Upgrade.GROUND_WEAPONS_1) ? 1 : 0 },
		mySquads: squads.map((s) => ({
			squadId: s.id,
			kind: s.kind,
			units: composition(world, s.units),
			avgHpPercent: averageHp(s.units),
			center: round1(centroid(s.units.map((u) => u.pos))),
		})),
		myBases: world.nexuses.map((n) => round1(n.pos)),
		visibleEnemyArmy: enemyGroups,
		knownEnemyStructures: structureCounts,
		knownEnemyTownhalls: structures.filter((s) => TOWNHALL.test(ctx.name(s.unitType))).map((s) => round1(s.pos)),
		map: {
			size: ctx.info.startRaw.mapSize,
			myMain: round1(ctx.myStart),
			myNatural: round1(ctx.natural.pos),
			enemyMain: round1(ctx.enemyStart),
			enemyNatural: round1(ctx.enemyNatural.pos),
			center: round1(ctx.mapCenter),
			defaultRally: round1(rally),
			expansions: ctx.expansions.slice(0, 10).map((e) => round1(e.pos)),
		},
	};
}
