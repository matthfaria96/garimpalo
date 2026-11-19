//! Homografia (matriz projetiva 3×3) e Perspective Crop.
//! Adaptado de PhotoCraft `crates/algo/src/transform.rs` (MIT, ver `mod.rs`).

/// 3×3 projective matrix, row-major: `[x', y', w'] = H · [x, y, 1]`.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Homography(pub [f64; 9]);

impl Homography {
    pub fn apply(&self, x: f64, y: f64) -> (f64, f64) {
        let m = &self.0;
        let w = m[6] * x + m[7] * y + m[8];
        ((m[0] * x + m[1] * y + m[2]) / w, (m[3] * x + m[4] * y + m[5]) / w)
    }

    pub fn mul(&self, o: &Homography) -> Homography {
        let (a, b) = (&self.0, &o.0);
        let mut r = [0.0; 9];
        for i in 0..3 {
            for j in 0..3 {
                r[i * 3 + j] = (0..3).map(|k| a[i * 3 + k] * b[k * 3 + j]).sum();
            }
        }
        Homography(r)
    }

    #[allow(dead_code)] // usado nos testes; útil para mapear pontos de volta
    pub fn inverse(&self) -> Option<Homography> {
        let m = &self.0;
        let c = [
            m[4] * m[8] - m[5] * m[7],
            m[2] * m[7] - m[1] * m[8],
            m[1] * m[5] - m[2] * m[4],
            m[5] * m[6] - m[3] * m[8],
            m[0] * m[8] - m[2] * m[6],
            m[2] * m[3] - m[0] * m[5],
            m[3] * m[7] - m[4] * m[6],
            m[1] * m[6] - m[0] * m[7],
            m[0] * m[4] - m[1] * m[3],
        ];
        let det = m[0] * c[0] + m[1] * c[3] + m[2] * c[6];
        if det.abs() < 1e-12 {
            return None;
        }
        Some(Homography(c.map(|v| v / det)))
    }

    /// Unit square → quad (corners in order: (0,0), (1,0), (1,1), (0,1)).
    fn square_to_quad(q: [[f64; 2]; 4]) -> Option<Homography> {
        let [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = q;
        let (sx, sy) = (x0 - x1 + x2 - x3, y0 - y1 + y2 - y3);
        if sx.abs() < 1e-12 && sy.abs() < 1e-12 {
            // Affine.
            return Some(Homography([x1 - x0, x3 - x0, x0, y1 - y0, y3 - y0, y0, 0.0, 0.0, 1.0]));
        }
        let (dx1, dx2, dy1, dy2) = (x1 - x2, x3 - x2, y1 - y2, y3 - y2);
        let den = dx1 * dy2 - dx2 * dy1;
        if den.abs() < 1e-12 {
            return None;
        }
        let g = (sx * dy2 - dx2 * sy) / den;
        let h = (dx1 * sy - sx * dy1) / den;
        Some(Homography([x1 - x0 + g * x1, x3 - x0 + h * x3, x0, y1 - y0 + g * y1, y3 - y0 + h * y3, y0, g, h, 1.0]))
    }

    /// The transform taking rectangle `r` (x0, y0, x1, y1) onto `quad` (corners clockwise from
    /// top-left). `None` for degenerate quads.
    pub fn rect_to_quad(r: [f64; 4], quad: [[f64; 2]; 4]) -> Option<Homography> {
        let (w, h) = (r[2] - r[0], r[3] - r[1]);
        if w <= 0.0 || h <= 0.0 {
            return None;
        }
        let to_unit = Homography([1.0 / w, 0.0, -r[0] / w, 0.0, 1.0 / h, -r[1] / h, 0.0, 0.0, 1.0]);
        Some(Self::square_to_quad(quad)?.mul(&to_unit))
    }
}

/// Is `q` (TL, TR, BR, BL) convex, clockwise on screen, with no straight angle and a real area?
pub fn convex_quad(q: &[[f64; 2]; 4]) -> bool {
    if q.iter().flatten().any(|v| !v.is_finite()) {
        return false;
    }
    let mut area2 = 0.0;
    for i in 0..4 {
        let (a, b, c) = (q[i], q[(i + 1) % 4], q[(i + 2) % 4]);
        let (e1, e2) = ([b[0] - a[0], b[1] - a[1]], [c[0] - b[0], c[1] - b[1]]);
        let cross = e1[0] * e2[1] - e1[1] * e2[0];
        if cross.is_nan() || cross <= 1e-3 * e1[0].hypot(e1[1]) * e2[0].hypot(e2[1]) {
            return false;
        }
        area2 += a[0] * b[1] - b[0] * a[1];
    }
    area2.is_finite() && area2 >= 2.0
}

const MIN_FORESHORTENING: f64 = 0.005;
const MAX_ESTIMATE_RATIO: f64 = 4.0;
const MAX_ASPECT_SWING: f64 = 0.1;

/// The free output size of a Perspective Crop of `q` (TL, TR, BR, BL) in an image centred on
/// `center`: the rectangle the quad shows in perspective, or the quad's longest edges when its
/// sides are too close to parallel to recover that, the estimate would not survive a pixel of
/// click error, or it is implausible.
pub fn quad_free_size(q: &[[f64; 2]; 4], center: [f64; 2]) -> (f64, f64) {
    let len = |a: [f64; 2], b: [f64; 2]| (b[0] - a[0]).hypot(b[1] - a[1]);
    let [tl, tr, br, bl] = *q;
    let (edge_w, edge_h) = (len(tl, tr).max(len(bl, br)), len(tl, bl).max(len(tr, br)));
    let near = |v: f64, edge: f64| v.is_finite() && v >= edge / MAX_ESTIMATE_RATIO && v <= edge * MAX_ESTIMATE_RATIO;
    match perspective_size(q, center) {
        Some((w, h)) if near(w, edge_w) && near(h, edge_h) => (w, h),
        _ => (edge_w, edge_h),
    }
}

fn perspective_size(q: &[[f64; 2]; 4], center: [f64; 2]) -> Option<(f64, f64)> {
    let (width, aspect) = perspective_estimate(q, center)?;
    for corner in 0..4 {
        for axis in 0..2 {
            for step in [-1.0, 1.0] {
                let mut nudged = *q;
                nudged[corner][axis] += step;
                let (_, other) = perspective_estimate(&nudged, center)?;
                if (other / aspect - 1.0).abs() > MAX_ASPECT_SWING {
                    return None;
                }
            }
        }
    }
    Some((width, width / aspect))
}

/// Width and aspect ratio of the rectangle `q` shows (Zhang and He, "Whiteboard scanning and
/// image enhancement", 2007), principal point at `center`.
fn perspective_estimate(q: &[[f64; 2]; 4], [cx, cy]: [f64; 2]) -> Option<(f64, f64)> {
    let Homography([a, b, _, d, e, _, g, h, _]) = Homography::rect_to_quad([0.0, 0.0, 1.0, 1.0], *q)?;
    if g.abs().min(h.abs()) < MIN_FORESHORTENING {
        return None;
    }
    let (ux, uy, vx, vy) = (a - g * cx, d - g * cy, b - h * cx, e - h * cy);
    let focal2 = -(ux * vx + uy * vy) / (g * h);
    if !focal2.is_finite() || focal2 <= 0.0 {
        return None;
    }
    let focal = focal2.sqrt();
    let aspect = ux.hypot(uy).hypot(g * focal) / vx.hypot(vy).hypot(h * focal);
    let scale_at = |[s, t]: [f64; 2], [x, y]: [f64; 2]| (a - x * g).hypot(d - y * g) / (1.0 + g * s + h * t);
    let [tl, tr, br, bl] = *q;
    let width = [scale_at([0.0, 0.0], tl), scale_at([1.0, 0.0], tr), scale_at([1.0, 1.0], br), scale_at([0.0, 1.0], bl)]
        .into_iter()
        .fold(0.0, f64::max);
    Some((width, aspect))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rect_to_quad_maps_corners() {
        let q = [[10.0, 20.0], [110.0, 30.0], [100.0, 140.0], [5.0, 120.0]];
        let h = Homography::rect_to_quad([0.0, 0.0, 200.0, 300.0], q).unwrap();
        for (p, e) in [[0.0, 0.0], [200.0, 0.0], [200.0, 300.0], [0.0, 300.0]].iter().zip(q) {
            let (x, y) = h.apply(p[0], p[1]);
            assert!((x - e[0]).abs() < 1e-6 && (y - e[1]).abs() < 1e-6);
        }
        let inv = h.inverse().unwrap();
        let (x, y) = inv.apply(110.0, 30.0);
        assert!((x - 200.0).abs() < 1e-6 && y.abs() < 1e-6);
    }

    #[test]
    fn rectangle_keeps_its_size() {
        let q = [[0.0, 0.0], [300.0, 0.0], [300.0, 400.0], [0.0, 400.0]];
        assert!(convex_quad(&q));
        let (w, h) = quad_free_size(&q, [150.0, 200.0]);
        assert!((w - 300.0).abs() < 1e-6 && (h - 400.0).abs() < 1e-6);
        // ordem invertida (cruzada) não é um quadrilátero válido
        assert!(!convex_quad(&[q[0], q[2], q[1], q[3]]));
    }
}
