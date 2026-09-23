import type { Squad } from "../army/types.ts";
import { Ability } from "../sc2/ids.ts";
import type { Command, Point2 } from "../sc2/types.ts";
import { centroid, distance } from "../state/geometry.ts";
import type { World } from "../state/world.ts";

const HOLD_LOOPS = 3 * 22.4;
const MIN_SHIFT = 6;
const SHOWCASE: ReadonlySet<number> = new Set([
	Ability.BUILD_NEXUS, Ability.BUILD_PYLON, Ability.BUILD_GATEWAY, Ability.BUILD_FORGE,
	Ability.BUILD_TWILIGHTCOUNCIL, Ability.BUILD_ROBOTICSFACILITY, Ability.BUILD_CYBERNETICSCORE,
	Ability.WARP_ZEALOT, Ability.WARP_STALKER, Ability.WARP_SENTRY,
	Ability.BLINK, Ability.FORCEFIELD,
]);

type Shot = { pos: Point2; priority: number };

export class CameraDirector {
	private current: Shot | null = null;
	private since = -Infinity;

	next(world: World, squads: Squad[], issued: Command[]): Point2 | undefined {
		const shot = this.bestShot(squads, issued);
		if (!shot) return undefined;
		const held = world.loop - this.since < HOLD_LOOPS;
		const outranks = this.current !== null && shot.priority > this.current.priority;
		const sameSpot = this.current !== null && distance(shot.pos, this.current.pos) < MIN_SHIFT;
		if (sameSpot) {
			this.current = { pos: this.current?.pos ?? shot.pos, priority: shot.priority };
			return undefined;
		}
		if (held && !outranks) return undefined;
		this.current = shot;
		this.since = world.loop;
		return shot.pos;
	}

	private bestShot(squads: Squad[], issued: Command[]): Shot | undefined {
		const fight = squads
			.filter((s) => s.units.length > 0 && s.nearbyEnemies.length > 0)
			.sort((a, b) => b.nearbyEnemies.length + b.units.length - (a.nearbyEnemies.length + a.units.length))[0];
		if (fight) {
			const ours = centroid(fight.units.map((u) => u.pos));
			const theirs = centroid(fight.nearbyEnemies.map((e) => e.pos));
			return { pos: { x: (ours.x * 2 + theirs.x) / 3, y: (ours.y * 2 + theirs.y) / 3 }, priority: 3 };
		}
		const click = [...issued].reverse().find((c) => SHOWCASE.has(c.abilityId) && c.targetWorldSpacePos);
		if (click?.targetWorldSpacePos) return { pos: click.targetWorldSpacePos, priority: 2 };
		const army = squads.flatMap((s) => s.units);
		if (army.length > 0) return { pos: centroid(army.map((u) => u.pos)), priority: 1 };
		return undefined;
	}
}
