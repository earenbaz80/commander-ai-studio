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
    ? `Límite de cuota (Rate Limit) alcanzado para "${model}".\n\n💡 Sugerencia: en las cuentas gratuitas de Google AI Studio la cuota se mide por minuto y se recupera en unos segundos. Selecciona un modelo más ligero en el selector de modelos (los «flash lite» tienen más margen) o usa un modelo local desde el menú superior.`
    : (error?.message || 'Error desconocido');
}
