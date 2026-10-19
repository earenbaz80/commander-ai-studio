/**
 * Formatea un error de LLM para mostrarlo al usuario.
 * Detecta errores de cuota (429 / RESOURCE_EXHAUSTED) y da sugerencias.
 */
export function formatErrorMessage(error: any, model: string): string {
  const isQuotaError =
    error?.message?.includes('429') ||
    error?.message?.includes('quota') ||
    error?.message?.includes('RESOURCE_EXHAUSTED');
  return isQuotaError
    ? `Límite de cuota (Rate Limit) alcanzado para "${model}".\n\n💡 Sugerencia: En cuentas gratuitas de Google AI Studio, los modelos "Gemini 2.0 Flash" y "Gemini 2.0 Flash Lite" disponen de la mayor cuota gratuita (hasta 1,500 consultas al día y 15 por minuto). También puedes emplear modelos locales en el menú superior.`
    : (error?.message || 'Error desconocido');
}
