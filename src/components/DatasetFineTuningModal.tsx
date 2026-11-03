import { getCachedApiKey } from '../lib/apiKeys';
import React, { useState } from 'react';
import { X, Plus, Trash2, Download, FileText, Database, Sparkles } from 'lucide-react';
import { ParameterConfig } from '../types/studio';

interface DatasetFineTuningModalProps {
  isOpen: boolean;
  onClose: () => void;
  parameters: ParameterConfig;
  setParameters: React.Dispatch<React.SetStateAction<ParameterConfig>>;
  selectedModel: string;
}

export const DatasetFineTuningModal: React.FC<DatasetFineTuningModalProps> = ({
  isOpen,
  onClose,
  parameters,
  setParameters,
  selectedModel,
}) => {
  const [newInput, setNewInput] = useState('');
  const [newOutput, setNewOutput] = useState('');
  const [isGeneratingSynthetic, setIsGeneratingSynthetic] = useState(false);

  if (!isOpen) return null;

  const handleAddExample = () => {
    if (!newInput.trim() || !newOutput.trim()) return;
    setParameters((p) => ({
      ...p,
      examples: [
        ...p.examples,
        { id: Date.now().toString(), input: newInput.trim(), output: newOutput.trim() },
      ],
    }));
    setNewInput('');
    setNewOutput('');
  };

  const handleRemoveExample = (id: string) => {
    setParameters((p) => ({
      ...p,
      examples: p.examples.filter((ex) => ex.id !== id),
    }));
  };

  const handleGenerateSynthetic = async () => {
    setIsGeneratingSynthetic(true);
    try {
      const prompt = `Basado en la siguiente Instrucción del Sistema:
"${parameters.systemInstruction || 'Asistente de IA'}"

Genera 3 pares de ejemplos de entrenamiento en formato JSON puro.
Devuelve ÚNICAMENTE un arreglo JSON con la estructura:
[
  { "input": "...", "output": "..." },
  { "input": "...", "output": "..." },
  { "input": "...", "output": "..." }
]`;

      const apiKey = getCachedApiKey('GEMINI_API_KEY') || undefined;
      const response = await fetch('/api/gemini/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: prompt,
          systemInstruction: 'Eres un generador sintético de datasets de entrenamiento para modelos de lenguaje. Responde EXCLUSIVAMENTE con el JSON indicado.',
          model: selectedModel,
          parameters: { temperature: 0.7, topP: 0.95 },
          apiKey,
        }),
      });

      if (!response.ok) throw new Error('Error generando ejemplos');
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let rawText = '';
      let buffer = '';

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const dataStr = line.replace('data: ', '').trim();
              if (dataStr === '[DONE]') break;
              try {
                const parsed = JSON.parse(dataStr);
                if (parsed.error) throw new Error(parsed.error);
                if (parsed.text) rawText += parsed.text;
              } catch (e: any) {
                if (e.message && !e.message.includes('JSON')) {
                  throw e;
                }
              }
            }
          }
        }
      }

      // Try parsing JSON array
      const cleaned = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
      const parsedArray = JSON.parse(cleaned);

      if (Array.isArray(parsedArray)) {
        const generatedExamples = parsedArray.map((item: any, idx: number) => ({
          id: (Date.now() + idx).toString(),
          input: item.input || '',
          output: item.output || '',
        })).filter(item => item.input && item.output);

        setParameters((p) => ({
          ...p,
          examples: [...p.examples, ...generatedExamples],
        }));
      }
    } catch (error) {
      console.error('Error sintético:', error);
      alert('No se pudieron generar ejemplos automáticos. Verifica tu conexión o API Key.');
    } finally {
      setIsGeneratingSynthetic(false);
    }
  };

  const exportAsJsonl = () => {
    const lines = parameters.examples.map((ex) =>
      JSON.stringify({
        messages: [
          ...(parameters.systemInstruction ? [{ role: 'system', content: parameters.systemInstruction }] : []),
          { role: 'user', content: ex.input },
          { role: 'assistant', content: ex.output },
        ],
      })
    );
    const content = lines.join('\n');
    downloadBlob(content, 'dataset-fine-tuning.jsonl', 'application/jsonl');
  };

  const exportAsCsv = () => {
    const header = 'input,output\n';
    const rows = parameters.examples
      .map((ex) => `"${ex.input.replace(/"/g, '""')}","${ex.output.replace(/"/g, '""')}"`)
      .join('\n');
    downloadBlob(header + rows, 'dataset-fine-tuning.csv', 'text/csv');
  };

  const downloadBlob = (content: string, filename: string, mimeType: string) => {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div 
      className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 cursor-pointer"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div 
        className="bg-[var(--nc-bg-main)] border-4 border-[var(--nc-border-light)] w-full max-w-3xl max-h-[90vh] flex flex-col font-mono text-xs text-[var(--nc-text)] shadow-2xl overflow-hidden cursor-default"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="bg-[var(--nc-header-bg)] text-black font-bold px-3 py-2 flex items-center justify-between border-b-2 border-black">
          <div className="flex items-center gap-2">
            <Database className="w-5 h-5 text-black" />
            <span className="text-sm">DATASET & FEW-SHOT FINE-TUNING GRID</span>
          </div>
          <button onClick={onClose} className="nc-button bg-red-600 text-white hover:bg-red-500">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-4 flex-1 overflow-y-auto space-y-4 bg-[var(--nc-bg-panel)]">
          {/* Top Actions Banner */}
          <div className="bg-[var(--nc-bg-main)] border-2 border-[var(--nc-border-light)] p-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-[var(--nc-text-accent)] font-bold text-sm">Ejemplos Guardados: {parameters.examples.length}</div>
              <p className="text-[10px] text-white">
                Define pares Entrada ➔ Salida para guiar al modelo (Few-Shot) o exportar como dataset de ajuste fino (JSONL/CSV).
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleGenerateSynthetic}
                disabled={isGeneratingSynthetic}
                className="bg-[var(--nc-active-bg)] text-black font-bold px-3 py-1.5 border border-black hover:bg-white flex items-center gap-1.5 disabled:opacity-50"
              >
                <Sparkles className={`w-4 h-4 ${isGeneratingSynthetic ? 'animate-spin' : 'text-[var(--nc-active-text)]'}`} />
                <span>{isGeneratingSynthetic ? 'GENERANDO...' : '✨ GENERAR CON IA'}</span>
              </button>

              <button
                type="button"
                onClick={exportAsJsonl}
                disabled={parameters.examples.length === 0}
                className="bg-[var(--nc-header-bg)] text-black font-bold px-3 py-1.5 border border-black hover:bg-[var(--nc-highlight-bg)] flex items-center gap-1.5 disabled:opacity-50"
              >
                <Download className="w-4 h-4" />
                <span>EXPORTAR JSONL</span>
              </button>

              <button
                type="button"
                onClick={exportAsCsv}
                disabled={parameters.examples.length === 0}
                className="bg-[var(--nc-header-bg)] text-black font-bold px-3 py-1.5 border border-black hover:bg-[var(--nc-highlight-bg)] flex items-center gap-1.5 disabled:opacity-50"
              >
                <FileText className="w-4 h-4" />
                <span>EXPORTAR CSV</span>
              </button>
            </div>
          </div>

          {/* New Example Creator */}
          <div className="border-2 border-[var(--nc-border-light)] bg-[var(--nc-bg-main)] p-3 space-y-2">
            <div className="text-[var(--nc-text-accent)] font-bold">AGREGAR NUEVO EJEMPLO PAIR</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] text-[var(--nc-text)] font-bold block mb-1">ENTRADA (USER INPUT):</label>
                <textarea
                  value={newInput}
                  onChange={(e) => setNewInput(e.target.value)}
                  rows={2}
                  className="w-full bg-[var(--nc-bg-panel)] border border-[var(--nc-border-light)] p-2 text-white outline-none font-mono text-xs"
                  placeholder="Ej: Clasifica la intención: Quiero cancelar mi suscripción"
                />
              </div>

              <div>
                <label className="text-[10px] text-[var(--nc-text-accent)] font-bold block mb-1">SALIDA (MODEL OUTPUT):</label>
                <textarea
                  value={newOutput}
                  onChange={(e) => setNewOutput(e.target.value)}
                  rows={2}
                  className="w-full bg-[var(--nc-bg-panel)] border border-[var(--nc-border-light)] p-2 text-white outline-none font-mono text-xs"
                  placeholder='Ej: { "categoria": "baja_servicio", "prioridad": "alta" }'
                />
              </div>
            </div>

            <button
              type="button"
              onClick={handleAddExample}
              disabled={!newInput.trim() || !newOutput.trim()}
              className="w-full bg-[var(--nc-header-bg)] text-black font-bold py-1.5 hover:bg-[var(--nc-highlight-bg)] disabled:opacity-50 flex items-center justify-center gap-2"
            >
              <Plus className="w-4 h-4" />
              <span>AGREGAR AL DATASET</span>
            </button>
          </div>

          {/* List of Examples */}
          <div className="space-y-2">
            {parameters.examples.length === 0 ? (
              <div className="text-center py-8 border-2 border-dashed border-[var(--nc-border-light)] text-white">
                No hay ejemplos guardados. Agrega pares manualmente o usa el generador sintético con IA.
              </div>
            ) : (
              parameters.examples.map((ex, index) => (
                <div key={ex.id} className="border-2 border-[var(--nc-border-light)] bg-[var(--nc-bg-main)] p-2 space-y-1 relative group">
                  <div className="flex justify-between items-center bg-[var(--nc-bg-panel)] px-2 py-0.5 border border-[var(--nc-border-mid)]">
                    <span className="font-bold text-[var(--nc-text-accent)]">EJEMPLO #{index + 1}</span>
                    <button
                      onClick={() => handleRemoveExample(ex.id)}
                      className="text-red-400 hover:text-red-200"
                      title="Eliminar ejemplo"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs pt-1">
                    <div className="bg-[var(--nc-bg-panel)] p-2 border border-[var(--nc-border-mid)]">
                      <div className="text-[10px] text-[var(--nc-text)] font-bold mb-0.5">ENTRADA:</div>
                      <p className="text-white whitespace-pre-wrap">{ex.input}</p>
                    </div>

                    <div className="bg-[var(--nc-bg-panel)] p-2 border border-[var(--nc-border-mid)]">
                      <div className="text-[10px] text-[var(--nc-text-accent)] font-bold mb-0.5">SALIDA ESPERADA:</div>
                      <p className="text-white whitespace-pre-wrap">{ex.output}</p>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Modal Footer */}
        <div className="bg-[var(--nc-header-bg)] p-2 flex justify-end border-t-2 border-black">
          <button onClick={onClose} className="nc-button bg-[var(--nc-bg-main)] text-[var(--nc-text-accent)]">
            CERRAR Y GUARDAR EN SESIÓN
          </button>
        </div>
      </div>
    </div>
  );
};
