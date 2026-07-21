import type { Row } from "exceljs";
import type { Product } from "./stock-types";
import { ACCESS_TYPES } from "./stock-types";
import { formatDateTime } from "./format";

type LoadedImage = {
  base64: string;
  width: number;
  height: number;
};

type ExcelJsRuntime = typeof import("exceljs") & {
  default?: typeof import("exceljs");
};

const imageCache = new Map<string, Promise<LoadedImage | null>>();

function sortSizeLabels(a: string, b: string): number {
  const na = Number(a);
  const nb = Number(b);
  if (!isNaN(na) && !isNaN(nb)) return na - nb;
  return a.localeCompare(b);
}

function availableSizes(product: Product): string[] {
  const sizes = new Set<string>();
  for (const color of product.colors) {
    for (const [size, quantity] of Object.entries(color.sizes)) {
      if (size.trim() && quantity > 0) sizes.add(size);
    }
  }
  return [...sizes].sort(sortSizeLabels);
}

function allExportSizes(products: Product[]): string[] {
  const sizes = new Set<string>();
  for (const product of products) {
    for (const size of availableSizes(product)) sizes.add(size);
  }
  return [...sizes].sort(sortSizeLabels);
}

function firstImageUrl(product: Product): string | undefined {
  const images = Array.isArray(product.images)
    ? product.images.filter((image) => image.url?.trim())
    : [];
  return images[0]?.url ?? product.imageUrl;
}

function proxiedImageUrl(url: string): string {
  if (typeof window === "undefined") return url;
  try {
    const parsed = new URL(url, window.location.href);
    if (parsed.origin === window.location.origin) return parsed.toString();
    return `/api/image?url=${encodeURIComponent(parsed.toString())}`;
  } catch {
    return url;
  }
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function readImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Nao foi possivel carregar a imagem."));
    image.src = dataUrl;
  });
}

// ExcelJS aceita bem JPEG; normalizar tambem limita o tamanho do arquivo final.
async function normalizeToJpeg(dataUrl: string): Promise<LoadedImage | null> {
  const image = await readImage(dataUrl);
  const originalWidth = image.naturalWidth || image.width;
  const originalHeight = image.naturalHeight || image.height;
  if (!originalWidth || !originalHeight) return null;

  const maxSize = 800;
  const ratio = Math.min(1, maxSize / originalWidth, maxSize / originalHeight);
  const width = Math.max(1, Math.round(originalWidth * ratio));
  const height = Math.max(1, Math.round(originalHeight * ratio));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return null;

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);

  const jpegDataUrl = canvas.toDataURL("image/jpeg", 0.85);
  return { base64: jpegDataUrl.split(",")[1] ?? "", width, height };
}

async function loadImage(url?: string): Promise<LoadedImage | null> {
  const trimmed = url?.trim();
  if (!trimmed) return null;

  if (!imageCache.has(trimmed)) {
    imageCache.set(
      trimmed,
      (async () => {
        try {
          const response = await fetch(proxiedImageUrl(trimmed));
          if (!response.ok) return null;
          const blob = await response.blob();
          if (!blob.type.startsWith("image/")) return null;
          return await normalizeToJpeg(await blobToDataUrl(blob));
        } catch {
          return null;
        }
      })(),
    );
  }

  return imageCache.get(trimmed) ?? null;
}

function styleExcelHeader(row: Row) {
  row.height = 22;
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF111111" } };
    cell.alignment = { vertical: "middle" };
    cell.border = {
      top: { style: "thin", color: { argb: "FF111111" } },
      left: { style: "thin", color: { argb: "FF111111" } },
      bottom: { style: "thin", color: { argb: "FF111111" } },
      right: { style: "thin", color: { argb: "FF111111" } },
    };
  });
}

function styleExcelDataRow(row: Row, striped: boolean) {
  row.eachCell((cell) => {
    cell.alignment = { vertical: "middle", wrapText: true };
    cell.border = {
      top: { style: "thin", color: { argb: "FFD9D9D9" } },
      left: { style: "thin", color: { argb: "FFD9D9D9" } },
      bottom: { style: "thin", color: { argb: "FFD9D9D9" } },
      right: { style: "thin", color: { argb: "FFD9D9D9" } },
    };
    if (striped) {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF8F9FA" } };
    }
  });
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export async function exportToExcel(products: Product[]) {
  const ExcelJS = (await import("exceljs")) as ExcelJsRuntime;
  const Workbook = ExcelJS.Workbook ?? ExcelJS.default?.Workbook;
  if (!Workbook) throw new Error("Nao foi possivel carregar o gerador de Excel.");

  const workbook = new Workbook();
  workbook.creator = "Portal Saldo Estoque";
  workbook.created = new Date();

  /* ---------- Aba 1: Resumo (uma linha por referencia, com imagem) ---------- */
  const summary = workbook.addWorksheet("Resumo", {
    views: [{ state: "frozen", ySplit: 4 }],
  });
  summary.columns = [
    { header: "Imagem", key: "image", width: 17 },
    { header: "Referência", key: "reference", width: 18 },
    { header: "Descrição", key: "description", width: 42 },
    { header: "Griffe", key: "brand", width: 16 },
    { header: "Coleção", key: "collection", width: 12 },
    { header: "Subgrupo", key: "subgroup", width: 18 },
    ...ACCESS_TYPES.map((type) => ({ header: type.label, key: type.key, width: 15 })),
    { header: "Total", key: "total", width: 12 },
  ];
  const summaryLastColumn = summary.columnCount;

  summary.mergeCells(1, 1, 1, summaryLastColumn);
  summary.getCell("A1").value = "Portal Saldo Estoque";
  summary.getCell("A1").font = { bold: true, size: 18 };
  summary.getCell("A2").value = `Gerado em ${formatDateTime(new Date())}`;
  summary.getCell("A2").font = { size: 10, color: { argb: "FF555555" } };
  const countCell = summary.getRow(2).getCell(summaryLastColumn);
  countCell.value = `${products.length} referencias`;
  countCell.alignment = { horizontal: "right" };
  countCell.font = { bold: true };

  styleExcelHeader(summary.getRow(4));

  let rowNumber = 5;
  for (const product of products) {
    const row = summary.getRow(rowNumber);
    row.height = 62;
    row.values = [
      "",
      product.reference,
      product.description,
      product.brand,
      product.collection,
      product.subgroup,
      ...ACCESS_TYPES.map((type) => (product.access?.[type.key] ? "Sim" : "—")),
      product.totalQuantity,
    ];
    styleExcelDataRow(row, rowNumber % 2 === 0);
    row.getCell(2).font = { bold: true };
    row.getCell(summaryLastColumn).font = { bold: true };
    row.getCell(summaryLastColumn).alignment = { horizontal: "right", vertical: "middle" };

    const image = await loadImage(firstImageUrl(product));
    if (image) {
      const imageId = workbook.addImage({ base64: image.base64, extension: "jpeg" });
      summary.addImage(imageId, {
        tl: { col: 0.2, row: rowNumber - 0.85 },
        ext: { width: 82, height: 58 },
        editAs: "oneCell",
      });
    } else {
      row.getCell(1).value = "Sem imagem";
      row.getCell(1).alignment = { horizontal: "center", vertical: "middle" };
      row.getCell(1).font = { color: { argb: "FF777777" }, italic: true };
    }

    row.commit();
    rowNumber += 1;
  }

  summary.autoFilter = {
    from: { row: 4, column: 1 },
    to: { row: 4, column: summaryLastColumn },
  };

  /* ---------- Aba 2: Estoque detalhado (uma linha por cor, colunas por tamanho) ---------- */
  const detail = workbook.addWorksheet("Estoque detalhado", {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  const sizes = allExportSizes(products);
  detail.columns = [
    { header: "Referência", key: "reference", width: 16 },
    { header: "Descrição", key: "description", width: 36 },
    { header: "Griffe", key: "brand", width: 16 },
    { header: "Coleção", key: "collection", width: 10 },
    { header: "Subgrupo", key: "subgroup", width: 18 },
    { header: "Cor", key: "color", width: 28 },
    ...sizes.map((size) => ({ header: size, key: `size-${size}`, width: 10 })),
    { header: "Total Cor", key: "colorTotal", width: 12 },
    { header: "Total Ref.", key: "productTotal", width: 12 },
  ];
  styleExcelHeader(detail.getRow(1));

  let detailRowNumber = 2;
  for (const product of products) {
    for (const color of product.colors) {
      const rowValues: Record<string, string | number> = {
        reference: product.reference,
        description: product.description,
        brand: product.brand,
        collection: product.collection,
        subgroup: product.subgroup,
        color: color.name,
        colorTotal: color.total,
        productTotal: product.totalQuantity,
      };
      for (const size of sizes) {
        const quantity = color.sizes[size] ?? 0;
        rowValues[`size-${size}`] = quantity > 0 ? quantity : "";
      }
      const row = detail.addRow(rowValues);
      styleExcelDataRow(row, detailRowNumber % 2 === 0);
      row.getCell(1).font = { bold: true };
      row.getCell(detail.columnCount - 1).font = { bold: true };
      row.getCell(detail.columnCount).font = { bold: true };
      detailRowNumber += 1;
    }
  }
  detail.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: detail.columnCount },
  };

  const buffer = await workbook.xlsx.writeBuffer();
  downloadBlob(
    new Blob([buffer as BlobPart], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    `portal-saldo-estoque-${Date.now()}.xlsx`,
  );
}
