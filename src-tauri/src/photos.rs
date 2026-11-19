//! Fotos: importação (orientação, original otimizado), edição não destrutiva
//! (rotação, recorte, perspectiva, cor, nitidez) e compressão em WebP.

use crate::photocraft::adjust;
use crate::photocraft::transform::{convex_quad, quad_free_size, Homography};
use base64::Engine;
use image::codecs::jpeg::JpegEncoder;
use image::imageops::FilterType;
use image::{DynamicImage, ImageDecoder, ImageReader, Rgb, RgbImage};
use serde::{Deserialize, Serialize};
use std::io::Cursor;
use std::path::Path;

/// Original guardado para reedição (lado maior).
pub const ORIGINAL_MAX: u32 = 2400;
/// Foto final usada no app e no catálogo (lado maior).
pub const OUTPUT_MAX: u32 = 1600;
/// Qualidade WebP do original (alta, é a "matriz").
const ORIGINAL_QUALITY: f32 = 92.0;
/// Qualidade WebP da foto final: visualmente igual ao JPEG 90, ~30% menor.
const OUTPUT_QUALITY: f32 = 84.0;
/// Maior lado permitido num recorte em perspectiva.
const WARP_MAX: f64 = 4000.0;

/// Ajustes de uma foto. Todos neutros = foto como veio.
#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Edits {
    /// 0, 90, 180 ou 270 (horário)
    pub rotate: u16,
    /// "rect" ou "perspective" (só para a interface lembrar o modo)
    pub crop_mode: String,
    /// Cantos do recorte (TL, TR, BR, BL), de 0 a 1, já na imagem girada
    pub quad: Option<[[f64; 2]; 4]>,
    /// -100..100
    pub brightness: f32,
    /// -100..100
    pub contrast: f32,
    /// -100..100
    pub saturation: f32,
    /// -100..100
    pub vibrance: f32,
    /// -100 (frio) .. 100 (quente)
    pub temperature: f32,
    /// 0..100
    pub sharpness: f32,
    /// Como a foto ocupa o quadro do card/catálogo: "cover" (preencher, padrão) ou "blur"
    /// (foto inteira com o fundo desfocado). Só afeta a exibição, não os pixels do arquivo.
    pub fit: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Photo {
    /// Foto final (WebP) mostrada no app e usada no catálogo
    pub file: String,
    /// Original otimizado, base para reeditar sem perder qualidade
    pub original: String,
    #[serde(default)]
    pub edits: Edits,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Processed {
    pub photo: Photo,
    pub bytes_in: u64,
    pub bytes_out: u64,
    pub width: u32,
    pub height: u32,
}

// ---------- Leitura ----------

pub fn decode(bytes: &[u8]) -> Result<DynamicImage, String> {
    let reader = ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|e| format!("Não consegui ler a imagem: {e}"))?;
    let mut decoder = reader.into_decoder().map_err(|_| {
        "Formato não suportado. Use JPG, PNG ou WEBP (no iPhone, exporte a foto HEIC como JPG).".to_string()
    })?;
    let orientation = decoder.orientation().ok();
    let mut img = DynamicImage::from_decoder(decoder).map_err(|e| format!("Imagem corrompida: {e}"))?;
    if let Some(o) = orientation {
        img.apply_orientation(o);
    }
    Ok(img)
}

pub fn load(dir: &Path, name: &str) -> Result<DynamicImage, String> {
    let name = safe_file_name(name).ok_or("Imagem inválida")?;
    let bytes = std::fs::read(dir.join(name)).map_err(|e| format!("Foto não encontrada: {e}"))?;
    decode(&bytes)
}

// ---------- Importar ----------

/// Importa uma foto: corrige orientação, guarda o original otimizado e gera a foto final.
/// `stage` recebe as etapas para a interface mostrar o progresso.
pub fn import(bytes: &[u8], dir: &Path, stage: impl Fn(&str)) -> Result<Processed, String> {
    stage("reading");
    let img = decode(bytes)?;
    stage("original");
    let img = fit(img, ORIGINAL_MAX);
    let rgb = flatten_on_white(&img);
    let original = format!("o_{}.webp", uuid::Uuid::new_v4());
    write(dir, &original, &encode_webp(&rgb, ORIGINAL_QUALITY))?;
    stage("compressing");
    let mut done = render_to_file(&DynamicImage::ImageRgb8(rgb), &original, &Edits::default(), dir)?;
    done.bytes_in = bytes.len() as u64;
    stage("done");
    Ok(done)
}

/// Gera a foto final (WebP) de um original com os ajustes dados.
pub fn render_to_file(src: &DynamicImage, original: &str, edits: &Edits, dir: &Path) -> Result<Processed, String> {
    let out = render(src, edits, OUTPUT_MAX);
    let bytes = encode_webp(&out, OUTPUT_QUALITY);
    let file = format!("{}.webp", uuid::Uuid::new_v4());
    write(dir, &file, &bytes)?;
    Ok(Processed {
        photo: Photo { file, original: original.to_string(), edits: edits.clone() },
        bytes_in: 0,
        bytes_out: bytes.len() as u64,
        width: out.width(),
        height: out.height(),
    })
}

fn write(dir: &Path, name: &str, bytes: &[u8]) -> Result<(), String> {
    std::fs::write(dir.join(name), bytes).map_err(|e| format!("Falha ao gravar a foto: {e}"))
}

// ---------- Edição ----------

pub fn rotated(src: &DynamicImage, rotate: u16) -> DynamicImage {
    match rotate % 360 {
        90 => src.rotate90(),
        180 => src.rotate180(),
        270 => src.rotate270(),
        _ => src.clone(),
    }
}

/// Aplica os ajustes: rotação → recorte/perspectiva → tamanho → cor → nitidez.
pub fn render(src: &DynamicImage, e: &Edits, max_side: u32) -> RgbImage {
    let img = flatten_on_white(&rotated(src, e.rotate));
    let img = match e.quad {
        Some(q) => crop_quad(&img, q).unwrap_or(img),
        None => img,
    };
    let mut img = fit_rgb(img, max_side);
    apply_color(&mut img, e);
    if e.sharpness > 0.0 {
        img = sharpen(&img, e.sharpness / 100.0);
    }
    img
}

/// Recorte retangular ou em perspectiva. `None` se o quadrilátero for inválido ou cobrir a
/// imagem inteira (nada a fazer).
fn crop_quad(img: &RgbImage, q: [[f64; 2]; 4]) -> Option<RgbImage> {
    let (w, h) = (img.width() as f64, img.height() as f64);
    let q: [[f64; 2]; 4] = q.map(|[x, y]| [x.clamp(0.0, 1.0) * w, y.clamp(0.0, 1.0) * h]);
    let [tl, tr, br, bl] = q;
    let axis_aligned = (tl[1] - tr[1]).abs() < 0.5
        && (bl[1] - br[1]).abs() < 0.5
        && (tl[0] - bl[0]).abs() < 0.5
        && (tr[0] - br[0]).abs() < 0.5;
    if axis_aligned {
        let (x0, y0) = (tl[0].round().max(0.0) as u32, tl[1].round().max(0.0) as u32);
        let (x1, y1) = (br[0].round().min(w) as u32, br[1].round().min(h) as u32);
        if x1 <= x0 + 1 || y1 <= y0 + 1 {
            return None;
        }
        if x0 == 0 && y0 == 0 && x1 == img.width() && y1 == img.height() {
            return None;
        }
        return Some(image::imageops::crop_imm(img, x0, y0, x1 - x0, y1 - y0).to_image());
    }
    if !convex_quad(&q) {
        return None;
    }
    // Tamanho real do retângulo visto em perspectiva (PhotoCraft Perspective Crop)
    let (mut ow, mut oh) = quad_free_size(&q, [w / 2.0, h / 2.0]);
    let scale = (WARP_MAX / ow.max(oh)).min(1.0);
    ow = (ow * scale).round().max(2.0);
    oh = (oh * scale).round().max(2.0);
    Some(warp(img, q, ow as u32, oh as u32))
}

/// Mapeamento inverso: cada pixel de saída busca sua posição no quadrilátero de origem.
fn warp(src: &RgbImage, q: [[f64; 2]; 4], ow: u32, oh: u32) -> RgbImage {
    let Some(hm) = Homography::rect_to_quad([0.0, 0.0, ow as f64, oh as f64], q) else {
        return src.clone();
    };
    let mut out = RgbImage::new(ow, oh);
    for (x, y, px) in out.enumerate_pixels_mut() {
        let (sx, sy) = hm.apply(x as f64 + 0.5, y as f64 + 0.5);
        *px = bilinear(src, sx - 0.5, sy - 0.5);
    }
    out
}

fn bilinear(img: &RgbImage, x: f64, y: f64) -> Rgb<u8> {
    let (w, h) = (img.width() as i64, img.height() as i64);
    let (x0, y0) = (x.floor(), y.floor());
    let (fx, fy) = ((x - x0) as f32, (y - y0) as f32);
    let at = |xi: i64, yi: i64| img.get_pixel(xi.clamp(0, w - 1) as u32, yi.clamp(0, h - 1) as u32).0;
    let (x0, y0) = (x0 as i64, y0 as i64);
    let (a, b, c, d) = (at(x0, y0), at(x0 + 1, y0), at(x0, y0 + 1), at(x0 + 1, y0 + 1));
    Rgb(std::array::from_fn(|i| {
        let top = a[i] as f32 * (1.0 - fx) + b[i] as f32 * fx;
        let bot = c[i] as f32 * (1.0 - fx) + d[i] as f32 * fx;
        (top * (1.0 - fy) + bot * fy).round().clamp(0.0, 255.0) as u8
    }))
}

fn apply_color(img: &mut RgbImage, e: &Edits) {
    let tone = e.brightness != 0.0 || e.contrast != 0.0;
    let (vib, sat, temp) = (e.vibrance / 100.0, e.saturation / 100.0, e.temperature / 100.0);
    let linear = vib != 0.0 || sat != 0.0 || temp != 0.0;
    if !tone && !linear {
        return;
    }
    // Contraste do Photoshop vai de -50 a 100: o lado negativo do slider é comprimido.
    let contrast = if e.contrast < 0.0 { e.contrast * 0.5 } else { e.contrast };
    let lut = adjust::brightness_contrast_lut(e.brightness, contrast);
    let decode: [f32; 256] = std::array::from_fn(|i| srgb_to_linear(i as f32 / 255.0));
    let encode: Vec<u8> = (0..=4095)
        .map(|i| (linear_to_srgb(i as f32 / 4095.0) * 255.0).round() as u8)
        .collect();
    // Temperatura: ganho nos canais em luz linear (quente = mais vermelho, menos azul)
    let gain = [1.0 + 0.18 * temp, 1.0 + 0.03 * temp, 1.0 - 0.18 * temp];
    for p in img.pixels_mut() {
        let mut c = p.0;
        if tone {
            c = c.map(|v| lut[v as usize]);
        }
        if linear {
            let mut l: [f32; 3] = std::array::from_fn(|i| (decode[c[i] as usize] * gain[i]).clamp(0.0, 1.0));
            l = adjust::vibrance_saturation_lin(l, vib, sat);
            c = l.map(|v| encode[(v.clamp(0.0, 1.0) * 4095.0).round() as usize]);
        }
        p.0 = c;
    }
}

fn srgb_to_linear(v: f32) -> f32 {
    if v <= 0.04045 {
        v / 12.92
    } else {
        ((v + 0.055) / 1.055).powf(2.4)
    }
}

fn linear_to_srgb(v: f32) -> f32 {
    if v <= 0.0031308 {
        v * 12.92
    } else {
        1.055 * v.powf(1.0 / 2.4) - 0.055
    }
}

/// Máscara de nitidez com intensidade ajustável (0..1).
fn sharpen(img: &RgbImage, amount: f32) -> RgbImage {
    let sharp = image::imageops::unsharpen(img, 1.2, 2);
    let k = amount * 1.5;
    let mut out = img.clone();
    for (o, s) in out.pixels_mut().zip(sharp.pixels()) {
        o.0 = std::array::from_fn(|i| {
            let a = o.0[i] as f32;
            (a + k * (s.0[i] as f32 - a)).round().clamp(0.0, 255.0) as u8
        });
    }
    out
}

// ---------- Tamanho / formato ----------

pub fn fit(img: DynamicImage, max_side: u32) -> DynamicImage {
    if img.width().max(img.height()) > max_side {
        img.resize(max_side, max_side, FilterType::Lanczos3)
    } else {
        img
    }
}

fn fit_rgb(img: RgbImage, max_side: u32) -> RgbImage {
    let (w, h) = img.dimensions();
    if w.max(h) <= max_side {
        return img;
    }
    let s = max_side as f64 / w.max(h) as f64;
    let (nw, nh) = (((w as f64 * s).round() as u32).max(1), ((h as f64 * s).round() as u32).max(1));
    image::imageops::resize(&img, nw, nh, FilterType::Lanczos3)
}

/// PNG com transparência vira fundo branco (em vez de preto).
pub fn flatten_on_white(img: &DynamicImage) -> RgbImage {
    if !img.color().has_alpha() {
        return img.to_rgb8();
    }
    let rgba = img.to_rgba8();
    let mut out = RgbImage::new(rgba.width(), rgba.height());
    for (x, y, p) in rgba.enumerate_pixels() {
        let a = p[3] as u32;
        let blend = |c: u8| ((c as u32 * a + 255 * (255 - a)) / 255) as u8;
        out.put_pixel(x, y, Rgb([blend(p[0]), blend(p[1]), blend(p[2])]));
    }
    out
}

pub fn encode_webp(img: &RgbImage, quality: f32) -> Vec<u8> {
    webp::Encoder::from_rgb(img.as_raw(), img.width(), img.height())
        .encode(quality)
        .to_vec()
}

/// JPEG em data URL (prévias do editor: codifica mais rápido que WebP).
pub fn jpeg_data_url(img: &RgbImage, quality: u8) -> Result<String, String> {
    let mut buf = Vec::new();
    JpegEncoder::new_with_quality(&mut buf, quality)
        .encode_image(img)
        .map_err(|e| e.to_string())?;
    Ok(format!(
        "data:image/jpeg;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(buf)
    ))
}

pub fn mime_for(name: &str) -> &'static str {
    match name.rsplit('.').next().map(|s| s.to_ascii_lowercase()).as_deref() {
        Some("webp") => "image/webp",
        Some("png") => "image/png",
        _ => "image/jpeg",
    }
}

/// Só aceita nomes de arquivo simples (sem barras / "..").
pub fn safe_file_name(name: &str) -> Option<&str> {
    let ok = !name.is_empty()
        && !name.contains('/')
        && !name.contains('\\')
        && !name.contains("..")
        && name != ".";
    ok.then_some(name)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp() -> std::path::PathBuf {
        let d = std::env::temp_dir().join(format!("garimpalo-photo-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    fn png(w: u32, h: u32, px: image::Rgba<u8>) -> Vec<u8> {
        let mut out = Vec::new();
        DynamicImage::ImageRgba8(image::RgbaImage::from_pixel(w, h, px))
            .write_to(&mut Cursor::new(&mut out), image::ImageFormat::Png)
            .unwrap();
        out
    }

    #[test]
    fn import_makes_webp_original_and_output() {
        let dir = tmp();
        let r = import(&png(3000, 1000, image::Rgba([0, 0, 0, 0])), &dir, |_| {}).unwrap();
        assert!(r.photo.file.ends_with(".webp") && r.photo.original.starts_with("o_"));
        assert_eq!((r.width, r.height), (OUTPUT_MAX, 533));
        let out = load(&dir, &r.photo.file).unwrap().to_rgb8();
        assert!(out.get_pixel(10, 10)[0] > 240, "transparente deve virar branco");
        let orig = load(&dir, &r.photo.original).unwrap();
        assert_eq!(orig.width(), ORIGINAL_MAX);
        assert!(import(b"nao sou imagem", &dir, |_| {}).is_err());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn rotate_and_rect_crop() {
        let src = DynamicImage::ImageRgb8(RgbImage::from_pixel(400, 200, Rgb([10, 20, 30])));
        let e = Edits { rotate: 90, quad: Some([[0.0, 0.0], [0.5, 0.0], [0.5, 0.25], [0.0, 0.25]]), ..Default::default() };
        let out = render(&src, &e, 2000);
        // girada: 200x400; recorte de metade x um quarto = 100x100
        assert_eq!(out.dimensions(), (100, 100));
    }

    #[test]
    fn perspective_crop_straightens_a_trapezoid() {
        // imagem branca com um trapézio preto; recortar o trapézio deve dar tudo preto
        let mut img = RgbImage::from_pixel(400, 400, Rgb([255, 255, 255]));
        let q = [[100.0, 50.0], [300.0, 70.0], [320.0, 350.0], [80.0, 330.0]];
        let inside = |x: f64, y: f64| {
            (0..4).all(|i| {
                let (a, b) = (q[i], q[(i + 1) % 4]);
                (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]) >= 0.0
            })
        };
        for (x, y, p) in img.enumerate_pixels_mut() {
            if inside(x as f64 + 0.5, y as f64 + 0.5) {
                *p = Rgb([0, 0, 0]);
            }
        }
        let quad = q.map(|[x, y]| [x / 400.0, y / 400.0]);
        let e = Edits { crop_mode: "perspective".into(), quad: Some(quad), ..Default::default() };
        let out = render(&DynamicImage::ImageRgb8(img), &e, 2000);
        let (w, h) = out.dimensions();
        assert!(w > 150 && h > 200, "tamanho {w}x{h}");
        // centro e pontos perto das bordas internas são pretos
        for (x, y) in [(w / 2, h / 2), (5, 5), (w - 6, h - 6), (5, h - 6), (w - 6, 5)] {
            assert!(out.get_pixel(x, y)[0] < 40, "pixel {x},{y} = {:?}", out.get_pixel(x, y));
        }
    }

    #[test]
    fn color_edits_change_pixels() {
        let src = DynamicImage::ImageRgb8(RgbImage::from_pixel(10, 10, Rgb([120, 100, 80])));
        let neutral = render(&src, &Edits::default(), 100);
        assert_eq!(neutral.get_pixel(0, 0).0, [120, 100, 80]);
        let warm = render(&src, &Edits { temperature: 100.0, ..Default::default() }, 100);
        let p = warm.get_pixel(0, 0).0;
        assert!(p[0] > 120 && p[2] < 80);
        let grey = render(&src, &Edits { saturation: -100.0, ..Default::default() }, 100);
        let g = grey.get_pixel(0, 0).0;
        assert!(g[0].abs_diff(g[2]) <= 1);
        let bright = render(&src, &Edits { brightness: 60.0, ..Default::default() }, 100);
        assert!(bright.get_pixel(0, 0)[1] > 110);
    }

    #[test]
    fn blocks_path_traversal() {
        assert!(safe_file_name("../x.jpg").is_none());
        assert!(safe_file_name("a/b.jpg").is_none());
        assert!(safe_file_name("ok.webp").is_some());
    }
}
