import type { Commander } from "../army/engagement.ts";
import type { Squad } from "../army/types.ts";
import { averageHp, composition, gameClock } from "../brain/summary.ts";
import type { GameLog } from "../log.ts";
import { round1 } from "../state/geometry.ts";
import type { World } from "../state/world.ts";

const FEED_ENTRIES = 150;

export function buildSnapshot(world: World, commander: Commander, squads: Squad[], log: GameLog, actionErrors: Record<string, number>) {
	const plan = commander.plan;
	return {
		clock: gameClock(world.loop),
		loop: world.loop,
		economy: { minerals: world.minerals, gas: world.gas, supply: `${world.supplyUsed}/${world.supplyCap}`, army: world.armySupply, probes: world.probes.length, bases: world.nexuses.length },
		cost: log.cost.snapshot(),
		astra: {
			mode: commander.mode,
			planId: plan ? commander.planId : null,
			plan,
			pending: commander.pending ? commander.pendingTrigger : null,
			history: commander.history.slice(-12),
		},
		squads: squads
			.filter((s) => s.units.length > 0)
			.map((squad) => {
				const orders = commander.ordersFor(world, squad);
				const d = squad.decision;
				return {
					id: squad.id,
					kind: squad.kind,
					units: composition(world, squad.units),
					count: squad.units.length,
					hp: averageHp(squad.units),
					enemies: composition(world, squad.nearbyEnemies),
					fromPlan: plan?.squads.some((s) => s.squadId === squad.id) ? commander.planId : null,
					orders: { ...orders, target: round1(orders.target) },
					decision: {
						stance: d.stance,
						source: d.source,
						focus: d.focusType ?? null,
						probabilities: d.probabilities,
						ageSeconds: Number(((world.loop - d.loop) / 22.4).toFixed(1)),
						thinking: squad.inFlight,
					},
				};
			}),
		feed: log.feed.latest(FEED_ENTRIES).map((e) => ({ clock: gameClock(e.loop), kind: e.kind, text: e.text })),
		actionErrors,
	};
}

export type Snapshot = ReturnType<typeof buildSnapshot>;
