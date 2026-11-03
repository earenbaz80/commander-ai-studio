import React, { useState } from 'react';
import { StructuredExample, ParameterConfig, ProviderType } from '../types/studio';
import { Language } from '../i18n/translations';

export interface StructuredPlaygroundProps {
  parameters: ParameterConfig;
  selectedModel: string;
  selectedProvider: ProviderType;
  isGenerating: boolean;
  onExecuteStructured: (examples: StructuredExample[], testInput: string) => Promise<string | undefined>;
  lang?: Language;
}

export const StructuredPlayground: React.FC<StructuredPlaygroundProps> = ({
  isGenerating,
  onExecuteStructured,
}) => {
  const [examples, setExamples] = useState<StructuredExample[]>([
    {
      id: '1',
      input: 'Convertir la frase "Reservar un vuelo a Madrid mañana por la mañana"',
      output: '{"intencion": "RESERVA_VUELO", "destino": "Madrid"}',
    },
    {
      id: '2',
      input: 'Convertir la frase "Cancelar mi suscripción mensual"',
      output: '{"intencion": "CANCELAR_SUSCRIPCION"}',
    },
  ]);

  const [testInput, setTestInput] = useState('Reservar una mesa para 4 personas en un restaurante italiano el viernes a las 8pm');
  const [resultOutput, setResultOutput] = useState('');
  const [copied, setCopied] = useState(false);

  const handleAddExample = () => {
    setExamples((prev) => [...prev, { id: Date.now().toString(), input: '', output: '' }]);
  };

  const handleRemoveExample = (id: string) => {
    setExamples((prev) => prev.filter((ex) => ex.id !== id));
  };

  const handleUpdateExample = (id: string, field: 'input' | 'output', value: string) => {
    setExamples((prev) => prev.map((ex) => (ex.id === id ? { ...ex, [field]: value } : ex)));
  };

  const handleRunTest = async () => {
    if (!testInput.trim() || isGenerating) return;
    const res = await onExecuteStructured(examples, testInput);
    if (res) setResultOutput(res);
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(resultOutput);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex-1 min-w-0 min-h-0 h-full flex flex-col bg-[var(--nc-bg-main)] font-mono text-xs text-[var(--nc-text)] p-2 overflow-hidden select-text">
      {/* Top Banner */}
      <div className="bg-[var(--nc-header-bg)] text-black font-bold px-3 py-1 flex items-center justify-between border-2 border-black shrink-0">
        <span>╔═ TABLA DE EJEMPLOS FEW-SHOT (.DAT) ═╗</span>
        <button
          onClick={handleAddExample}
          className="bg-[var(--nc-active-bg)] text-black font-bold px-2 py-0.5 border border-black hover:bg-white text-xs"
        >
          [+ AÑADIR EJEMPLO]
        </button>
      </div>

      <div className="flex-1 overflow-y-auto space-y-4 my-2">
        {/* Table Box */}
        <div className="border-2 border-[var(--nc-border-light)] bg-[var(--nc-bg-panel)] p-3 space-y-2">
          <div className="bg-[var(--nc-header-bg)] text-black font-bold px-2 py-0.5">
            EJEMPLOS DE ENTRENAMIENTO STRUCTURED
          </div>

          <table className="w-full text-left border-collapse border border-[var(--nc-border-light)]">
            <thead>
              <tr className="bg-[var(--nc-bg-main)] text-[var(--nc-text-accent)] border-b border-[var(--nc-border-light)]">
                <th className="p-2 border-r border-[var(--nc-border-light)] w-1/2">ENTRADA (INPUT)</th>
                <th className="p-2 border-r border-[var(--nc-border-light)] w-1/2">SALIDA ESPERADA (OUTPUT)</th>
                <th className="p-2 text-center w-10">DEL</th>
              </tr>
            </thead>
            <tbody>
              {examples.map((ex, _index) => (
                <tr key={ex.id} className="border-b border-[var(--nc-border-mid)]">
                  <td className="p-1.5 border-r border-[var(--nc-border-light)]">
                    <textarea
                      value={ex.input}
                      onChange={(e) => handleUpdateExample(ex.id, 'input', e.target.value)}
                      rows={2}
                      className="w-full bg-[var(--nc-bg-main)] border border-[var(--nc-border-mid)] p-1.5 text-xs text-white outline-none"
                    />
                  </td>
                  <td className="p-1.5 border-r border-[var(--nc-border-light)]">
                    <textarea
                      value={ex.output}
                      onChange={(e) => handleUpdateExample(ex.id, 'output', e.target.value)}
                      rows={2}
                      className="w-full bg-[var(--nc-bg-main)] border border-[var(--nc-border-mid)] p-1.5 text-xs text-[var(--nc-text-accent)] outline-none"
                    />
                  </td>
                  <td className="p-1.5 text-center">
                    <button
                      onClick={() => handleRemoveExample(ex.id)}
                      className="bg-red-600 text-white px-2 py-1 text-xs font-bold"
                    >
                      X
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Test Section */}
        <div className="border-2 border-[var(--nc-text-accent)] bg-[var(--nc-bg-panel)] p-3 space-y-2">
          <div className="bg-[var(--nc-active-bg)] text-black font-bold px-2 py-0.5">
            PRUEBA EN VIVO STRUCTURED
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-2">
              <label className="text-[var(--nc-text-accent)] font-bold block">ENTRADA DE PRUEBA:</label>
              <textarea
                value={testInput}
                onChange={(e) => setTestInput(e.target.value)}
                rows={3}
                className="w-full bg-[var(--nc-bg-main)] border border-[var(--nc-text-accent)] p-2 text-xs text-white outline-none"
              />
              <button
                onClick={handleRunTest}
                disabled={isGenerating}
                className="w-full bg-[var(--nc-active-bg)] text-black font-bold py-2 border border-white hover:bg-white"
              >
                [EJECUTAR PRUEBA ESTRUCTURADA]
              </button>
            </div>

            <div className="space-y-2">
              <div className="flex justify-between items-center text-[var(--nc-text-accent)] font-bold">
                <span>RESULTADO:</span>
                {resultOutput && (
                  <button onClick={handleCopy} className="bg-[var(--nc-bg-main)] text-[var(--nc-text-accent)] px-2 text-[10px]">
                    {copied ? '[COPIADO]' : '[COPIAR]'}
                  </button>
                )}
              </div>

              <div className="bg-[var(--nc-bg-main)] border border-[var(--nc-text-accent)] p-2 min-h-[100px] text-xs text-[var(--nc-text-accent)] whitespace-pre-wrap">
                {isGenerating ? 'Calculando estructura...' : resultOutput || 'Resultado aparecía aquí...'}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
