import { createContext, ReactNode, useCallback, useContext, useMemo, useState } from "react";

type Kind = "ok" | "error";
interface Item {
  id: number;
  kind: Kind;
  text: string;
}
interface ToastApi {
  ok: (text: string) => void;
  error: (text: string) => void;
}

const Ctx = createContext<ToastApi>({ ok: () => {}, error: () => {} });
let seq = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Item[]>([]);
  const push = useCallback((kind: Kind, text: string) => {
    const id = ++seq;
    setItems((l) => [...l, { id, kind, text }]);
    setTimeout(() => setItems((l) => l.filter((i) => i.id !== id)), kind === "error" ? 6000 : 3200);
  }, []);
  const value = useMemo(
    () => ({ ok: (t: string) => push("ok", t), error: (t: string) => push("error", t) }),
    [push],
  );
  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="toasts">
        {items.map((i) => (
          <div key={i.id} className={`toast toast-${i.kind}`}>
            {i.text}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx);
