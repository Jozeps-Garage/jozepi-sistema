/**
 * Fica fora do módulo da sidebar porque o layout (server component) também lê
 * daqui: importar de um arquivo "use client" devolve uma referência de cliente,
 * não a string, e `cookies().get()` não acha nada.
 */
export const SIDEBAR_COOKIE = "sidebar";
export const SIDEBAR_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
