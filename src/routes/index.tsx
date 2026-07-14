import { createFileRoute } from "@tanstack/react-router";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Filter,
  Grid3x3,
  ImageOff,
  LayoutList,
  Search,
  X,
} from "lucide-react";

import { Toaster } from "@/components/ui/sonner";
import type { Filters, Product, ProductImageInfo, SortKey, ViewMode } from "@/lib/stock-types";
import { ACCESS_TYPES } from "@/lib/stock-types";
import { formatNum, formatTime } from "@/lib/format";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Portal Saldo Estoque" },
      {
        name: "description",
        content:
          "Consulta interna de disponibilidade de produtos. Filtre por griffe, coleção, subgrupo, cor e tamanho.",
      },
    ],
  }),
  component: PortalPage,
});

const PAGE_SIZE_OPTIONS = [24, 48, 96];

const SORT_LABELS: Record<SortKey, string> = {
  stock_desc: "Maior estoque",
  stock_asc: "Menor estoque",
  ref_asc: "Referência A–Z",
  ref_desc: "Referência Z–A",
  desc_asc: "Descrição A–Z",
  collection: "Coleção",
  subgroup: "Subgrupo",
  brand: "Griffe",
};

const EMPTY_FILTERS: Filters = {
  search: "",
  brands: [],
  collections: [],
  subgroups: [],
  colors: [],
};

type FilterKey = "brands" | "collections" | "subgroups" | "colors";

const FILTERS: Array<{
  key: FilterKey;
  label: string;
  placeholder: string;
}> = [
  { key: "brands", label: "Griffe", placeholder: "Buscar griffe..." },
  { key: "collections", label: "Coleção", placeholder: "Buscar coleção..." },
  { key: "subgroups", label: "Subgrupo", placeholder: "Buscar subgrupo..." },
  { key: "colors", label: "Cor", placeholder: "Digite código ou descrição..." },
];

type StockApiResponse = {
  products: Product[];
  updatedAt: string;
};

function isStockApiResponse(value: unknown): value is StockApiResponse {
  if (value == null || typeof value !== "object") return false;
  const payload = value as Partial<StockApiResponse>;
  return Array.isArray(payload.products) && typeof payload.updatedAt === "string";
}

function parseApiDate(value: string): Date {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function sortProducts(items: Product[], sort: SortKey): Product[] {
  const arr = [...items];
  arr.sort((a, b) => {
    switch (sort) {
      case "stock_desc": return b.totalQuantity - a.totalQuantity;
      case "stock_asc": return a.totalQuantity - b.totalQuantity;
      case "ref_asc": return a.reference.localeCompare(b.reference);
      case "ref_desc": return b.reference.localeCompare(a.reference);
      case "desc_asc": return a.description.localeCompare(b.description);
      case "collection": return a.collection.localeCompare(b.collection);
      case "subgroup": return a.subgroup.localeCompare(b.subgroup);
      case "brand": return a.brand.localeCompare(b.brand);
    }
  });
  return arr;
}

function applyFilters(items: Product[], f: Filters): Product[] {
  const q = f.search.trim().toLowerCase();
  return items.filter((p) => {
    if (q && !p.reference.toLowerCase().includes(q) && !p.description.toLowerCase().includes(q))
      return false;
    if (f.brands.length && !f.brands.includes(p.brand)) return false;
    if (f.collections.length && !f.collections.includes(p.collection)) return false;
    if (f.subgroups.length && !f.subgroups.includes(p.subgroup)) return false;
    if (f.colors.length && !p.colors.some((c) => f.colors.includes(c.name))) return false;
    return true;
  });
}

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

function proxiedDisplayImageUrl(src?: string): string | undefined {
  const trimmed = src?.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith("/")) return trimmed;

  try {
    const parsed = new URL(trimmed);
    if (!["http:", "https:"].includes(parsed.protocol)) return trimmed;

    const host = parsed.hostname.toLowerCase();
    if (host === "localhost" || host === "127.0.0.1" || host === "::1") {
      return trimmed;
    }

    return `/api/image?url=${encodeURIComponent(parsed.toString())}`;
  } catch {
    return trimmed;
  }
}

function productImages(product: Product): ProductImageInfo[] {
  const images = Array.isArray(product.images)
    ? product.images.filter((image) => image.url.trim())
    : [];

  if (images.length) return images;

  return product.imageUrl
    ? [
        {
          url: product.imageUrl,
          colorCode: "",
          colorDescription: "",
          colorName: "",
          position: 1,
        },
      ]
    : [];
}

function imageLabel(image?: ProductImageInfo): string {
  if (!image) return "";
  return image.colorName || image.colorDescription || image.colorCode || "Imagem";
}

function PortalPage() {
  const resultsTopRef = useRef<HTMLDivElement | null>(null);
  const didRenderPageRef = useRef(false);
  const [allProducts, setAllProducts] = useState<Product[]>([]);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [searchInput, setSearchInput] = useState("");
  const [sort, setSort] = useState<SortKey>("stock_desc");
  const [view, setView] = useState<ViewMode>(() => {
    if (typeof window === "undefined") return "cards";
    return (localStorage.getItem("psv-view") as ViewMode) ?? "cards";
  });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(24);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [openFilter, setOpenFilter] = useState<FilterKey | null>(null);
  const [filterSearch, setFilterSearch] = useState("");
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [viewingImage, setViewingImage] = useState<{
    reference: string;
    index: number;
  } | null>(null);

  const loadStock = useCallback(async (silent = false) => {
    try {
      const response = await fetch("/api/stock", {
        headers: {
          accept: "application/json",
        },
      });
      const payload: unknown = await response.json().catch(() => null);

      if (!response.ok) {
        const message =
          payload != null && typeof payload === "object" && "message" in payload
            ? String((payload as { message?: unknown }).message)
            : "Nao foi possivel consultar o SQL Server.";
        throw new Error(message);
      }

      if (!isStockApiResponse(payload)) {
        throw new Error("A API de estoque retornou um formato inesperado.");
      }

      setAllProducts(payload.products);
      setLastUpdate(parseApiDate(payload.updatedAt));
      if (!silent) toast.success("Estoque atualizado.");
    } catch (error) {
      console.error(error);
      if (!silent) {
        toast.error(
          error instanceof Error
            ? error.message
            : "Nao foi possivel consultar o SQL Server.",
        );
      }
    }
  }, []);

  // Persist view
  useEffect(() => {
    localStorage.setItem("psv-view", view);
  }, [view]);

  useEffect(() => {
    if (!filtersOpen) {
      setOpenFilter(null);
      setFilterSearch("");
    }
  }, [filtersOpen]);

  useEffect(() => {
    if (!viewingImage) return;

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setViewingImage(null);
    };

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [viewingImage]);

  useEffect(() => {
    void loadStock(true);
  }, [loadStock]);

  // Debounce search
  useEffect(() => {
    const id = setTimeout(() => {
      setFilters((f) => ({ ...f, search: searchInput }));
      setPage(1);
    }, 400);
    return () => clearTimeout(id);
  }, [searchInput]);

  // Auto refresh every 30s
  useEffect(() => {
    const id = setInterval(() => {
      void loadStock(true);
    }, 30000);
    return () => clearInterval(id);
  }, [loadStock]);

  const refresh = () => {
    void loadStock();
  };
  const lastUpdateText = lastUpdate ? formatTime(lastUpdate) : "--:--:--";

  const products = allProducts;

  // Distinct filter options
  const opts = useMemo(() => {
    const brands = new Set<string>();
    const collections = new Set<string>();
    const subgroups = new Set<string>();
    const colors = new Set<string>();
    for (const p of products) {
      brands.add(p.brand);
      collections.add(p.collection);
      subgroups.add(p.subgroup);
      for (const c of p.colors) {
        colors.add(c.name);
      }
    }
    return {
      brands: [...brands].sort(),
      collections: [...collections].sort(),
      subgroups: [...subgroups].sort(),
      colors: [...colors].sort(),
    };
  }, [products]);

  const filtered = useMemo(() => applyFilters(products, filters), [products, filters]);
  const sorted = useMemo(() => sortProducts(filtered, sort), [filtered, sort]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageItems = sorted.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  useEffect(() => {
    if (page !== currentPage) setPage(currentPage);
  }, [currentPage, page]);

  useEffect(() => {
    if (!didRenderPageRef.current) {
      didRenderPageRef.current = true;
      return;
    }

    setExpandedRow(null);
    resultsTopRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [currentPage, pageSize]);

  // Dashboard
  const summary = useMemo(() => {
    const refs = filtered.length;
    let pieces = 0;
    const brandSet = new Set<string>();
    const colSet = new Set<string>();
    for (const p of filtered) {
      pieces += p.totalQuantity;
      brandSet.add(p.brand);
      colSet.add(p.collection);
    }
    return { refs, pieces, brands: brandSet.size, collections: colSet.size };
  }, [filtered]);

  const activeFilterCount =
    filters.brands.length +
    filters.collections.length +
    filters.subgroups.length +
    filters.colors.length;

  const toggleArr = (key: keyof Filters, val: string) => {
    setFilters((f) => {
      const arr = f[key] as string[];
      const next = arr.includes(val) ? arr.filter((x) => x !== val) : [...arr, val];
      return { ...f, [key]: next };
    });
    setPage(1);
  };

  const clearFilters = () => {
    setFilters(EMPTY_FILTERS);
    setSearchInput("");
    setPage(1);
  };

  const viewingImageProduct = products.find(
    (product) => product.reference === viewingImage?.reference,
  );

  return (
    <div className="min-h-screen bg-background pb-32">
      <Toaster position="top-right" />

      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto max-w-[1600px] px-4 py-4 sm:px-6">
          <div className="min-w-0">
            <h1 className="truncate text-xl font-extrabold tracking-tight sm:text-2xl">
              Portal Saldo Estoque
            </h1>
            <p className="truncate text-xs text-muted-foreground sm:text-sm">
              Consulta interna de disponibilidade
            </p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6">
        {/* Dashboard */}
        <section className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-5">
          <SummaryCard label="Peças" value={formatNum(summary.pieces)} />
          <SummaryCard label="Referências" value={formatNum(summary.refs)} />
          <SummaryCard label="Griffes" value={formatNum(summary.brands)} />
          <SummaryCard label="Coleções" value={formatNum(summary.collections)} />
          <SummaryCard
            label="Última atualização"
            value={lastUpdateText}
            small
          />
        </section>

        {/* Search */}
        <section className="mb-4">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-4 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Buscar por referência ou descrição..."
              className="w-full rounded-lg border border-border bg-card py-3 pr-10 pl-11 text-sm outline-none transition focus:border-foreground"
            />
            {searchInput && (
              <button
                onClick={() => setSearchInput("")}
                className="absolute top-1/2 right-3 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-muted"
                aria-label="Limpar busca"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </section>

        {/* Filters */}
        <section className="mb-4">
          <div className="flex items-center justify-between gap-2">
            <button
              onClick={() => setFiltersOpen((v) => !v)}
              className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm font-medium hover:bg-muted"
            >
              <Filter className="h-4 w-4" />
              Filtros
              {activeFilterCount > 0 && (
                <span className="ml-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground">
                  {activeFilterCount}
                </span>
              )}
              <ChevronDown
                className={`h-4 w-4 transition ${filtersOpen ? "rotate-180" : ""}`}
              />
            </button>
            {activeFilterCount > 0 && (
              <button
                onClick={clearFilters}
                className="text-xs text-muted-foreground underline-offset-4 hover:underline"
              >
                Limpar filtros
              </button>
            )}
          </div>

          {filtersOpen && (
            <div className="mt-3 rounded-lg border border-border bg-card p-3">
              <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
                {FILTERS.map((filter) => (
                  <FilterDropdown
                    key={filter.key}
                    label={filter.label}
                    options={opts[filter.key]}
                    selected={filters[filter.key]}
                    open={openFilter === filter.key}
                    search={openFilter === filter.key ? filterSearch : ""}
                    placeholder={filter.placeholder}
                    onOpenChange={(open) => {
                      setOpenFilter(open ? filter.key : null);
                      setFilterSearch("");
                    }}
                    onSearchChange={setFilterSearch}
                    onToggle={(value) => toggleArr(filter.key, value)}
                  />
                ))}
              </div>
            </div>
          )}

          {activeFilterCount > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {filters.brands.map((v) => (
                <Chip key={`b-${v}`} label={v} onRemove={() => toggleArr("brands", v)} />
              ))}
              {filters.collections.map((v) => (
                <Chip key={`c-${v}`} label={`Col. ${v}`} onRemove={() => toggleArr("collections", v)} />
              ))}
              {filters.subgroups.map((v) => (
                <Chip key={`s-${v}`} label={v} onRemove={() => toggleArr("subgroups", v)} />
              ))}
              {filters.colors.map((v) => (
                <Chip key={`co-${v}`} label={v} onRemove={() => toggleArr("colors", v)} />
              ))}
            </div>
          )}
        </section>

        {/* Toolbar */}
        <section className="mb-4 grid grid-cols-1 items-center gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
          <div className="text-sm text-muted-foreground">
            <span className="font-semibold text-foreground">
              {formatNum(summary.refs)} referências
            </span>{" "}
            · {formatNum(summary.pieces)} peças em estoque
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
              className="rounded-md border border-border bg-card px-3 py-2 text-xs font-medium outline-none focus:border-foreground sm:text-sm"
            >
              {Object.entries(SORT_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
            <div className="inline-flex overflow-hidden rounded-md border border-border">
              <button
                onClick={() => setView("cards")}
                className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition ${
                  view === "cards" ? "bg-primary text-primary-foreground" : "bg-card hover:bg-muted"
                }`}
              >
                <Grid3x3 className="h-3.5 w-3.5" /> Cards
              </button>
              <button
                onClick={() => setView("table")}
                className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition ${
                  view === "table" ? "bg-primary text-primary-foreground" : "bg-card hover:bg-muted"
                }`}
              >
                <LayoutList className="h-3.5 w-3.5" /> Tabela
              </button>
            </div>
          </div>
        </section>

        {/* Results */}
        <div ref={resultsTopRef} className="scroll-mt-28" />
        {pageItems.length === 0 ? (
          <EmptyState
            title={activeFilterCount || filters.search ? "Nenhuma referência encontrada." : "Nenhum produto disponível."}
            description={
              activeFilterCount || filters.search
                ? "Tente remover ou alterar alguns filtros."
                : "Não foram encontrados produtos com saldo para exibição."
            }
            action={
              activeFilterCount || filters.search ? (
                <button
                  onClick={clearFilters}
                  className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
                >
                  Limpar filtros
                </button>
              ) : (
                <button
                  onClick={refresh}
                  className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
                >
                  Atualizar novamente
                </button>
              )
            }
          />
        ) : view === "cards" ? (
          <div className="space-y-4">
            {pageItems.map((p) => (
              <ProductCard
                key={p.reference}
                product={p}
                onViewImage={(index) => setViewingImage({ reference: p.reference, index })}
              />
            ))}
          </div>
        ) : (
          <ProductTable
            items={pageItems}
            expandedRow={expandedRow}
            setExpandedRow={setExpandedRow}
            onViewImage={(reference, index) => {
              const product = products.find((item) => item.reference === reference);
              if (product && productImages(product).length > 0) {
                setViewingImage({ reference, index });
              }
            }}
          />
        )}

        {/* Pagination */}
        {sorted.length > 0 && (
          <div className="mt-6 grid grid-cols-1 items-center gap-3 sm:grid-cols-[auto_minmax(0,1fr)_auto]">
            <div className="text-xs text-muted-foreground">
              Página {currentPage} de {totalPages}
            </div>
            <div className="flex items-center justify-center gap-1">
              <button
                disabled={currentPage === 1}
                onClick={() => setPage(Math.max(1, currentPage - 1))}
                className="rounded-md border border-border px-3 py-1.5 text-xs disabled:opacity-40"
              >
                Anterior
              </button>
              <button
                disabled={currentPage === totalPages}
                onClick={() => setPage(Math.min(totalPages, currentPage + 1))}
                className="rounded-md border border-border px-3 py-1.5 text-xs disabled:opacity-40"
              >
                Próxima
              </button>
            </div>
            <div className="flex items-center justify-end gap-2 text-xs">
              <span className="text-muted-foreground">Por página:</span>
              <select
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setPage(1);
                }}
                className="rounded-md border border-border bg-card px-2 py-1 text-xs"
              >
                {PAGE_SIZE_OPTIONS.map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </div>
          </div>
        )}
      </main>

      {viewingImageProduct && productImages(viewingImageProduct).length > 0 && (
        <ProductImageViewerDialog
          product={viewingImageProduct}
          initialIndex={viewingImage?.index ?? 0}
          onClose={() => setViewingImage(null)}
        />
      )}
    </div>
  );
}

/* ---------- subcomponents ---------- */

function SummaryCard({ label, value, small }: { label: string; value: string; small?: boolean }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
        {label}
      </div>
      <div className={`mt-1 font-extrabold ${small ? "text-lg" : "text-2xl"}`}>{value}</div>
    </div>
  );
}

function Chip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <button
      onClick={onRemove}
      className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:opacity-90"
    >
      {label}
      <X className="h-3 w-3" />
    </button>
  );
}

function FilterDropdown({
  label,
  options,
  selected,
  open,
  search,
  placeholder,
  onOpenChange,
  onSearchChange,
  onToggle,
}: {
  label: string;
  options: string[];
  selected: string[];
  open: boolean;
  search: string;
  placeholder: string;
  onOpenChange: (open: boolean) => void;
  onSearchChange: (value: string) => void;
  onToggle: (v: string) => void;
}) {
  const normalizedSearch = search.trim().toLowerCase();
  const filteredOptions = normalizedSearch
    ? options.filter((option) => option.toLowerCase().includes(normalizedSearch))
    : options;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        className={`flex h-10 w-full items-center justify-between gap-2 rounded-md border px-3 text-sm font-medium transition ${
          open ? "border-foreground bg-background" : "border-border bg-background hover:bg-muted"
        }`}
      >
        <span className="truncate">{label}</span>
        <span className="flex items-center gap-2">
          {selected.length > 0 && (
            <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground">
              {selected.length}
            </span>
          )}
          <ChevronDown className={`h-4 w-4 transition ${open ? "rotate-180" : ""}`} />
        </span>
      </button>

      {open && (
        <div className="absolute left-0 z-40 mt-1 w-full min-w-72 rounded-md border border-border bg-background shadow-lg">
          <div className="relative border-b border-border">
            <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder={placeholder}
              autoFocus
              className="h-10 w-full rounded-t-md bg-background pr-3 pl-9 text-sm outline-none"
            />
          </div>

          <div className="max-h-72 overflow-y-auto p-1">
            {filteredOptions.map((option) => {
              const on = selected.includes(option);
              return (
                <button
                  type="button"
                  key={option}
                  onClick={() => onToggle(option)}
                  className={`flex w-full items-center gap-2 rounded px-2 py-2 text-left text-sm transition ${
                    on ? "bg-muted font-semibold" : "hover:bg-muted"
                  }`}
                >
                  <span
                    className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                      on ? "border-foreground bg-primary text-primary-foreground" : "border-border"
                    }`}
                  >
                    {on && <Check className="h-3 w-3" />}
                  </span>
                  <span className="truncate">{option}</span>
                </button>
              );
            })}
            {filteredOptions.length === 0 && (
              <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                Nenhum resultado
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ProductImage({
  src,
  alt,
  className,
  flush = false,
  fit = "cover",
}: {
  src?: string;
  alt: string;
  className?: string;
  flush?: boolean;
  fit?: "cover" | "contain";
}) {
  const [failed, setFailed] = useState(false);
  const displaySrc = proxiedDisplayImageUrl(src);

  useEffect(() => {
    setFailed(false);
  }, [displaySrc]);

  if (!displaySrc || failed) {
    return (
      <div
        className={`flex items-center justify-center bg-muted text-muted-foreground ${
          flush ? "" : "rounded-md border border-dashed border-border"
        } ${className ?? ""}`}
      >
        <ImageOff className="h-5 w-5" />
      </div>
    );
  }

  return (
    <img
      src={displaySrc}
      alt={alt}
      loading="lazy"
      onError={() => setFailed(true)}
      className={`${flush ? "" : "rounded-md"} ${
        fit === "contain" ? "object-contain" : "object-cover"
      } ${className ?? ""}`}
    />
  );
}

function ProductImageViewerDialog({
  product,
  initialIndex,
  onClose,
}: {
  product: Product;
  initialIndex: number;
  onClose: () => void;
}) {
  const images = productImages(product);
  const [imageIndex, setImageIndex] = useState(initialIndex);
  const currentIndex = Math.min(Math.max(imageIndex, 0), Math.max(images.length - 1, 0));
  const currentImage = images[currentIndex];
  const hasMultipleImages = images.length > 1;

  useEffect(() => {
    setImageIndex(initialIndex);
  }, [initialIndex, product.reference]);

  const moveImage = (direction: -1 | 1) => {
    if (!hasMultipleImages) return;
    setImageIndex((current) => (current + direction + images.length) % images.length);
  };

  if (!currentImage) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-lg border border-border bg-background shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-border p-4">
          <div className="min-w-0">
            <h2 className="truncate text-base font-extrabold">{product.reference}</h2>
            <p className="truncate text-sm text-muted-foreground">{product.description}</p>
            <div className="mt-1 flex flex-wrap gap-1.5 text-[11px] font-medium">
              <span className="rounded bg-primary px-1.5 py-0.5 text-primary-foreground">
                {product.brand}
              </span>
              <span className="rounded border border-border px-1.5 py-0.5">
                Col. {product.collection}
              </span>
              <span className="rounded border border-border px-1.5 py-0.5">
                {product.subgroup}
              </span>
              {imageLabel(currentImage) && (
                <span className="rounded border border-border px-1.5 py-0.5">
                  {imageLabel(currentImage)}
                </span>
              )}
              {hasMultipleImages && (
                <span className="rounded border border-border px-1.5 py-0.5 tabular-nums">
                  {currentIndex + 1}/{images.length}
                </span>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Fechar imagem"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="relative flex min-h-0 flex-1 items-center justify-center bg-muted">
          <ProductImage
            src={currentImage.url}
            alt={product.reference}
            flush
            fit="contain"
            className="h-[72vh] w-full"
          />
          {hasMultipleImages && (
            <>
              <button
                type="button"
                onClick={() => moveImage(-1)}
                className="absolute top-1/2 left-4 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-background/90 text-foreground shadow hover:bg-background"
                aria-label="Imagem anterior"
              >
                <ChevronLeft className="h-6 w-6" />
              </button>
              <button
                type="button"
                onClick={() => moveImage(1)}
                className="absolute top-1/2 right-4 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-background/90 text-foreground shadow hover:bg-background"
                aria-label="Próxima imagem"
              >
                <ChevronRight className="h-6 w-6" />
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function ProductCard({
  product,
  onViewImage,
}: {
  product: Product;
  onViewImage: (index: number) => void;
}) {
  const allSizes = useMemo(() => availableSizes(product), [product]);
  const images = productImages(product);
  const [imageIndex, setImageIndex] = useState(0);
  const currentIndex = Math.min(Math.max(imageIndex, 0), Math.max(images.length - 1, 0));
  const currentImage = images[currentIndex];
  const hasMultipleImages = images.length > 1;

  useEffect(() => {
    setImageIndex(0);
  }, [product.reference, images.length]);

  const moveImage = (direction: -1 | 1) => {
    if (!hasMultipleImages) return;
    setImageIndex((current) => (current + direction + images.length) % images.length);
  };

  return (
    <article className="overflow-hidden rounded-lg border border-border bg-card transition">
      <div className="grid grid-cols-1 md:h-[340px] md:grid-cols-[220px_minmax(0,1fr)]">
        <div className="relative h-64 bg-muted md:h-full">
          <button
            type="button"
            onClick={() => onViewImage(currentIndex)}
            disabled={!currentImage}
            className={`block h-full w-full ${
              currentImage ? "cursor-zoom-in" : "cursor-default"
            }`}
            aria-label={
              currentImage
                ? `Ampliar imagem de ${product.reference}`
                : `Produto ${product.reference} sem imagem`
            }
          >
            <ProductImage
              src={currentImage?.url}
              alt={product.reference}
              flush
              fit="contain"
              className="h-full w-full"
            />
          </button>
          {hasMultipleImages && (
            <>
              <button
                type="button"
                onClick={() => moveImage(-1)}
                className="absolute top-1/2 left-2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-background/90 text-foreground shadow hover:bg-background"
                aria-label="Imagem anterior"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <button
                type="button"
                onClick={() => moveImage(1)}
                className="absolute top-1/2 right-2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-background/90 text-foreground shadow hover:bg-background"
                aria-label="Próxima imagem"
              >
                <ChevronRight className="h-5 w-5" />
              </button>
              <div className="pointer-events-none absolute right-2 bottom-2 left-2 flex items-end justify-between gap-2">
                <span className="min-w-0 truncate rounded bg-background/90 px-2 py-1 text-[11px] font-semibold text-foreground shadow">
                  {imageLabel(currentImage)}
                </span>
                <span className="shrink-0 rounded bg-background/90 px-2 py-1 text-[11px] font-semibold tabular-nums text-foreground shadow">
                  {currentIndex + 1}/{images.length}
                </span>
              </div>
            </>
          )}
        </div>

        <div className="flex min-h-0 min-w-0 flex-col gap-3 p-4 sm:p-5">
          <div className="grid shrink-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-4">
            <div className="min-w-0">
              <h3 className="text-lg font-extrabold tracking-tight">{product.reference}</h3>
              <p className="truncate text-sm text-muted-foreground">{product.description}</p>
              <div className="mt-1 flex flex-wrap gap-1.5 text-[11px] font-medium">
                <span className="rounded bg-primary px-1.5 py-0.5 text-primary-foreground">
                  {product.brand}
                </span>
                <span className="rounded border border-border px-1.5 py-0.5">
                  Col. {product.collection}
                </span>
                <span className="rounded border border-border px-1.5 py-0.5">
                  {product.subgroup}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                {ACCESS_TYPES.map((type) => (
                  <label
                    key={type.key}
                    className="inline-flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground"
                  >
                    <input
                      type="checkbox"
                      checked={product.access[type.key]}
                      readOnly
                      className="pointer-events-none h-3.5 w-3.5 accent-black"
                      aria-label={`Produto ${
                        product.access[type.key] ? "" : "nao "
                      }disponivel para ${type.label}`}
                    />
                    {type.label}
                  </label>
                ))}
              </div>
            </div>
            <div className="shrink-0 text-right">
              <div className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
                Total
              </div>
              <div className="text-2xl font-extrabold leading-none">
                {formatNum(product.totalQuantity)}
              </div>
              <div className="text-[10px] text-muted-foreground">peças</div>
            </div>
          </div>

          <div className="-mx-1 min-h-0 flex-1 overflow-auto pr-1">
            <table className="w-full min-w-max text-xs">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="px-2 py-1.5 font-semibold">Cor</th>
                  {allSizes.map((s) => (
                    <th key={s} className="px-2 py-1.5 text-right font-semibold">{s}</th>
                  ))}
                  <th className="px-2 py-1.5 text-right font-semibold">Total</th>
                </tr>
              </thead>
              <tbody>
                {product.colors.map((c) => (
                  <tr key={c.name} className="border-b border-border/60 last:border-0">
                    <td className="px-2 py-1.5 font-medium">{c.name}</td>
                    {allSizes.map((s) => (
                      <td key={s} className="px-2 py-1.5 text-right tabular-nums">
                        {c.sizes[s] ?? 0}
                      </td>
                    ))}
                    <td className="px-2 py-1.5 text-right font-bold tabular-nums">
                      {c.total}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

        </div>
      </div>
    </article>
  );
}

function ProductTable({
  items,
  expandedRow,
  setExpandedRow,
  onViewImage,
}: {
  items: Product[];
  expandedRow: string | null;
  setExpandedRow: (r: string | null) => void;
  onViewImage: (ref: string, index: number) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <table className="w-full min-w-[860px] text-sm">
        <thead className="bg-muted text-xs uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="w-8 p-3"></th>
            <th className="w-24 p-3 text-left font-semibold">Imagem</th>
            <th className="p-3 text-left font-semibold">Referência</th>
            <th className="p-3 text-left font-semibold">Descrição</th>
            <th className="p-3 text-left font-semibold">Griffe</th>
            <th className="p-3 text-left font-semibold">Col.</th>
            <th className="p-3 text-left font-semibold">Subgrupo</th>
            <th className="p-3 text-right font-semibold">Total</th>
          </tr>
        </thead>
        <tbody>
          {items.map((p) => {
            const expanded = expandedRow === p.reference;
            const allSizes = availableSizes(p);
            const images = productImages(p);
            const thumbnail = images[0];
            const extraImages = Math.max(0, images.length - 1);
            return (
              <Fragment key={p.reference}>
                <tr className="border-t border-border">
                  <td className="p-3">
                    <button
                      onClick={() => setExpandedRow(expanded ? null : p.reference)}
                      aria-label="Expandir"
                      className="text-muted-foreground hover:text-foreground"
                    >
                      {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    </button>
                  </td>
                  <td className="p-3">
                    <button
                      type="button"
                      onClick={() => onViewImage(p.reference, 0)}
                      disabled={!thumbnail}
                      className={`relative block ${thumbnail ? "cursor-zoom-in" : "cursor-default"}`}
                      aria-label={
                        thumbnail
                          ? `Ampliar imagem de ${p.reference}`
                          : `Produto ${p.reference} sem imagem`
                      }
                    >
                      <ProductImage
                        src={thumbnail?.url}
                        alt={p.reference}
                        className="h-12 w-12"
                      />
                      {extraImages > 0 && (
                        <span className="absolute -right-1 -bottom-1 rounded bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground shadow">
                          +{extraImages}
                        </span>
                      )}
                    </button>
                  </td>
                  <td className="p-3 font-bold">{p.reference}</td>
                  <td className="p-3 text-muted-foreground">{p.description}</td>
                  <td className="p-3">{p.brand}</td>
                  <td className="p-3">{p.collection}</td>
                  <td className="p-3">{p.subgroup}</td>
                  <td className="p-3 text-right font-bold tabular-nums">
                    {formatNum(p.totalQuantity)}
                  </td>
                </tr>
                {expanded && (
                  <tr className="border-t border-border bg-muted/30">
                    <td colSpan={8} className="p-4">
                      <div className="overflow-x-auto">
                        <table className="w-full min-w-max text-xs">
                          <thead>
                            <tr className="border-b border-border text-muted-foreground">
                              <th className="px-2 py-1.5 text-left font-semibold">Cor</th>
                              {allSizes.map((s) => (
                                <th key={s} className="px-2 py-1.5 text-right font-semibold">{s}</th>
                              ))}
                              <th className="px-2 py-1.5 text-right font-semibold">Total</th>
                            </tr>
                          </thead>
                          <tbody>
                            {p.colors.map((c) => (
                              <tr key={c.name} className="border-b border-border/60 last:border-0">
                                <td className="px-2 py-1.5 font-medium">{c.name}</td>
                                {allSizes.map((s) => (
                                  <td key={s} className="px-2 py-1.5 text-right tabular-nums">
                                    {c.sizes[s] ?? 0}
                                  </td>
                                ))}
                                <td className="px-2 py-1.5 text-right font-bold tabular-nums">
                                  {c.total}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-card px-6 py-16 text-center">
      <h3 className="text-lg font-bold">{title}</h3>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">{description}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

