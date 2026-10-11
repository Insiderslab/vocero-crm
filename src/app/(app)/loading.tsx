import { ListSkeleton, Skeleton } from "@/components/ui/skeleton";

/**
 * 009 (E3/E6) — Carga de cualquier sección de la app.
 *
 * Dos efectos:
 * 1. Navegar enseña ESTO al instante, en vez de dejar la pantalla anterior
 *    quieta sin ninguna señal mientras llega la nueva.
 * 2. Es un límite de Suspense alrededor de la página: si un clic llega antes
 *    de que la página termine de hidratar, React lo guarda y lo repite al
 *    hidratar ese límite, en vez de perderlo.
 */
export default function AppLoading() {
  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b px-4 py-3 sm:px-6 sm:py-4">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-8 w-28" />
      </header>
      <div className="min-h-0 flex-1 overflow-hidden">
        <ListSkeleton rows={8} />
      </div>
    </div>
  );
}
