//! Trechos adaptados do PhotoCraft (https://github.com/storytold/photocraft, commit ef1d300),
//! Copyright (c) 2026 ArtCraft Team and the PhotoCraft contributors, licença MIT
//! (texto completo em `LICENSE-MIT`, nesta pasta).
//!
//! - `transform`: homografia e "Perspective Crop" (de `crates/algo/src/transform.rs`)
//! - `adjust`: Brilho/Contraste e Vibração/Saturação calibrados contra o Photoshop
//!   (de `crates/compose/src/adjust/tone.rs` e `color.rs`)
//!
//! As adaptações: removidas as dependências internas do PhotoCraft (Surface, Transfer, etc.),
//! trabalhando direto com sRGB de 8 bits.

pub mod adjust;
pub mod transform;
