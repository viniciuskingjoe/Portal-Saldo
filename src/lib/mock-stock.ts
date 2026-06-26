import type { Product } from "./stock-types";

const BRANDS = ["K&J BLACK", "KING&JOE PLAY", "KING&JOE"];
const COLLECTIONS = ["212", "213", "402", "403", "026", "25"];
const NUM_SIZES = ["36", "38", "40", "42", "44", "46", "48"];
const ALPHA_SIZES = ["P", "M", "G", "GG", "XG"];
const ALPHA_FULL = ["PP", "P", "M", "G", "GG"];
const COLORS_BASE = ["PRETO", "MARINHO", "AREIA", "BRANCO", "CINZA", "VERDE", "VINHO", "AZUL"];

const SUBGROUPS_NUM = ["Calça", "Bermuda", "Shorts"];
const SUBGROUPS_ALPHA = ["Camisa", "Camiseta", "Polo", "Tricot", "Blusa", "Jaqueta", "Moletom"];

const COMPOSITIONS = [
  "100% algodão",
  "76% algodão, 22% poliéster, 2% elastano",
  "65% poliéster, 35% algodão",
  "100% poliéster",
  "97% algodão, 3% elastano",
  "50% algodão, 50% modal",
];

// Seeded pseudo-random for stable mock data
function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rng: () => number, arr: T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}

function refCode(prefix: string, i: number) {
  return `${prefix}${String(i).padStart(5, "0")}J`;
}

function buildProduct(rng: () => number, i: number): Product {
  const isNumGrade = rng() > 0.45;
  const subgroup = isNumGrade ? pick(rng, SUBGROUPS_NUM) : pick(rng, SUBGROUPS_ALPHA);
  const sizes = isNumGrade
    ? NUM_SIZES.slice(0, 4 + Math.floor(rng() * 4))
    : rng() > 0.5
      ? ALPHA_SIZES
      : ALPHA_FULL;

  const prefixMap: Record<string, string> = {
    Calça: "CL",
    Bermuda: "BM",
    Shorts: "SH",
    Camisa: "CM",
    Camiseta: "CA",
    Polo: "PL",
    Tricot: "TR",
    Blusa: "BL",
    Jaqueta: "JQ",
    Moletom: "MO",
  };

  const brand = pick(rng, BRANDS);
  const collection = pick(rng, COLLECTIONS);
  const numColors = 1 + Math.floor(rng() * 4);
  const colorNames = new Set<string>();
  while (colorNames.size < numColors) colorNames.add(pick(rng, COLORS_BASE));

  const colors = Array.from(colorNames).map((name) => {
    const sizeMap: Record<string, number> = {};
    let total = 0;
    for (const sz of sizes) {
      const q = Math.floor(rng() * 80);
      sizeMap[sz] = q;
      total += q;
    }
    return { name, total, sizes: sizeMap };
  });

  const totalQuantity = colors.reduce((a, c) => a + c.total, 0);
  const reference = refCode(prefixMap[subgroup] ?? "PR", i);
  const sellIn = Number((40 + rng() * 200).toFixed(2));
  const sellOut = Number((sellIn * (2.5 + rng() * 1.5)).toFixed(2));

  return {
    reference,
    description: `${subgroup} ${brand.includes("PLAY") ? "esportiva" : brand === "K&J BLACK" ? "premium" : "casual"} ${isNumGrade ? "masculina" : "unissex"}`,
    subgroup,
    collection,
    brand,
    composition: pick(rng, COMPOSITIONS),
    sellIn,
    sellOut,
    // Intentionally broken sometimes to show fallback
    imageUrl: rng() > 0.15 ? `https://picsum.photos/seed/${reference}/600/800` : "",
    totalQuantity,
    colors,
  };
}

export function generateMockStock(count = 120): Product[] {
  const rng = mulberry32(42);
  return Array.from({ length: count }, (_, i) => buildProduct(rng, i + 1));
}
