import type { Point2 } from "../sc2/types.ts";

export function distance(a: Point2, b: Point2): number {
	return Math.hypot(a.x - b.x, a.y - b.y);
}

export function centroid(points: Point2[]): Point2 {
	if (points.length === 0) throw new Error("centroid of empty set");
	const sum = points.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
	return { x: sum.x / points.length, y: sum.y / points.length };
}

export function towards(from: Point2, to: Point2, step: number): Point2 {
	const d = distance(from, to);
	if (d === 0) return { ...from };
	return { x: from.x + ((to.x - from.x) / d) * step, y: from.y + ((to.y - from.y) / d) * step };
}

export function closest<T extends { pos: Point2 }>(items: T[], to: Point2): T | undefined {
	let best: T | undefined;
	let bestDistance = Number.POSITIVE_INFINITY;
	for (const item of items) {
		const d = distance(item.pos, to);
		if (d < bestDistance) {
			best = item;
			bestDistance = d;
		}
	}
	return best;
}

export function within<T extends { pos: Point2 }>(items: T[], to: Point2, radius: number): T[] {
	return items.filter((item) => distance(item.pos, to) <= radius);
}

export function clusterByDistance<T extends { pos: Point2 }>(items: T[], radius: number): T[][] {
	const clusters: T[][] = [];
	const seen = new Set<T>();
	for (const seed of items) {
		if (seen.has(seed)) continue;
		const cluster: T[] = [seed];
		seen.add(seed);
		for (let i = 0; i < cluster.length; i++) {
			for (const other of items) {
				if (!seen.has(other) && distance(cluster[i].pos, other.pos) <= radius) {
					seen.add(other);
					cluster.push(other);
				}
			}
		}
		clusters.push(cluster);
	}
	return clusters;
}

export function round1(p: Point2): Point2 {
	return { x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 };
}
