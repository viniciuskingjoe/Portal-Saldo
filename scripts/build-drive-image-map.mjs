import fs from "node:fs/promises";
import path from "node:path";

const GOOGLE_FOLDER_MIME = "application/vnd.google-apps.folder";
const OUT_FILE = path.resolve("src/lib/drive-image-map.ts");

const ROOTS = [
  {
    brand: "KING&JOE",
    rootFolderId: "1u4__SgVj11p4Qll1YTOhPunvqOON468M",
    folders: ["INVERNO 2026 KING&JOE", "VERAO 27 KING&JOE", "COLEÇÕES ANTERIORES"],
  },
  {
    brand: "KING&JOE PLAY",
    rootFolderId: "1eJ9LZypd1YdIqpPXgovFuUjYNHiqtyS4",
    folders: [
      "INVERNO 2026 KING&JOE PLAY",
      "VERAO 27 KING&JOE PLAY",
      "COLEÇÕES ANTERIORES",
    ],
  },
  {
    brand: "K&J BLACK",
    rootFolderId: "1Bvwd5DmzwgZy0yIrnoihVTaVl5xHy7SY",
    folders: ["INVERNO 2026 K&J BLACK", "VERAO 27 K&J BLACK", "COLEÇÕES ANTERIORES"],
  },
];

const IGNORED_FOLDER_NAMES = [
  "ARTES PARA POSTAGEM",
  "ARTE PARA POSTAGEM",
  "FEED",
  "STORY",
  "STORIES",
  "REELS",
  "CATALOGO",
  "CATÁLOGO",
  "LOOKBOOK",
  "FOTOS CONCEITO",
  "FOTOS CRIATIVAS",
  "FOTOS EDITORIAL",
];
const MAX_SEARCH_DEPTH = 8;

function decodeHtml(value) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

function decodeJsString(value) {
  try {
    return JSON.parse(`"${value}"`);
  } catch {
    return value;
  }
}

function normalizeText(value) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .trim();
}

function lookupKey(value) {
  return normalizeText(value).replace(/[^A-Z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

const IGNORED_FOLDER_KEYS = new Set(IGNORED_FOLDER_NAMES.map(lookupKey));

function normalizeReference(value) {
  const base = normalizeText(value)
    .replace(/\.[A-Z0-9]{2,5}$/i, "")
    .split(/[ _-]/)[0];

  if (/^[A-Z]{1,}[A-Z0-9.]*[0-9][A-Z0-9.]*$/.test(base)) {
    return base;
  }

  return null;
}

function referenceAliases(reference) {
  const compact = reference.replace(/\./g, "");
  return [...new Set([reference, compact])];
}

function isImageMime(mimeType) {
  return mimeType?.startsWith("image/") ?? false;
}

function isImageLikeName(name) {
  return /\.(avif|gif|jpe?g|png|webp)$/i.test(name);
}

function isBlockedFileName(name) {
  return /\.(ai|avi|db|mov|mp4|pdf|psd|zip)$/i.test(name);
}

function isFolderLike(entry) {
  return (
    entry.mimeType === GOOGLE_FOLDER_MIME ||
    (!entry.mimeType && !normalizeReference(entry.name) && !isImageLikeName(entry.name))
  );
}

function isProductPhotoFolder(name) {
  const key = lookupKey(name);
  if (key.includes("CAMPANHA") || key.includes("MODELO")) return false;
  if (key === "STILL") return true;
  if (key === "SHOWROOM") return true;
  if (key === "FOTOS") return true;
  if (key.includes("FOTO") && (key.includes("PRODUTO") || key.includes("STILL"))) return true;
  return false;
}

function isVerao27Trail(trail) {
  return trail.some((segment) => lookupKey(segment).includes("VERAO 27"));
}

function isPreviousSeasonInsideVerao27(name) {
  const key = lookupKey(name);
  return (
    key.startsWith("INVERNO 2024") ||
    key.startsWith("INVERNO 2025") ||
    key.startsWith("VERAO 2025")
  );
}

function shouldSkipSearchFolder(name, trail = []) {
  const key = lookupKey(name);
  if (isVerao27Trail(trail) && isPreviousSeasonInsideVerao27(name)) return true;
  if (IGNORED_FOLDER_KEYS.has(key)) return true;
  if (key.includes("ARTES") || key.includes("POSTAGEM")) return true;
  if (key.includes("CONCEITO") || key.includes("CRIATIVA") || key.includes("EDITORIAL")) return true;
  if (key.includes("BOOK") || key.includes("CATALOGO") || key.includes("LOGO")) return true;
  if (key.includes("CAMPANHA") || key.includes("PROVADOR")) return true;
  if (key.includes("REELS") || key.includes("STORIES")) return true;
  if (key.includes("VIDEO") && !key.includes("FOTO")) return true;
  return false;
}

function driveThumbnailUrl(fileId) {
  return `https://drive.google.com/thumbnail?id=${fileId}&sz=w1200`;
}

function shouldLogCollection(trail) {
  return trail.length <= 5;
}

function parseRenderedRows(html) {
  const entries = [];
  const rowRegex = /<tr[^>]*data-id="([^"]+)"[^>]*>([\s\S]*?)<\/tr>/g;

  for (const match of html.matchAll(rowRegex)) {
    const rowHtml = match[2] ?? "";
    const nameMatch = rowHtml.match(/<strong class="DNoYtb">([\s\S]*?)<\/strong>/);
    const name = decodeHtml((nameMatch?.[1] ?? "").replace(/<[^>]+>/g, "").trim());
    if (name) entries.push({ id: match[1], name, mimeType: "" });
  }

  return entries;
}

function parseInitialData(html) {
  const entries = [];
  const entryRegex =
    /\[\[null,"([A-Za-z0-9_-]{10,})"\]([\s\S]{0,12000}?)\[\[\["((?:\\.|[^"\\])*)",null,1\]\]\]/g;

  for (const match of html.matchAll(entryRegex)) {
    const chunk = match[0];
    const mimeMatch = chunk.match(/"((?:image\/[^"]+)|application\/vnd\.google-apps\.folder)"/);
    const mimeType = mimeMatch?.[1] ?? "";
    const name = decodeJsString(match[3]).trim();
    if (name && mimeType) entries.push({ id: match[1], name, mimeType });
  }

  return entries;
}

function parseDriveFolder(html) {
  const entriesById = new Map();
  const title = decodeHtml(html.match(/<title[^>]*>([^<]+)<\/title>/)?.[1] ?? "Google Drive");
  const rowCount = Number(html.match(/aria-rowcount="(\d+)"/)?.[1] ?? 0);

  for (const entry of [...parseRenderedRows(html), ...parseInitialData(html)]) {
    const existing = entriesById.get(entry.id);
    if (!existing || (!existing.mimeType && entry.mimeType)) {
      entriesById.set(entry.id, entry);
    }
  }

  return {
    title,
    rowCount,
    entries: [...entriesById.values()].sort((a, b) => a.name.localeCompare(b.name)),
  };
}

async function fetchFolder(folderId) {
  const response = await fetch(`https://drive.google.com/drive/folders/${folderId}`, {
    headers: {
      "accept-language": "pt-BR,pt;q=0.9,en;q=0.8",
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    },
  });

  if (!response.ok) {
    throw new Error(`Drive folder ${folderId} returned ${response.status}`);
  }

  return parseDriveFolder(await response.text());
}

async function findProductPhotoFolders(folderId, trail = [], visited = new Set(), depth = 0) {
  if (visited.has(folderId)) return [];
  visited.add(folderId);

  let folder;
  try {
    folder = await fetchFolder(folderId);
  } catch (error) {
    console.warn(
      `Ignorando item inacessivel: ${trail.join(" / ") || folderId} (${
        error instanceof Error ? error.message : String(error)
      })`,
    );
    return [];
  }

  const label = trail.length ? trail.join(" / ") : folder.title.replace(" - Google Drive", "");
  console.log(`${label}: ${folder.entries.length}${folder.rowCount ? `/${folder.rowCount}` : ""} itens`);

  const folders = [];

  for (const entry of folder.entries) {
    if (!isFolderLike(entry) || shouldSkipSearchFolder(entry.name, trail)) {
      continue;
    }

    const entryTrail = [...trail, entry.name];
    if (isProductPhotoFolder(entry.name)) {
      folders.push({ id: entry.id, trail: entryTrail });
      continue;
    }

    if (depth < MAX_SEARCH_DEPTH) {
      folders.push(...(await findProductPhotoFolders(entry.id, entryTrail, visited, depth + 1)));
    }
  }

  return folders;
}

async function crawlImages(folderId, trail = [], visited = new Set(), depth = 0) {
  if (visited.has(folderId)) return [];
  visited.add(folderId);

  let folder;
  try {
    folder = await fetchFolder(folderId);
  } catch (error) {
    console.warn(
      `Ignorando item inacessivel: ${trail.join(" / ") || folderId} (${
        error instanceof Error ? error.message : String(error)
      })`,
    );
    return [];
  }

  const label = trail.join(" / ");
  if (shouldLogCollection(trail)) {
    console.log(`Coletando ${label}: ${folder.entries.length}${folder.rowCount ? `/${folder.rowCount}` : ""} itens`);
  }

  const images = [];

  for (const entry of folder.entries) {
    const reference = normalizeReference(entry.name);

    if (
      IGNORED_FOLDER_KEYS.has(lookupKey(entry.name)) ||
      shouldSkipSearchFolder(entry.name, trail) ||
      isBlockedFileName(entry.name)
    ) {
      continue;
    }

    if (isFolderLike(entry)) {
      if (depth < MAX_SEARCH_DEPTH) {
        images.push(...(await crawlImages(entry.id, [...trail, entry.name], visited, depth + 1)));
      }
      continue;
    }

    if (reference && (isImageMime(entry.mimeType) || (!entry.mimeType && isImageLikeName(entry.name)))) {
      images.push({
        id: entry.id,
        name: entry.name,
        reference,
        url: driveThumbnailUrl(entry.id),
        folder: trail.join(" / "),
      });
    }
  }

  return images;
}

async function crawlBrandRoot(root, visited) {
  const rootFolder = await fetchFolder(root.rootFolderId);
  const wanted = new Set(root.folders.map(lookupKey));
  const sourceUrl = `https://drive.google.com/drive/folders/${root.rootFolderId}`;
  const matchedFolders = rootFolder.entries.filter((entry) => wanted.has(lookupKey(entry.name)));

  console.log(
    `${root.brand}: ${matchedFolders.length}/${root.folders.length} pastas de colecao encontradas`,
  );

  for (const folderName of root.folders) {
    const found = matchedFolders.some((entry) => lookupKey(entry.name) === lookupKey(folderName));
    if (!found) console.warn(`- Pasta nao encontrada em ${root.brand}: ${folderName}`);
  }

  const images = [];
  for (const entry of matchedFolders) {
    const folderImages = await crawlImages(entry.id, [root.brand, entry.name], visited.images);
    images.push(...folderImages.map((image) => ({ ...image, brand: root.brand })));
  }

  return { sourceUrl, images };
}

function preferredScore(image) {
  const name = normalizeText(image.name);
  let score = 0;
  if (!name.includes("_") && !name.includes("-")) score += 20;
  if (name.includes("OFF WHITE")) score += 120;
  if (name.includes("OFF")) score += 100;
  if (name.includes("BRANCO")) score += 80;
  if (name.includes("PRETO")) score += 60;
  if (name.includes("UNICA")) score += 40;
  return score;
}

function pickPrimaryImage(images) {
  return [...images].sort((a, b) => {
    const scoreDiff = preferredScore(b) - preferredScore(a);
    if (scoreDiff) return scoreDiff;
    const nameDiff = a.name.localeCompare(b.name);
    if (nameDiff) return nameDiff;
    return a.id.localeCompare(b.id);
  })[0];
}

const visited = {
  search: new Set(),
  images: new Set(),
};
const rootResults = [];
for (const root of ROOTS) {
  rootResults.push(await crawlBrandRoot(root, visited));
}

const images = rootResults.flatMap((result) => result.images);
const byReference = new Map();
const byBrand = new Map();

for (const image of images) {
  for (const reference of referenceAliases(image.reference)) {
    const list = byReference.get(reference) ?? [];
    list.push(image);
    byReference.set(reference, list);

    const brandKey = lookupKey(image.brand);
    const brandMap = byBrand.get(brandKey) ?? new Map();
    const brandList = brandMap.get(reference) ?? [];
    brandList.push(image);
    brandMap.set(reference, brandList);
    byBrand.set(brandKey, brandMap);
  }
}

const references = [...byReference.entries()]
  .map(([reference, list]) => [reference, pickPrimaryImage(list)])
  .sort(([a], [b]) => a.localeCompare(b));

const brandReferences = [...byBrand.entries()]
  .map(([brand, map]) => [
    brand,
    [...map.entries()]
      .map(([reference, list]) => [reference, pickPrimaryImage(list)])
      .sort(([a], [b]) => a.localeCompare(b)),
  ])
  .sort(([a], [b]) => a.localeCompare(b));

const duplicates = [...byReference.entries()].filter(([, list]) => list.length > 1);
const generatedAt = new Date().toISOString();
const sourceUrls = rootResults.map((result) => result.sourceUrl);
const fileContents = `// Generated by scripts/build-drive-image-map.mjs
// Sources:
${sourceUrls.map((sourceUrl) => `// - ${sourceUrl}`).join("\n")}
// Generated at: ${generatedAt}

export const DRIVE_IMAGE_SOURCE_URLS = ${JSON.stringify(sourceUrls, null, 2)};

export const DRIVE_IMAGE_MAP_BY_BRAND: Record<string, Record<string, string>> = {
${brandReferences
  .map(
    ([brand, items]) =>
      `  ${JSON.stringify(brand)}: {\n${items
        .map(([reference, image]) => `    ${JSON.stringify(reference)}: ${JSON.stringify(image.url)},`)
        .join("\n")}\n  },`,
  )
  .join("\n")}
};

export const DRIVE_IMAGE_MAP: Record<string, string> = {
${references.map(([reference, image]) => `  ${JSON.stringify(reference)}: ${JSON.stringify(image.url)},`).join("\n")}
};
`;

await fs.writeFile(OUT_FILE, fileContents);

console.log(`Imagens encontradas: ${images.length}`);
console.log(`Referencias com imagem: ${references.length}`);
for (const [brand, items] of brandReferences) {
  console.log(`- ${brand}: ${items.length} referencias`);
}
console.log(`Referencias com mais de uma imagem/cor: ${duplicates.length}`);
if (duplicates.length) {
  console.log("Exemplos de duplicadas:");
  for (const [reference, list] of duplicates.slice(0, 12)) {
    const primary = pickPrimaryImage(list);
    console.log(`- ${reference}: ${primary.name} (${list.length} opcoes)`);
  }
}
console.log(`Mapa gerado em: ${path.relative(process.cwd(), OUT_FILE)}`);
