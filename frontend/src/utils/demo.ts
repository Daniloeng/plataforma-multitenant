/** Indica se a aplicação está rodando com a API simulada (MSW). */
export function isDemoMode(): boolean {
  return import.meta.env.VITE_DEMO === 'true';
}
