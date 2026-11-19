import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource-variable/inter";
import "@fontsource/oswald/400.css";
import "@fontsource/oswald/500.css";
import "@fontsource/oswald/600.css";
import "@fontsource/oswald/700.css";
import "@fontsource/playfair-display/700.css";
import "./styles.css";
import App from "./App";
import { initApi } from "./api";

// No app (macOS) a barra de título é transparente: o topo abre espaço para os botões da janela.
if ("__TAURI_INTERNALS__" in window && /Mac/i.test(navigator.userAgent)) {
  document.documentElement.classList.add("mac-window");
}

initApi().finally(() => {
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
});
