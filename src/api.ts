import type { CatalogTheme } from "./catalog/render";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { applyPrefs, Currency, getLang, Lang } from "./i18n";

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
  /** idioma da interface */
  language?: Lang;
  /** moeda dos preços */
  currency?: Currency;
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
  try {
    applyPrefs(await invoke<Settings>("get_settings"));
  } catch {
    applyPrefs({});
  }
}

/** Salva idioma/moeda junto das outras configurações e aplica na hora. */
export async function savePrefs(p: Pick<Settings, "language" | "currency">) {
  const current = await invoke<Settings>("get_settings").catch(() => ({}) as Settings);
  await invoke<void>("save_settings", { settings: { ...current, ...p } });
  applyPrefs(p);
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

/** Mensagens de erro do Rust (em português) e a tradução; as que terminam em ":" têm detalhe técnico depois. */
const RUST_ERRORS: [string, string][] = [
  ["A venda precisa de pelo menos um modelo.", "A sale needs at least one model."],
  ["Confira as quantidades e os valores da venda.", "Check the sale's quantities and prices."],
  ["Um dos modelos da venda não existe mais.", "One of the models in this sale no longer exists."],
  ["Não consegui criar o arquivo:", "Couldn't create the file:"],
  ["Não consegui abrir o arquivo:", "Couldn't open the file:"],
  ["Esse arquivo não é um backup válido do Garimpalo (.zip).", "This file isn't a valid Garimpalo backup (.zip)."],
  ["Backup inválido: falta o garimpalo.json.", "Invalid backup: garimpalo.json is missing."],
  ["Backup corrompido:", "Corrupted backup:"],
  ["Esse arquivo não é um backup do Garimpalo.", "This file isn't a Garimpalo backup."],
  ["Informe o nome do modelo.", "Enter the model name."],
  ["No máximo", "At most"],
  ["Uma das fotos não foi encontrada. Adicione de novo.", "One of the photos wasn't found. Please add it again."],
  ["Não consegui abrir", "Couldn't open"],
  ["Imagem colada inválida.", "The pasted image is invalid."],
  ["Imagem inválida", "Invalid image"],
  ["Não consegui ler a imagem:", "Couldn't read the image:"],
  [
    "Formato não suportado. Use JPG, PNG ou WEBP (no iPhone, exporte a foto HEIC como JPG).",
    "Unsupported format. Use JPG, PNG or WEBP (on iPhone, export HEIC photos as JPG).",
  ],
  ["Imagem corrompida:", "Corrupted image:"],
  ["Foto não encontrada:", "Photo not found:"],
  ["Falha ao gravar a foto:", "Couldn't save the photo:"],
];

function translateError(msg: string): string {
  if (getLang() !== "en") return msg;
  for (const [pt, en] of RUST_ERRORS) {
    if (msg.startsWith(pt)) {
      // "No máximo 3 fotos por modelo." → "At most 3 photos per model."
      return (en + msg.slice(pt.length)).replace(" fotos por modelo.", " photos per model.");
    }
  }
  return msg;
}

export function errorMessage(e: unknown): string {
  if (typeof e === "string") return translateError(e);
  if (e instanceof Error) return translateError(e.message);
  return String(e);
}
export const COLLECTION = "hotwheels";
