import type { Command } from "../sc2/types.ts";

const REPEAT_LOOPS = 16;
const MIN_GAP_LOOPS = 4;

export class CommandCache {
	private readonly last = new Map<number, { key: string; loop: number }>();

	filter(commands: Command[], loop: number): Command[] {
		return commands.filter((command) => {
			if (command.unitTags.length !== 1) return true;
			const tag = command.unitTags[0];
			const key = commandKey(command);
			const previous = this.last.get(tag);
			if (previous && previous.key === key && loop - previous.loop < REPEAT_LOOPS) return false;
			if (previous && previous.key !== key && loop - previous.loop < MIN_GAP_LOOPS) return false;
			this.last.set(tag, { key, loop });
			return true;
		});
	}
}

function commandKey(command: Command): string {
	const target = command.targetUnitTag ?? (command.targetWorldSpacePos ? `${Math.round(command.targetWorldSpacePos.x)},${Math.round(command.targetWorldSpacePos.y)}` : "");
	return `${command.abilityId}:${target}`;
}
