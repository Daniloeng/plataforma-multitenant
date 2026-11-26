// Utilitários HTTP compartilhados pelos clientes da API.

/** Erro de resposta da API (HTTP diferente de 2xx ou corpo fora do contrato). */
export class ApiError extends Error {
  readonly httpStatus: number | null;

  constructor(message: string, httpStatus: number | null = null) {
    super(message);
    this.name = 'ApiError';
    this.httpStatus = httpStatus;
  }
}

/**
 * URL absoluta de um caminho da API, respeitando o BASE_URL do Vite ('/' ou
 * '/plataforma-multitenant/'). `path` vem sem barra inicial, ex.: 'api/v1/tenants'.
 */
export function apiUrl(
  path: string,
  baseUrl: string = import.meta.env.BASE_URL,
  origin: string = window.location.origin,
): string {
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  return new URL(`${base}${path}`, origin).toString();
}
