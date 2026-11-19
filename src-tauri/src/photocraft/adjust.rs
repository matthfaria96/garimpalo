//! Ajustes de cor. Brilho/Contraste "modernos" e Vibração/Saturação do Photoshop, medidos e
//! ajustados pelo PhotoCraft. Adaptado de PhotoCraft `crates/compose/src/adjust/tone.rs` e
//! `color.rs` (MIT, ver `mod.rs`), para sRGB de 8 bits.

/// Modern Brightness curve (one channel, `brightness` in [-150, 150]); pins pure black and white,
/// and `b = 0` is the identity. Lowered, it is the inverse of the curve raised by as much.
struct Brightness {
    raise: bool,
    s: f32,
    e: f32,
    x0: f32,
    alpha: f32,
    hermite: bool,
}

const BRIGHTNESS_KNEE: f32 = 126.0 / 255.0;

impl Brightness {
    fn new(brightness: f32) -> Self {
        let b = brightness.abs();
        let s = 1.375f32.powf(b / 50.0);
        let e = 1.0 / (1.0 + 0.084 * b);
        let x0 = (BRIGHTNESS_KNEE / s).min(1.0);
        let secant = (1.0 - BRIGHTNESS_KNEE) / (1.0 - x0).max(1e-6);
        let (alpha, beta) = (s / secant, e / secant);
        Brightness { raise: brightness > 0.0, s, e, x0, alpha, hermite: alpha * alpha + beta * beta <= 9.0 }
    }

    fn eval(&self, v: f32) -> f32 {
        let v = v.clamp(0.0, 1.0);
        if self.raise {
            return self.raised(v);
        }
        if v <= 0.0 || v >= 1.0 {
            return v;
        }
        let (mut lo, mut hi) = (0.0f32, 1.0f32);
        for _ in 0..32 {
            let mid = 0.5 * (lo + hi);
            if self.raised(mid) < v {
                lo = mid;
            } else {
                hi = mid;
            }
        }
        0.5 * (lo + hi)
    }

    fn raised(&self, x: f32) -> f32 {
        let Brightness { s, e, x0, alpha, hermite, .. } = *self;
        let y0 = BRIGHTNESS_KNEE;
        if x <= x0 {
            return y0.min(s * x);
        }
        let h = (1.0 - x0).max(1e-6);
        let t = ((x - x0) / h).clamp(0.0, 1.0);
        let y = if hermite {
            let (t2, t3) = (t * t, t * t * t);
            (2.0 * t3 - 3.0 * t2 + 1.0) * y0 + (t3 - 2.0 * t2 + t) * h * s + (-2.0 * t3 + 3.0 * t2) + (t3 - t2) * h * e
        } else {
            1.0 - (1.0 - y0) * (1.0 - t).powf(alpha)
        };
        y.clamp(0.0, 1.0)
    }
}

/// Modern Contrast curve (one channel, `contrast` in [-50, 100]). A symmetric cubic-Hermite S-curve
/// pivoting at 0.5. `c = 0` is the identity; pins 0, 0.5 and 1.
pub fn modern_contrast(v: f32, contrast: f32) -> f32 {
    if contrast == 0.0 {
        return v;
    }
    let k = contrast / 128.0;
    let (end, mid) = (1.0 - k, 1.0 + k);
    let half = |t: f32| end * 0.5 * (t * t * t - 2.0 * t * t + t) + (-2.0 * t * t * t + 3.0 * t * t) * 0.5 + mid * 0.5 * (t * t * t - t * t);
    let v = v.clamp(0.0, 1.0);
    if v <= 0.5 {
        half(v / 0.5)
    } else {
        1.0 - half((1.0 - v) / 0.5)
    }
}

/// Brilho e depois contraste, como o Photoshop aplica, numa tabela de 256 níveis.
pub fn brightness_contrast_lut(brightness: f32, contrast: f32) -> [u8; 256] {
    let curve = (brightness != 0.0).then(|| Brightness::new(brightness));
    std::array::from_fn(|i| {
        let v = i as f32 / 255.0;
        let b = curve.as_ref().map_or(v, |c| c.eval(v));
        (modern_contrast(b, contrast).clamp(0.0, 1.0) * 255.0).round() as u8
    })
}

/// Weights of the grey Photoshop's Vibrance › Saturation desaturates to (R, G; blue has none).
pub const VIBRANCE_GREY: [f32; 2] = [0.288, 0.712];

/// Positive Vibrance's saturation boost, fitted to the measurements (see [`vibrance_lin`]).
pub const VIBRANCE_BOOST: [f32; 7] = [0.5001, 0.0887, 0.4374, 0.7573, -0.8113, 0.5154, 2.8026];

/// Vibração (`v`) e depois Saturação (`s`), ambos em [-1, 1], num pixel em luz linear.
pub fn vibrance_saturation_lin(c: [f32; 3], v: f32, s: f32) -> [f32; 3] {
    let mut l = c;
    if v != 0.0 {
        l = vibrance_lin(l, v);
    }
    if s != 0.0 {
        let g = VIBRANCE_GREY[0] * l[0] + VIBRANCE_GREY[1] * l[1];
        l = l.map(|x| (g + (1.0 + s) * (x - g)).clamp(0.0, 1.0));
    }
    l
}

/// The Vibrance slider (`v` in [-1, 1]) on a linear-light pixel; keeps the hue and protects skin
/// tones (and the reds of the cards) when boosting.
pub fn vibrance_lin(c: [f32; 3], v: f32) -> [f32; 3] {
    let mx = c[0].max(c[1]).max(c[2]);
    let mn = c[0].min(c[1]).min(c[2]);
    if mx <= 0.0 || mx - mn <= 1e-9 {
        return c;
    }
    let t = 1.0 - mn / mx;
    let shape = t * (1.0 - t) * (2.0 - t + t * t) * mx * (1.0 - mx).max(0.0);
    let (t2, v2) = if v < 0.0 {
        let a = -v;
        (t * (1.0 - a / 4.0) * (1.0 - a + a * t * (1.0 + t) / 2.0), mx - a * shape)
    } else {
        let [c0, c1, p, q, r0, ra, rt] = VIBRANCE_BOOST;
        let w = vibrance_skin(hsv_hue(c, mx, mn));
        let a = v * (1.0 - w) + 0.64 * v.powf(1.6) * w;
        let boost = (c0 * a + c1 * a * a) * t.powf(p) * (1.0 - t).powf(q) * ((r0 + ra * a + rt * (1.0 - t)) * (1.0 - mx).max(0.0)).exp();
        ((t * (1.0 + boost)).min(1.0), mx + v / 4.0 * shape)
    };
    let m2 = v2 * (1.0 - t2);
    let k = (v2 - m2) / (mx - mn);
    c.map(|x| m2 + (x - mn) * k)
}

fn vibrance_skin(h: f32) -> f32 {
    if h <= 30.0 {
        1.0
    } else if h < 45.0 {
        (45.0 - h) / 15.0
    } else if h < 300.0 {
        0.0
    } else {
        (h - 300.0) / 60.0
    }
}

fn hsv_hue(c: [f32; 3], mx: f32, mn: f32) -> f32 {
    let d = mx - mn;
    let h = if mx == c[0] {
        ((c[1] - c[2]) / d).rem_euclid(6.0)
    } else if mx == c[1] {
        (c[2] - c[0]) / d + 2.0
    } else {
        (c[0] - c[1]) / d + 4.0
    };
    h * 60.0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn neutral_settings_are_identity() {
        let lut = brightness_contrast_lut(0.0, 0.0);
        assert!(lut.iter().enumerate().all(|(i, &v)| v as usize == i));
        assert_eq!(vibrance_saturation_lin([0.2, 0.5, 0.7], 0.0, 0.0), [0.2, 0.5, 0.7]);
    }

    #[test]
    fn brightness_raises_mids_and_pins_ends() {
        let lut = brightness_contrast_lut(50.0, 0.0);
        assert_eq!((lut[0], lut[255]), (0, 255));
        assert!(lut[128] > 140);
        let darker = brightness_contrast_lut(-50.0, 0.0);
        assert!(darker[128] < 115);
    }

    #[test]
    fn saturation_minus_one_is_grey() {
        let p = vibrance_saturation_lin([0.8, 0.2, 0.1], 0.0, -1.0);
        assert!((p[0] - p[1]).abs() < 1e-6 && (p[1] - p[2]).abs() < 1e-6);
    }
}
