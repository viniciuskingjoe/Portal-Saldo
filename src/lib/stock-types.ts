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
