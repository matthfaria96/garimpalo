# Garimpalo 🛞

App desktop (macOS / Windows) para gerenciar coleção de Hot Wheels e gerar catálogos de venda para mandar no WhatsApp.

Feito com **Tauri 2 + Rust** (backend, banco SQLite local, tratamento de imagens) e **React + TypeScript** (interface).

## O que faz

- **Início** com cards de coleções (por enquanto Hot Wheels; o banco já tem o campo `collection` para crescer).
- **Garagem**: cadastro com até **3 fotos** (a 1ª é a capa; ex.: frente da cartela, verso da caixa, carrinho/mockup), descrição, quantidade, data e valor da aquisição, preço de venda e preço promocional. Busca sem acento, ordenação, botões −/+ de quantidade.
- **Catálogo**: seleciona os modelos → gera imagens com **1 (1×1), 4 (2×2), 9 (3×3) ou 16 (4×4) por página**, em **7 temas**: WhatsApp claro e escuro, Vitrine (clean, estilo loja), Oferta (amarelo de saldão), Pista (laranja Hot Wheels), Colecionador (creme, serifa e dourado) e Neon (noturno). Foto grande, preço em destaque, preço antigo riscado e selo de desconto nas promoções, e cada modelo numerado para o cliente pedir "quero o 5". Salva em JPG, copia direto para colar no WhatsApp, ou copia a lista em texto (formatação do WhatsApp).
- **Vendas**: na garagem, selecione os modelos e toque em **Gerar venda**: comprador, contato, quantidade e valor combinado por item, valor final com desconto/acréscimo, observação e baixa no estoque. O resumo sai pronto para colar no WhatsApp. A tela **Vendas** guarda o histórico (com busca e totais do mês) e permite desfazer uma venda, devolvendo o estoque.
- **Fotos**: clicar, arrastar ou colar (⌘/Ctrl+V). Cada foto é convertida na hora para **WebP** (com indicador de progresso e quanto encolheu). O editor tem recorte retangular (Livre, 3:4, 1:1, 4:3), **perspectiva** (arrasta os 4 cantos até a quina da cartela e o app endireita), girar 90° e ajustes de brilho, contraste, vibração, saturação, temperatura e nitidez. Os ajustes não são destrutivos: o original fica guardado e dá para refazer ou restaurar.
- **Visual de app do Mac**: barra de título integrada, tipografia do sistema (SF Pro), vidro fosco nas barras e modo claro/escuro automático, seguindo o macOS. Os temas coloridos ficam só nas imagens do catálogo.
- **Preencher ou Blur**: nunca há faixas brancas/pretas. Cada foto escolhe como ocupa o quadro do card e do catálogo: **Preencher** (padrão, ocupa tudo) ou **Blur** (foto inteira, com as sobras preenchidas por um desfoque dela mesma). Dá para trocar no editor ou direto na foto, no cadastro.
- **Backup**: exporta tudo (dados, fotos e vendas) num único `.zip` e importa de volta (mesclar ou substituir tudo).

## Onde ficam os dados

Tudo fica na pasta de dados do app. Nada vai para a internet.

- macOS: `~/Library/Application Support/com.garimpalo.app/`
- Windows: `%APPDATA%\com.garimpalo.app\`

Lá dentro ficam `garimpalo.db` (SQLite) e `images/`: para cada foto, o original (`o_*.webp`, até 2400 px, qualidade 92) e a versão final com os ajustes (`*.webp`, até 1600 px, qualidade 84). Formatos aceitos: JPG, PNG, WebP, GIF e BMP (HEIC do iPhone ainda não; exporte como JPG).

`exemplo/backup-exemplo-16-carros.zip` é um backup de exemplo para testar (Início → Importar backup).

## Desenvolvimento

Requisitos: Rust (stable) e Node 18+.

```bash
npm install
```

```bash
npm run tauri dev
```

O servidor de desenvolvimento usa a porta **1430**.

Testes do Rust (backup, imagens, segurança):

```bash
cd src-tauri && cargo test
```

## Gerar o instalador

```bash
npm run tauri build
```

No Mac sai o `.app` / `.dmg`. O instalador do Windows (`.msi` / `.exe`) precisa ser gerado **no Windows** (ou num CI como GitHub Actions); não dá para compilar para Windows a partir do Mac.

## Estrutura

```
src-tauri/src/
  lib.rs      comandos chamados pela interface
  db.rs       esquema e consultas do SQLite
  photos.rs   fotos: importar, orientação EXIF, recorte/perspectiva, cor, WebP
  photocraft/ homografia, recorte em perspectiva e ajustes de cor (adaptado do PhotoCraft, MIT)
  backup.rs   exportar/importar .zip
  sales.rs    vendas: registrar (com baixa no estoque), listar, desfazer
src/
  components/ Home, Garage, CarForm, PhotoSlots, PhotoEditor, FramedImage, Catalog, SaleForm, Sales
  catalog/render.ts  desenha as páginas do catálogo (canvas) nos 7 temas
```

## Créditos

O recorte em perspectiva (homografia + proporção real) e os ajustes de cor (brilho/contraste modernos, vibração com proteção de pele) foram adaptados do **PhotoCraft**, sob licença MIT — veja `src-tauri/src/photocraft/LICENSE-MIT`.
