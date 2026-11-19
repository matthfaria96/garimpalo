import { useCallback, useEffect, useState } from "react";
import { api, Car, COLLECTION, errorMessage } from "./api";
import Home from "./components/Home";
import Garage from "./components/Garage";
import Catalog from "./components/Catalog";
import Sales from "./components/Sales";
import { ToastProvider, useToast } from "./components/Toast";
import { usePrefs } from "./i18n";

type View = { name: "home" } | { name: "garage" } | { name: "catalog" } | { name: "sales" };



function Shell() {
  const toast = useToast();
  const [view, setView] = useState<View>({ name: "home" });
  const [cars, setCars] = useState<Car[]>([]);
  const [selected, setSelected] = useState<string[]>([]);

  const reload = useCallback(async () => {
    try {
      const list = await api.listCars(COLLECTION);
      setCars(list);
      // tira da seleção o que foi apagado
      setSelected((sel) => sel.filter((id) => list.some((c) => c.id === id)));
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }, [toast]);

  useEffect(() => {
    reload();
  }, [reload]);

  if (view.name === "home") {
    return (
      <Home
        cars={cars}
        onOpen={() => setView({ name: "garage" })}
        onSales={() => setView({ name: "sales" })}
        onDataChanged={reload}
      />
    );
  }
  if (view.name === "sales") {
    return <Sales onBack={() => setView({ name: "home" })} onChanged={reload} />;
  }
  if (view.name === "catalog") {
    const items = selected
      .map((id) => cars.find((c) => c.id === id))
      .filter((c): c is Car => !!c);
    return (
      <Catalog
        items={items}
        onBack={() => setView({ name: "garage" })}
        onReorder={setSelected}
        onCarsChanged={reload}
      />
    );
  }
  return (
    <Garage
      cars={cars}
      selected={selected}
      onSelectedChange={setSelected}
      onBack={() => setView({ name: "home" })}
      onCatalog={() => setView({ name: "catalog" })}
      onChanged={reload}
    />
  );
}

export default function App() {
  return (
    <ToastProvider>
      <Shell key={usePrefs()} />
    </ToastProvider>
  );
}
