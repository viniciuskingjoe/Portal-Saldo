// Tipos de politica comercial (B2B_POLITICA_COMERCIAL.TIPO_ACESSO). Fonte unica:
// dirige a query no servidor e os checkboxes no card. Adicionar tipo = 1 linha aqui.
export const ACCESS_TYPES = [
  { key: "funcionario", code: "F", label: "Funcionário" },
  { key: "representante", code: "R", label: "Representante" },
  { key: "atacado", code: "A", label: "Atacado" },
] as const;

export type AccessKey = (typeof ACCESS_TYPES)[number]["key"];

export interface ColorStock {
  code: string;
  description: string;
  name: string;
  total: number;
  sizes: Record<string, number>;
}

export interface Product {
  reference: string;
  description: string;
  subgroup: string;
  collection: string;
  brand: string;
  access: Record<AccessKey, boolean>;
  imageUrl?: string;
  totalQuantity: number;
  colors: ColorStock[];
}

export type ViewMode = "cards" | "table";

export type SortKey =
  | "stock_desc"
  | "stock_asc"
  | "ref_asc"
  | "ref_desc"
  | "desc_asc"
  | "collection"
  | "subgroup"
  | "brand";

export interface Filters {
  search: string;
  brands: string[];
  collections: string[];
  subgroups: string[];
  colors: string[];
}
