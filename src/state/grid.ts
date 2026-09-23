import type { ImageData, Point2 } from "../sc2/types.ts";

export class Grid {
	constructor(private readonly image: ImageData) {}

	get width(): number {
		return this.image.size.x;
	}

	get height(): number {
		return this.image.size.y;
	}

	value(x: number, y: number): number {
		const ix = Math.floor(x);
		const iy = Math.floor(y);
		if (ix < 0 || iy < 0 || ix >= this.width || iy >= this.height) return 0;
		const index = iy * this.width + ix;
		if (this.image.bitsPerPixel === 1) return (this.image.data[index >> 3] >> (7 - (index & 7))) & 1;
		return this.image.data[index];
	}

	isFree(center: Point2, size: number): boolean {
		const half = size / 2;
		for (let x = Math.floor(center.x - half); x < center.x + half; x++) {
			for (let y = Math.floor(center.y - half); y < center.y + half; y++) {
				if (!this.value(x, y)) return false;
			}
		}
		return true;
	}
}
