export type FeedKind = "jev" | "astra" | "mode" | "build";

export interface FeedEntry { loop: number; kind: FeedKind; text: string; color: { r: number; g: number; b: number } }

const MAX_ENTRIES = 200;

export const KIND_COLORS: Record<FeedKind, FeedEntry["color"]> = {
	jev: { r: 200, g: 200, b: 200 },
	astra: { r: 120, g: 190, b: 255 },
	mode: { r: 255, g: 170, b: 60 },
	build: { r: 150, g: 150, b: 150 },
};

export class DecisionFeed {
	readonly entries: FeedEntry[] = [];

	push(loop: number, kind: FeedKind, text: string, color = KIND_COLORS[kind]): void {
		this.entries.push({ loop, kind, text, color });
		if (this.entries.length > MAX_ENTRIES) this.entries.shift();
	}

	latest(count: number): FeedEntry[] {
		return this.entries.slice(-count);
	}
}
