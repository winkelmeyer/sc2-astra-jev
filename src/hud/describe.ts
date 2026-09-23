import { Ability } from "../sc2/ids.ts";
import type { Command } from "../sc2/types.ts";

const LABELS: Record<number, string> = {
	[Ability.BUILD_NEXUS]: "build Nexus",
	[Ability.BUILD_PYLON]: "build Pylon",
	[Ability.BUILD_ASSIMILATOR]: "build Assimilator",
	[Ability.BUILD_GATEWAY]: "build Gateway",
	[Ability.BUILD_FORGE]: "build Forge",
	[Ability.BUILD_TWILIGHTCOUNCIL]: "build Twilight Council",
	[Ability.BUILD_ROBOTICSFACILITY]: "build Robotics Facility",
	[Ability.BUILD_CYBERNETICSCORE]: "build Cybernetics Core",
	[Ability.TRAIN_ZEALOT]: "train Zealot",
	[Ability.TRAIN_STALKER]: "train Stalker",
	[Ability.TRAIN_SENTRY]: "train Sentry",
	[Ability.TRAIN_OBSERVER]: "train Observer",
	[Ability.TRAIN_IMMORTAL]: "train Immortal",
	[Ability.WARP_ZEALOT]: "warp in Zealot",
	[Ability.WARP_STALKER]: "warp in Stalker",
	[Ability.WARP_SENTRY]: "warp in Sentry",
	[Ability.MORPH_WARPGATE]: "morph Warp Gate",
	[Ability.RESEARCH_WARPGATE]: "research Warp Gate",
	[Ability.RESEARCH_BLINK]: "research Blink",
	[Ability.RESEARCH_GROUND_WEAPONS_1]: "research Ground Weapons 1",
	[Ability.RESEARCH_GROUND_WEAPONS_2]: "research Ground Weapons 2",
	[Ability.RESEARCH_GROUND_ARMOR_1]: "research Ground Armor 1",
	[Ability.BLINK]: "blink",
	[Ability.FORCEFIELD]: "Force Field",
	[Ability.GUARDIAN_SHIELD]: "Guardian Shield",
};

export function describeCommands(commands: Command[]): string[] {
	const counts = new Map<string, number>();
	for (const command of commands) {
		const label = LABELS[command.abilityId];
		if (label) counts.set(label, (counts.get(label) ?? 0) + 1);
	}
	return [...counts].map(([label, n]) => (n > 1 ? `${label} x${n}` : label));
}
