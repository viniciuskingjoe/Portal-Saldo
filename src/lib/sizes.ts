/**
 * Ordenacao e classificacao de tamanhos.
 *
 * Tamanhos por letra nao podem ser ordenados alfabeticamente (daria G, GG, M, P...).
 * A ordem correta e a da grade: PP, P, M, G, GG, XG, XXG.
 */

const LETTER_ORDER = [
  "PP",
  "P",
  "M",
  "G",
  "GG",
  "XG",
  "XXG",
  "XXXG",
  "EG",
  "EGG",
  "U",
  "UN",
  "UNICO",
];

function normalizeSize(size: string): string {
  return size
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toUpperCase();
}

function letterRank(size: string): number {
  const index = LETTER_ORDER.indexOf(normalizeSize(size));
  // Desconhecido vai para o fim, mantendo ordem alfabetica entre si.
  return index === -1 ? LETTER_ORDER.length : index;
}

function numericValue(size: string): number | null {
  const parsed = Number(normalizeSize(size));
  return Number.isFinite(parsed) ? parsed : null;
}

/** Compara tamanhos na ordem da grade (numericos primeiro, depois letras). */
export function compareSizes(a: string, b: string): number {
  const na = numericValue(a);
  const nb = numericValue(b);

  if (na !== null && nb !== null) return na - nb;
  if (na !== null) return -1;
  if (nb !== null) return 1;

  const ra = letterRank(a);
  const rb = letterRank(b);
  if (ra !== rb) return ra - rb;
  return normalizeSize(a).localeCompare(normalizeSize(b));
}

/* ---------- Familias de grade (usadas para separar abas no Excel) ---------- */

export type SizeFamily = "play" | "baixo" | "cima" | "outros";

export const SIZE_FAMILY_LABELS: Record<SizeFamily, string> = {
  play: "1 a 18",
  baixo: "38 a 50",
  cima: "P a XXG",
  outros: "Outros",
};

export const SIZE_FAMILY_ORDER: SizeFamily[] = ["cima", "baixo", "play", "outros"];

/** Numericos ate 20 = grade Play (infantil); acima disso = parte de baixo. */
export function sizeFamily(size: string): SizeFamily {
  const numeric = numericValue(size);
  if (numeric !== null) return numeric <= 20 ? "play" : "baixo";
  return LETTER_ORDER.includes(normalizeSize(size)) ? "cima" : "outros";
}

/** Familia predominante entre os tamanhos com saldo do produto. */
export function productSizeFamily(sizes: string[]): SizeFamily {
  const counts = new Map<SizeFamily, number>();
  for (const size of sizes) {
    const family = sizeFamily(size);
    counts.set(family, (counts.get(family) ?? 0) + 1);
  }

  let winner: SizeFamily = "outros";
  let best = -1;
  for (const family of SIZE_FAMILY_ORDER) {
    const count = counts.get(family) ?? 0;
    if (count > best) {
      best = count;
      winner = family;
    }
  }
  return winner;
}
