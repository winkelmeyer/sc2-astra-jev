import type { Squad, SquadOrders } from "../army/types.ts";
import { Ability, Buff, Unit } from "../sc2/ids.ts";
import type { Command, Point2, RawUnit } from "../sc2/types.ts";
import { centroid, closest, distance, towards } from "../state/geometry.ts";
import { hpFraction, type World } from "../state/world.ts";

const FORCEFIELD_ENERGY = 50;
const GUARDIAN_SHIELD_ENERGY = 75;

export interface MicroContext {
	world: World;
	orders: SquadOrders;
	retreatTo: Point2;
	blinkReady: Set<number>;
	anchor?: Point2;
}

export function microSquad(squad: Squad, mc: MicroContext): Command[] {
	if (squad.units.length === 0) return [];
	if (squad.nearbyEnemies.length === 0) return advance(squad, mc);
	const commands: Command[] = [];
	const enemyCenter = centroid(squad.nearbyEnemies.map((e) => e.pos));
	if (squad.kind === "sentry") commands.push(...sentrySpells(squad, mc, enemyCenter));
	for (const unit of squad.units) {
		const command = unitCommand(unit, squad, mc, enemyCenter);
		if (command) commands.push(command);
	}
	return commands;
}

function unitCommand(unit: RawUnit, squad: Squad, mc: MicroContext, enemyCenter: Point2): Command | undefined {
	const { world } = mc;
	const decision = squad.decision;
	const tags = [unit.tag];
	const range = world.ctx.weaponRange(unit.unitType);

	const canBlink = unit.unitType === Unit.STALKER && mc.blinkReady.has(unit.tag);
	const shieldsGone = (unit.shield ?? 0) < (unit.shieldMax ?? 1) * 0.15;
	if (canBlink && decision.blinkBack && shieldsGone) {
		mc.blinkReady.delete(unit.tag);
		return { abilityId: Ability.BLINK, unitTags: tags, targetWorldSpacePos: towards(unit.pos, awayFrom(unit.pos, enemyCenter, mc.retreatTo), 8) };
	}

	if (decision.stance === "retreat") {
		return { abilityId: Ability.MOVE, unitTags: tags, targetWorldSpacePos: mc.retreatTo };
	}

	const inRange = squad.nearbyEnemies.filter((e) => distance(e.pos, unit.pos) <= range + (unit.radius ?? 0.5) + (e.radius ?? 0.5) + 0.3);
	const focused = decision.focusType ? inRange.filter((e) => world.ctx.name(e.unitType) === decision.focusType) : [];
	const target = weakest(focused.length > 0 ? focused : inRange);

	if (unit.unitType === Unit.STALKER || unit.unitType === Unit.SENTRY) {
		const nearest = closest(squad.nearbyEnemies, unit.pos);
		if (nearest && (unit.weaponCooldown ?? 0) > 4) {
			const enemyRange = world.ctx.weaponRange(nearest.unitType);
			if (enemyRange < range && distance(nearest.pos, unit.pos) < enemyRange + 2) {
				return { abilityId: Ability.MOVE, unitTags: tags, targetWorldSpacePos: towards(unit.pos, nearest.pos, -2.5) };
			}
		}
	}

	if (decision.stance === "hold") {
		if (target) return { abilityId: Ability.ATTACK, unitTags: tags, targetUnitTag: target.tag };
		const hold = decision.holdPoint ?? centroid(squad.units.map((u) => u.pos));
		return distance(unit.pos, hold) > 3 ? { abilityId: Ability.MOVE, unitTags: tags, targetWorldSpacePos: hold } : undefined;
	}

	if (target) return { abilityId: Ability.ATTACK, unitTags: tags, targetUnitTag: target.tag };
	const preferred = decision.focusType ? squad.nearbyEnemies.filter((e) => world.ctx.name(e.unitType) === decision.focusType) : [];
	const chase = closest(preferred.length > 0 ? preferred : squad.nearbyEnemies, unit.pos);
	return chase ? { abilityId: Ability.ATTACK, unitTags: tags, targetUnitTag: chase.tag } : undefined;
}

function advance(squad: Squad, mc: MicroContext): Command[] {
	const center = mc.anchor ?? centroid(squad.units.map((u) => u.pos));
	const gathering = distance(center, mc.orders.target) < 6;
	return squad.units.map((unit) => {
		const straggler = !gathering && distance(unit.pos, center) > 8;
		if (squad.decision.stance === "retreat") return { abilityId: Ability.MOVE, unitTags: [unit.tag], targetWorldSpacePos: mc.retreatTo };
		if (straggler) return { abilityId: Ability.MOVE, unitTags: [unit.tag], targetWorldSpacePos: center };
		return { abilityId: Ability.ATTACK, unitTags: [unit.tag], targetWorldSpacePos: mc.orders.target };
	});
}

function sentrySpells(squad: Squad, mc: MicroContext, enemyCenter: Point2): Command[] {
	const commands: Command[] = [];
	for (const sentry of squad.units) {
		const energy = sentry.energy ?? 0;
		if (squad.decision.guardianShield && energy >= GUARDIAN_SHIELD_ENERGY && !(sentry.buffIds ?? []).includes(Buff.GUARDIAN_SHIELD)) {
			commands.push({ abilityId: Ability.GUARDIAN_SHIELD, unitTags: [sentry.tag] });
			squad.decision.guardianShield = false;
			continue;
		}
		if (squad.decision.forcefield && energy >= FORCEFIELD_ENERGY && distance(sentry.pos, enemyCenter) < 9) {
			const ours = mc.anchor ?? sentry.pos;
			commands.push({ abilityId: Ability.FORCEFIELD, unitTags: [sentry.tag], targetWorldSpacePos: towards(enemyCenter, ours, 1.5) });
			squad.decision.forcefield = false;
		}
	}
	return commands;
}

function weakest(units: RawUnit[]): RawUnit | undefined {
	return units.reduce<RawUnit | undefined>((best, u) => (!best || hpFraction(u) < hpFraction(best) ? u : best), undefined);
}

function awayFrom(pos: Point2, threat: Point2, home: Point2): Point2 {
	const away = towards(pos, threat, -1);
	const toHome = towards(pos, home, 1);
	return { x: pos.x + (away.x - pos.x) + (toHome.x - pos.x), y: pos.y + (away.y - pos.y) + (toHome.y - pos.y) };
}

export function microObserver(world: World, target: Point2, anchor: Point2 | undefined): Command[] {
	const observers = [...world.all(Unit.OBSERVER), ...world.all(Unit.OBSERVERSIEGEMODE)];
	if (observers.length === 0) return [];
	const spot = anchor ? towards(anchor, target, 4) : target;
	return observers.map((o) => ({ abilityId: Ability.MOVE, unitTags: [o.tag], targetWorldSpacePos: spot }));
}
