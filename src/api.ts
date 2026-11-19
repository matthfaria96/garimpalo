import type { CatalogTheme } from "./catalog/render";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";

export const MAX_PHOTOS = 3;

export type Quad = [[number, number], [number, number], [number, number], [number, number]];

export interface Edits {
  rotate: number;
  cropMode: "rect" | "perspective" | "";
  /** cantos TL, TR, BR, BL de 0 a 1 (na imagem já girada); null = imagem inteira */
  quad: Quad | null;
  brightness: number;
  contrast: number;
  saturation: number;
  vibrance: number;
  temperature: number;
  sharpness: number;
  /** como a foto ocupa o quadro: preencher (padrão) ou inteira com fundo desfocado */
  fit?: Fit;
}

/** Nunca há faixas brancas/pretas: ou a foto preenche o quadro, ou fica inteira sobre um blur dela mesma. */
export type Fit = "cover" | "blur";

export const NEUTRAL_EDITS: Edits = {
  rotate: 0,
  cropMode: "rect",
  quad: null,
  brightness: 0,
  contrast: 0,
  saturation: 0,
  vibrance: 0,
  temperature: 0,
  sharpness: 0,
  fit: "cover",
};

export const photoFit = (p?: Photo | null): Fit => (p?.edits?.fit === "blur" ? "blur" : "cover");
export const coverFit = (car: { photos?: Photo[] }): Fit => photoFit(car.photos?.[0]);

export interface Photo {
  /** foto final (WebP) */
  file: string;
  /** original otimizado, base para reeditar */
  original: string;
  edits: Edits;
}

export interface Processed {
  photo: Photo;
  bytesIn: number;
  bytesOut: number;
  width: number;
  height: number;
}

export interface PhotoProgress {
  token: string;
  stage: "reading" | "original" | "compressing" | "done";
}

export interface Car {
  id: string;
  collection: string;
  name: string;
  description: string;
  quantity: number;
  acquiredAt: string | null;
  /** centavos, por unidade */
  acquisitionPrice: number | null;
  /** centavos */
  salePrice: number | null;
  /** centavos */
  promoPrice: number | null;
  /** capa (= primeira foto) */
  imageFile: string | null;
  photos: Photo[];
  createdAt: string;
  updatedAt: string;
}

export type CarInput = Omit<Car, "id" | "createdAt" | "updatedAt" | "collection" | "imageFile"> & {
  id?: string;
  collection?: string;
};

export interface CollectionStats {
  collection: string;
  models: number;
  units: number;
  invested: number;
  forSaleValue: number;
  coverImage: string | null;
}

export interface Settings {
  catalogTitle?: string;
  catalogSubtitle?: string;
  catalogFooter?: string;
  /** número do WhatsApp mostrado no botão do catálogo */
  catalogPhone?: string;
  perPage?: 1 | 4 | 9 | 16;
  /** visual do catálogo: claro (padrão) ou escuro */
  catalogTheme?: CatalogTheme;
  lastCatalogDir?: string;
}

export interface SaleItem {
  carId: string | null;
  name: string;
  imageFile: string | null;
  quantity: number;
  /** valor combinado por unidade, em centavos */
  unitPrice: number;
}

export interface Sale {
  id: string;
  buyer: string;
  contact: string;
  notes: string;
  /** total cobrado, em centavos */
  total: number;
  items: SaleItem[];
  createdAt: string;
}

export interface SaleInput {
  buyer: string;
  contact: string;
  notes: string;
  total: number | null;
  items: { carId: string; quantity: number; unitPrice: number }[];
  updateStock: boolean;
}

let imagesDir: string | null = null;

export async function initApi() {
  imagesDir = await invoke<string>("images_dir");
}

export function imageUrl(file: string | null | undefined): string | null {
  if (!file || !imagesDir) return null;
  const sep = imagesDir.includes("\\") ? "\\" : "/";
  return convertFileSrc(`${imagesDir}${sep}${file}`);
}

export const api = {
  listCars: (collection = "hotwheels") => invoke<Car[]>("list_cars", { collection }),
  saveCar: (car: CarInput) => invoke<Car>("save_car", { car }),
  updatePrices: (id: string, salePrice: number | null, promoPrice: number | null) =>
    invoke<void>("update_prices", { id, salePrice, promoPrice }),
  updateQuantity: (id: string, quantity: number) =>
    invoke<void>("update_quantity", { id, quantity }),
  deleteCar: (id: string) => invoke<void>("delete_car", { id }),
  stats: () => invoke<CollectionStats[]>("collection_stats"),
  createSale: (sale: SaleInput) => invoke<Sale>("create_sale", { sale }),
  listSales: () => invoke<Sale[]>("list_sales"),
  deleteSale: (id: string, restock: boolean) => invoke<void>("delete_sale", { id, restock }),
  photoImportPath: (path: string, token: string) => invoke<Processed>("photo_import_path", { path, token }),
  photoImportBase64: (data: string, token: string) =>
    invoke<Processed>("photo_import_base64", { data, token }),
  photoSource: (original: string, rotate: number, maxSide: number) =>
    invoke<{ url: string; width: number; height: number }>("photo_source", { original, rotate, maxSide }),
  photoPreview: (original: string, edits: Edits, maxSide: number) =>
    invoke<string>("photo_preview", { original, edits, maxSide }),
  photoRender: (original: string, edits: Edits) => invoke<Processed>("photo_render", { original, edits }),
  copyPhoto: (file: string) => invoke<void>("copy_photo", { file }),
  imageDataUrl: (file: string) => invoke<string>("image_data_url", { file }),
  getSettings: () => invoke<Settings>("get_settings"),
  saveSettings: (settings: Settings) => invoke<void>("save_settings", { settings }),
  exportBackup: (dest: string) => invoke<number>("export_backup", { dest }),
  importBackup: (src: string, replace: boolean) =>
    invoke<{ cars: number; images: number }>("import_backup", { src, replace }),
  saveCatalogPages: (dir: string, prefix: string, pages: string[]) =>
    invoke<string[]>("save_catalog_pages", { dir, prefix, pages }),
  copyImage: (png: string) => invoke<void>("copy_image", { png }),
};

export function errorMessage(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  return String(e);
}
export const COLLECTION = "hotwheels";
