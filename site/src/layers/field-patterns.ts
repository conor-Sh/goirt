import type { Map as MapLibreMap } from "maplibre-gl";
import { patternGroups, patternStroke } from "../palette";

const SIZE = 32;

type Draw = (ctx: CanvasRenderingContext2D) => void;

function diagonal(ctx: CanvasRenderingContext2D, step: number, spacing: number): void {
  ctx.beginPath();
  for (let offset = -SIZE; offset <= SIZE * 2; offset += spacing) {
    ctx.moveTo(offset, 0);
    ctx.lineTo(offset + SIZE, SIZE);
  }
  ctx.lineWidth = step;
  ctx.stroke();
}

function vertical(ctx: CanvasRenderingContext2D, width: number, spacing: number): void {
  ctx.beginPath();
  for (let x = spacing / 2; x < SIZE; x += spacing) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, SIZE);
  }
  ctx.lineWidth = width;
  ctx.stroke();
}

function grid(ctx: CanvasRenderingContext2D, width: number, spacing: number): void {
  ctx.beginPath();
  for (let x = spacing / 2; x < SIZE; x += spacing) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, SIZE);
  }
  for (let y = spacing / 2; y < SIZE; y += spacing) {
    ctx.moveTo(0, y);
    ctx.lineTo(SIZE, y);
  }
  ctx.lineWidth = width;
  ctx.stroke();
}

function dots(
  ctx: CanvasRenderingContext2D,
  spacing: number,
  radius: number,
  offset = 0,
): void {
  ctx.beginPath();
  for (let y = spacing / 2; y < SIZE; y += spacing) {
    const shift = offset && Math.round(y / spacing) % 2 === 0 ? spacing / 2 : 0;
    for (let x = spacing / 2 + shift; x < SIZE; x += spacing) {
      ctx.moveTo(x + radius, y);
      ctx.arc(x, y, radius, 0, Math.PI * 2);
    }
  }
  ctx.fill();
}

const drawings: Record<string, Draw> = {
  cereals: (ctx) => diagonal(ctx, 1.2, 8),
  maize: (ctx) => vertical(ctx, 1.2, 7),
  oilseeds: (ctx) => dots(ctx, 10, 1.4),
  roots: (ctx) => {
    diagonal(ctx, 1.1, 9);
    ctx.beginPath();
    for (let offset = SIZE; offset >= -SIZE; offset -= 9) {
      ctx.moveTo(offset, 0);
      ctx.lineTo(offset - SIZE, SIZE);
    }
    ctx.lineWidth = 1.1;
    ctx.stroke();
  },
  horticulture: (ctx) => grid(ctx, 0.8, 6),
  fruit: (ctx) => dots(ctx, 12, 2.2, 1),
  fallow: (ctx) => dots(ctx, 14, 0.9, 1),
};

function patternCanvas(group: string): ImageData | null {
  const draw = drawings[group];
  if (!draw) return null;
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.strokeStyle = patternStroke;
  ctx.fillStyle = patternStroke;
  draw(ctx);
  return ctx.getImageData(0, 0, SIZE, SIZE);
}

/** Register the seven group patterns on the map once. */
export function addFieldPatterns(map: MapLibreMap): void {
  for (const group of patternGroups) {
    const name = `field-pattern-${group}`;
    if (map.hasImage(name)) continue;
    const image = patternCanvas(group);
    if (image) map.addImage(name, image, { pixelRatio: 1 });
  }
}

export function patternImageName(group: string): string {
  return `field-pattern-${group}`;
}
