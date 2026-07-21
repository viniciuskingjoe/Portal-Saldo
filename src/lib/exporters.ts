import type { Row, Workbook, Worksheet } from "exceljs";
import type { Product } from "./stock-types";
import { ACCESS_TYPES } from "./stock-types";
import { formatDateTime } from "./format";
import {
  compareSizes,
  productSizeFamily,
  SIZE_FAMILY_LABELS,
  SIZE_FAMILY_ORDER,
  type SizeFamily,
} from "./sizes";

type ExcelJsRuntime = typeof import("exceljs") & {
  default?: typeof import("exceljs");
};

const INK = "FF1A1A1A";
const ACCENT = "FF3F8AE0";
const GRID = "FFE3E6EA";
const STRIPE = "FFF6F8FA";
const TOTAL_FILL = "FFEFF4FB";
const MUTED = "FF8A8A8A";
const YES = "FF1E7A34";

function sizesWithStock(product: Product): string[] {
  const sizes = new Set<string>();
  for (const color of product.colors) {
    for (const [size, quantity] of Object.entries(color.sizes)) {
      if (size.trim() && quantity > 0) sizes.add(size);
    }
  }
  return [...sizes];
}

function allExportSizes(products: Product[]): string[] {
  const sizes = new Set<string>();
  for (const product of products) {
    for (const size of sizesWithStock(product)) sizes.add(size);
  }
  return [...sizes].sort(compareSizes);
}

/** Agrupa produtos pela grade (parte de cima / baixo / play) para virar abas. */
function groupByFamily(products: Product[]): Map<SizeFamily, Product[]> {
  const groups = new Map<SizeFamily, Product[]>();
  for (const product of products) {
    const family = productSizeFamily(sizesWithStock(product));
    const list = groups.get(family) ?? [];
    list.push(product);
    groups.set(family, list);
  }
  return groups;
}

function border(color = GRID, style: "thin" | "medium" = "thin") {
  return {
    top: { style, color: { argb: color } },
    left: { style, color: { argb: color } },
    bottom: { style, color: { argb: color } },
    right: { style, color: { argb: color } },
  };
}

function fill(argb: string) {
  return { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb } };
}

function styleHeaderRow(row: Row) {
  row.height = 28;
  row.eachCell({ includeEmpty: true }, (cell) => {
    cell.font = { bold: true, size: 10, color: { argb: "FFFFFFFF" } };
    cell.fill = fill(INK);
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    cell.border = border(INK);
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

/** Monta uma aba com os produtos de uma familia de grade. */
function buildSheet(workbook: Workbook, sheetName: string, products: Product[], subtitle: string) {
  const sizes = allExportSizes(products);

  const COL_REFERENCE = 1;
  const COL_DESCRIPTION = 2;
  const COL_COLLECTION = 3;
  const COL_COLOR = 4;
  const COL_SIZE_FIRST = 5;
  const COL_TOTAL = COL_SIZE_FIRST + sizes.length;
  const COL_ACCESS_FIRST = COL_TOTAL + 1;
  const COL_LAST = COL_ACCESS_FIRST + ACCESS_TYPES.length - 1;

  const sheet: Worksheet = workbook.addWorksheet(sheetName, {
    views: [{ state: "frozen", xSplit: 1, ySplit: 5 }],
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });

  sheet.columns = [
    { key: "reference", width: 16 },
    { key: "description", width: 42 },
    { key: "collection", width: 10 },
    { key: "color", width: 26 },
    ...sizes.map((size) => ({ key: `size-${size}`, width: 6.5 })),
    { key: "total", width: 10 },
    ...ACCESS_TYPES.map((type) => ({ key: type.key, width: 14 })),
  ];

  /* Faixa de titulo */
  sheet.mergeCells(1, 1, 1, COL_LAST);
  const titleCell = sheet.getCell(1, 1);
  titleCell.value = "  Portal Saldo Estoque";
  titleCell.font = { bold: true, size: 15, color: { argb: "FFFFFFFF" } };
  titleCell.fill = fill(INK);
  titleCell.alignment = { vertical: "middle" };
  sheet.getRow(1).height = 30;

  sheet.mergeCells(2, 1, 2, COL_LAST);
  const subtitleCell = sheet.getCell(2, 1);
  subtitleCell.value = `  ${subtitle}`;
  subtitleCell.font = { bold: true, size: 10, color: { argb: "FFFFFFFF" } };
  subtitleCell.fill = fill(ACCENT);
  subtitleCell.alignment = { vertical: "middle" };
  sheet.getRow(2).height = 20;

  sheet.mergeCells(3, 1, 3, 4);
  const dateCell = sheet.getCell(3, 1);
  dateCell.value = `Gerado em ${formatDateTime(new Date())}`;
  dateCell.font = { size: 9, color: { argb: MUTED } };
  dateCell.alignment = { vertical: "middle" };

  sheet.mergeCells(3, COL_TOTAL, 3, COL_LAST);
  const countCell = sheet.getCell(3, COL_TOTAL);
  const pieces = products.reduce((sum, p) => sum + p.totalQuantity, 0);
  countCell.value = `${products.length} ref. · ${pieces.toLocaleString("pt-BR")} peças`;
  countCell.font = { bold: true, size: 9 };
  countCell.alignment = { horizontal: "right", vertical: "middle" };
  sheet.getRow(3).height = 18;

  /* Cabecalho na linha 5 (rotulos escritos explicitamente) */
  const headerRow = sheet.getRow(5);
  headerRow.getCell(COL_REFERENCE).value = "Referência";
  headerRow.getCell(COL_DESCRIPTION).value = "Descrição";
  headerRow.getCell(COL_COLLECTION).value = "Coleção";
  headerRow.getCell(COL_COLOR).value = "Cor";
  sizes.forEach((size, index) => {
    headerRow.getCell(COL_SIZE_FIRST + index).value = size;
  });
  headerRow.getCell(COL_TOTAL).value = "Total";
  ACCESS_TYPES.forEach((type, index) => {
    headerRow.getCell(COL_ACCESS_FIRST + index).value = type.label;
  });
  styleHeaderRow(headerRow);
  for (const col of [COL_REFERENCE, COL_DESCRIPTION, COL_COLOR]) {
    headerRow.getCell(col).alignment = { vertical: "middle", horizontal: "left" };
  }
  headerRow.commit();

  /* Dados: uma linha por cor, bloco mesclado por produto */
  let rowNumber = 6;
  let productIndex = 0;

  for (const product of products) {
    const colors = product.colors.length ? product.colors : [null];
    const blockStart = rowNumber;
    const striped = productIndex % 2 === 1;

    for (const color of colors) {
      const row = sheet.getRow(rowNumber);
      row.height = 19;

      row.getCell(COL_REFERENCE).value = product.reference;
      row.getCell(COL_DESCRIPTION).value = product.description;
      row.getCell(COL_COLLECTION).value = product.collection;
      row.getCell(COL_COLOR).value = color ? color.name : "—";

      sizes.forEach((size, index) => {
        const quantity = color?.sizes[size] ?? 0;
        row.getCell(COL_SIZE_FIRST + index).value = quantity > 0 ? quantity : null;
      });
      row.getCell(COL_TOTAL).value = color ? color.total : 0;

      ACCESS_TYPES.forEach((type, index) => {
        row.getCell(COL_ACCESS_FIRST + index).value = product.access?.[type.key] ? "Sim" : "—";
      });

      for (let col = COL_REFERENCE; col <= COL_LAST; col += 1) {
        const cell = row.getCell(col);
        cell.border = border();
        if (striped) cell.fill = fill(STRIPE);

        if (col === COL_REFERENCE) {
          cell.font = { bold: true, size: 10 };
          cell.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
        } else if (col === COL_DESCRIPTION || col === COL_COLOR) {
          cell.font = { size: 10 };
          cell.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
        } else if (col === COL_COLLECTION) {
          cell.font = { size: 10, color: { argb: MUTED } };
          cell.alignment = { vertical: "middle", horizontal: "center" };
        } else if (col === COL_TOTAL) {
          cell.font = { bold: true, size: 10 };
          cell.alignment = { vertical: "middle", horizontal: "center" };
          cell.numFmt = "#,##0";
          cell.fill = fill(TOTAL_FILL);
        } else if (col >= COL_ACCESS_FIRST) {
          const isYes = cell.value === "Sim";
          cell.font = { size: 10, bold: isYes, color: { argb: isYes ? YES : MUTED } };
          cell.alignment = { vertical: "middle", horizontal: "center" };
        } else {
          cell.font = { size: 10 };
          cell.alignment = { vertical: "middle", horizontal: "center" };
          cell.numFmt = "#,##0";
        }
      }

      rowNumber += 1;
    }

    const blockEnd = rowNumber - 1;

    // Dados do produto (nao da cor) ficam mesclados no bloco
    if (blockEnd > blockStart) {
      const mergeCols = [
        COL_REFERENCE,
        COL_DESCRIPTION,
        COL_COLLECTION,
        ...ACCESS_TYPES.map((_, index) => COL_ACCESS_FIRST + index),
      ];
      for (const col of mergeCols) {
        sheet.mergeCells(blockStart, col, blockEnd, col);
        sheet.getCell(blockStart, col).alignment = {
          vertical: "middle",
          horizontal: col === COL_DESCRIPTION || col === COL_REFERENCE ? "left" : "center",
          indent: col === COL_DESCRIPTION || col === COL_REFERENCE ? 1 : 0,
          wrapText: col === COL_DESCRIPTION,
        };
      }
    }

    // Divisoria entre produtos
    for (let col = COL_REFERENCE; col <= COL_LAST; col += 1) {
      const cell = sheet.getCell(blockEnd, col);
      cell.border = { ...border(), bottom: { style: "medium", color: { argb: "FFB9C2CC" } } };
    }

    productIndex += 1;
  }
}

export async function exportToExcel(products: Product[]) {
  const ExcelJS = (await import("exceljs")) as ExcelJsRuntime;
  const WorkbookCtor = ExcelJS.Workbook ?? ExcelJS.default?.Workbook;
  if (!WorkbookCtor) throw new Error("Nao foi possivel carregar o gerador de Excel.");

  const workbook = new WorkbookCtor();
  workbook.creator = "Portal Saldo Estoque";
  workbook.created = new Date();

  // Uma aba por familia de grade: evita planilha larguissima misturando
  // 01-18, 38-50 e P-XXG na mesma tabela.
  const groups = groupByFamily(products);
  for (const family of SIZE_FAMILY_ORDER) {
    const list = groups.get(family);
    if (!list?.length) continue;
    buildSheet(workbook, SIZE_FAMILY_LABELS[family], list, SIZE_FAMILY_LABELS[family]);
  }

  if (workbook.worksheets.length === 0) {
    buildSheet(workbook, "Saldo de Estoque", products, "Saldo de estoque");
  }

  const buffer = await workbook.xlsx.writeBuffer();
  downloadBlob(
    new Blob([buffer as BlobPart], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    `portal-saldo-estoque-${Date.now()}.xlsx`,
  );
}
