import type { AccessKey, Product, ProductImageInfo } from "@/lib/stock-types";
import { ACCESS_TYPES } from "@/lib/stock-types";

import { getSqlPool } from "./sql-server";
import { sqlIdentifier, sqlStringLiteral, sqlTableName, stockSqlSchema } from "./stock-schema";

function accessAlias(key: AccessKey): string {
  return `access_${key}`;
}

function emptyAccess(): Record<AccessKey, boolean> {
  return Object.fromEntries(ACCESS_TYPES.map((type) => [type.key, false])) as Record<
    AccessKey,
    boolean
  >;
}

type StockRow = {
  reference: unknown;
  description: unknown;
  subgroup: unknown;
  collection: unknown;
  brand: unknown;
  imageJson: unknown;
  grade: unknown;
  colorCode: unknown;
  colorDescription: unknown;
  sizes: unknown[];
  quantities: unknown[];
};

type StockApiPayload = {
  products: Product[];
  updatedAt: string;
};

type StockImageRow = {
  position?: unknown;
  image?: unknown;
};

function text(value: unknown, fallback = ""): string {
  if (value == null) return fallback;
  return String(value).trim() || fallback;
}

function number(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function stockColumn(name: keyof Omit<typeof stockSqlSchema.stockColumns, "quantities">): string {
  return `e.${sqlIdentifier(stockSqlSchema.stockColumns[name])}`;
}

function sizeColumn(index: number): string {
  return `t.${sqlIdentifier(stockSqlSchema.sizeColumns.sizes[index])}`;
}

function quantityColumn(index: number): string {
  return `e.${sqlIdentifier(stockSqlSchema.stockColumns.quantities[index])}`;
}

function imageUrl(value: unknown): string | undefined {
  const filename = text(value);
  if (!filename) return undefined;

  const baseUrl = stockSqlSchema.productImage.cloudFrontBaseUrl;
  const normalizedBaseUrl = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const cloudFrontHost = new URL(normalizedBaseUrl).hostname.toLowerCase();

  if (/^https?:\/\//i.test(filename)) {
    try {
      const parsed = new URL(filename);
      return parsed.hostname.toLowerCase() === cloudFrontHost ? parsed.toString() : undefined;
    } catch {
      return undefined;
    }
  }

  const imagePath = filename.replace(/^[\\/]+/, "").replace(/\\/g, "/");
  return new URL(imagePath, normalizedBaseUrl).toString();
}

function parseImageRows(value: unknown): StockImageRow[] {
  if (typeof value !== "string" || !value.trim()) return [];

  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? (parsed as StockImageRow[]) : [];
  } catch {
    return [];
  }
}

function addProductImage(product: Product, image: ProductImageInfo): void {
  if (product.images.some((item) => item.url === image.url)) return;
  product.images.push(image);
  product.imageUrl ??= image.url;
}

function buildAccessFlagColumn(accessCode: string, alias: string): string {
  const { accessPolicy } = stockSqlSchema;
  const product = sqlTableName(accessPolicy.productTable);
  const policy = sqlTableName(accessPolicy.policyTable);
  const col = accessPolicy.columns;

  // EXISTS evita multiplicar linhas do estoque quando o produto tem mais de uma politica.
  // COLLATE DATABASE_DEFAULT alinha collation entre os bancos no join cross-database.
  return `
      CASE WHEN EXISTS (
        SELECT 1
        FROM ${product} p
        JOIN ${policy} pc
          ON p.${sqlIdentifier(col.policyId)} = pc.${sqlIdentifier(col.policyId)}
        WHERE p.${sqlIdentifier(col.product)} COLLATE DATABASE_DEFAULT
            = ${stockColumn("reference")} COLLATE DATABASE_DEFAULT
          AND p.${sqlIdentifier(col.color)} COLLATE DATABASE_DEFAULT
            = ${stockColumn("colorCode")} COLLATE DATABASE_DEFAULT
          AND pc.${sqlIdentifier(col.accessType)} = ${sqlStringLiteral(accessCode)}
          AND pc.${sqlIdentifier(col.status)} = ${accessPolicy.activeStatus}
      ) THEN 1 ELSE 0 END AS ${sqlIdentifier(alias)}`;
}

function buildAccessFlagColumns(): string {
  return ACCESS_TYPES.map((type) => buildAccessFlagColumn(type.code, accessAlias(type.key))).join(
    ",\n      ",
  );
}

function buildImageApply(): string {
  const { productImage } = stockSqlSchema;
  const table = sqlTableName(productImage.table);
  const col = productImage.columns;

  return `
    OUTER APPLY (
      SELECT (
        SELECT
          img.${sqlIdentifier(col.position)} AS [position],
          img.${sqlIdentifier(col.image)} AS [image]
        FROM ${table} img
        WHERE img.${sqlIdentifier(col.product)} COLLATE DATABASE_DEFAULT
            = ${stockColumn("reference")} COLLATE DATABASE_DEFAULT
          AND img.${sqlIdentifier(col.color)} COLLATE DATABASE_DEFAULT
            = ${stockColumn("colorCode")} COLLATE DATABASE_DEFAULT
          AND NULLIF(LTRIM(RTRIM(img.${sqlIdentifier(col.image)})), '') IS NOT NULL
        ORDER BY
          CASE WHEN img.${sqlIdentifier(col.position)} = 1 THEN 0 ELSE 1 END,
          img.${sqlIdentifier(col.position)}
        FOR JSON PATH
      ) AS [imageJson]
    ) product_image`;
}

function buildStockQuery(): string {
  const quantityTotal = stockSqlSchema.stockColumns.quantities
    .map((_, index) => `ISNULL(${quantityColumn(index)}, 0)`)
    .join(" + ");
  const where = stockSqlSchema.onlyPositiveStock ? `WHERE (${quantityTotal}) > 0` : "";

  const sizeSelects = stockSqlSchema.sizeColumns.sizes
    .map((_, index) => `${sizeColumn(index)} AS [size${index + 1}]`)
    .join(",\n      ");
  const quantitySelects = stockSqlSchema.stockColumns.quantities
    .map((_, index) => `${quantityColumn(index)} AS [quantity${index + 1}]`)
    .join(",\n      ");

  return `
    SELECT TOP (${stockSqlSchema.maxRows})
      ${stockColumn("reference")} AS [reference],
      ${stockColumn("description")} AS [description],
      ${stockColumn("subgroup")} AS [subgroup],
      ${stockColumn("collection")} AS [collection],
      ${stockColumn("brand")} AS [brand],
      product_image.[imageJson] AS [imageJson],
      ${stockColumn("grade")} AS [grade],
      ${stockColumn("colorCode")} AS [colorCode],
      ${stockColumn("colorDescription")} AS [colorDescription],
      ${buildAccessFlagColumns()},
      ${sizeSelects},
      ${quantitySelects}
    FROM ${sqlTableName(stockSqlSchema.stockTable)} e
    LEFT JOIN ${sqlTableName(stockSqlSchema.sizeTable)} t
      ON t.${sqlIdentifier(stockSqlSchema.sizeColumns.grade)}
        = ${stockColumn("grade")}
    ${buildImageApply()}
    ${where}
    ORDER BY ${stockColumn("reference")}, ${stockColumn("colorCode")}
  `;
}

function colorName(code: string, description: string): string {
  if (code && description) return `${code} - ${description}`;
  return code || description || "Sem cor";
}

function rowSizes(row: Record<string, unknown>): unknown[] {
  return stockSqlSchema.sizeColumns.sizes.map((_, index) => row[`size${index + 1}`]);
}

function rowQuantities(row: Record<string, unknown>): unknown[] {
  return stockSqlSchema.stockColumns.quantities.map((_, index) => row[`quantity${index + 1}`]);
}

function mapRowsToProducts(rows: StockRow[]): Product[] {
  const products = new Map<string, Product>();

  for (const rawRow of rows) {
    const row = {
      ...rawRow,
      sizes: rowSizes(rawRow as Record<string, unknown>),
      quantities: rowQuantities(rawRow as Record<string, unknown>),
    };
    const reference = text(row.reference);
    if (!reference) continue;

    let product = products.get(reference);
    if (!product) {
      product = {
        reference,
        description: text(row.description, "Sem descricao"),
        subgroup: text(row.subgroup, "Sem subgrupo"),
        collection: text(row.collection, "Sem colecao"),
        brand: text(row.brand, "Sem griffe"),
        images: [],
        access: emptyAccess(),
        totalQuantity: 0,
        colors: [],
      };
      products.set(reference, product);
    }

    for (const type of ACCESS_TYPES) {
      if (number((rawRow as Record<string, unknown>)[accessAlias(type.key)]) === 1) {
        product.access[type.key] = true;
      }
    }

    const code = text(row.colorCode);
    const description = text(row.colorDescription);
    const name = colorName(code, description);
    let color = product.colors.find((item) => item.name === name);

    if (!color) {
      color = {
        code,
        description,
        name,
        total: 0,
        images: [],
        sizes: {},
      };
      product.colors.push(color);
    }

    for (const imageRow of parseImageRows(row.imageJson)) {
      const url = imageUrl(imageRow.image);
      if (!url) continue;

      const image: ProductImageInfo = {
        url,
        colorCode: code,
        colorDescription: description,
        colorName: name,
        position: number(imageRow.position),
      };

      if (!color.images.some((item) => item.url === image.url)) {
        color.images.push(image);
      }
      addProductImage(product, image);
    }

    for (let index = 0; index < row.quantities.length; index += 1) {
      const sizeName = text(row.sizes[index]);
      const quantity = Math.max(0, number(row.quantities[index]));

      if (!sizeName || quantity <= 0) continue;

      color.sizes[sizeName] = (color.sizes[sizeName] ?? 0) + quantity;
      color.total += quantity;
      product.totalQuantity += quantity;
    }
  }

  return [...products.values()]
    .map((product) => ({
      ...product,
      colors: product.colors.filter((color) => color.total > 0),
    }))
    .filter((product) => product.totalQuantity > 0 && product.colors.length > 0);
}

async function loadStockProducts(): Promise<Product[]> {
  const pool = await getSqlPool();
  const result = await pool.request().query<StockRow>(buildStockQuery());
  return mapRowsToProducts(result.recordset);
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
  });
}

export async function handleStockApiRequest(request: Request): Promise<Response | undefined> {
  const url = new URL(request.url);
  if (url.pathname !== "/api/stock") return undefined;

  if (request.method !== "GET") {
    return json({ message: "Metodo nao permitido." }, 405);
  }

  try {
    const payload: StockApiPayload = {
      products: await loadStockProducts(),
      updatedAt: new Date().toISOString(),
    };
    return json(payload);
  } catch (error) {
    console.error(error);
    return json(
      {
        message:
          error instanceof Error ? error.message : "Nao foi possivel consultar o SQL Server.",
      },
      500,
    );
  }
}
