import React, { useState } from 'react';
import { X, Plus, Trash2, Wrench } from 'lucide-react';
import { FunctionDeclarationItem } from '../types/studio';

interface FunctionCallingModalProps {
  isOpen: boolean;
  onClose: () => void;
  functions: FunctionDeclarationItem[];
  onSaveFunctions: (functions: FunctionDeclarationItem[]) => void;
}

const PRESET_FUNCTIONS: { name: string; description: string; parametersJson: string }[] = [
  {
    name: 'consultarClima',
    description: 'Obtiene las condiciones meteorológicas actuales de una ciudad determinada.',
    parametersJson: JSON.stringify({
      type: 'OBJECT',
      properties: {
        ciudad: { type: 'STRING', description: 'Nombre de la ciudad, ej. Madrid, Tokio, Buenos Aires' },
        unidad: { type: 'STRING', enum: ['celsius', 'fahrenheit'], description: 'Unidad de temperatura' }
      },
      required: ['ciudad']
    }, null, 2)
  },
  {
    name: 'buscarProducto',
    description: 'Busca artículos e inventarios en la base de datos de comercio electrónico.',
    parametersJson: JSON.stringify({
      type: 'OBJECT',
      properties: {
        query: { type: 'STRING', description: 'Término de búsqueda' },
        precio_maximo: { type: 'NUMBER', description: 'Filtro de precio máximo opcional' }
      },
      required: ['query']
    }, null, 2)
  },
  {
    name: 'enviarCorreoNotificacion',
    description: 'Envía un mensaje de correo electrónico al destinatario especificado.',
    parametersJson: JSON.stringify({
      type: 'OBJECT',
      properties: {
        destinatario: { type: 'STRING', description: 'Dirección de email' },
        asunto: { type: 'STRING', description: 'Asunto del mensaje' },
        cuerpo: { type: 'STRING', description: 'Contenido principal del correo' }
      },
      required: ['destinatario', 'asunto', 'cuerpo']
    }, null, 2)
  }
];

export const FunctionCallingModal: React.FC<FunctionCallingModalProps> = ({
  isOpen,
  onClose,
  functions,
  onSaveFunctions,
}) => {
  const [items, setItems] = useState<FunctionDeclarationItem[]>(
    functions.length > 0 ? functions : [
      {
        id: '1',
        name: 'consultarClima',
        description: 'Obtiene el clima actual de una ubicación dada.',
        parametersJson: PRESET_FUNCTIONS[0].parametersJson
      }
    ]
  );

  const handleAddFunction = () => {
    const newItem: FunctionDeclarationItem = {
      id: Date.now().toString(),
      name: `miFuncion_${items.length + 1}`,
      description: 'Descripción de la función...',
      parametersJson: JSON.stringify({
        type: 'OBJECT',
        properties: {
          parametro1: { type: 'STRING', description: 'Descripción del parámetro' }
        },
        required: ['parametro1']
      }, null, 2)
    };
    setItems([...items, newItem]);
  };

  const handleUpdate = (id: string, updates: Partial<FunctionDeclarationItem>) => {
    setItems(items.map((it) => (it.id === id ? { ...it, ...updates } : it)));
  };

  const handleRemove = (id: string) => {
    setItems(items.filter((it) => it.id !== id));
  };

  const handleApplyPreset = (presetIdx: number) => {
    const preset = PRESET_FUNCTIONS[presetIdx];
    if (preset) {
      const newItem: FunctionDeclarationItem = {
        id: Date.now().toString(),
        name: preset.name,
        description: preset.description,
        parametersJson: preset.parametersJson
      };
      setItems([...items, newItem]);
    }
  };

  const handleSave = () => {
    onSaveFunctions(items);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-2 sm:p-4 font-mono select-none cursor-pointer"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div 
        className="bg-[var(--nc-bg-main)] border-2 border-[var(--nc-border-light)] w-full max-w-3xl max-h-[90vh] flex flex-col shadow-2xl cursor-default"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="bg-[var(--nc-header-bg)] text-black font-bold px-3 py-2 flex items-center justify-between border-b-2 border-black">
          <div className="flex items-center gap-2">
            <Wrench className="w-4 h-4 text-black" />
            <span className="text-xs sm:text-sm">╔═ CONFIGURACIÓN DE FUNCIONES PERSONALIZADAS (FUNCTION CALLING) ═╗</span>
          </div>
          <button type="button" onClick={onClose} className="nc-button px-2 py-0.5 text-xs hover:bg-red-600 hover:text-white">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Toolbar */}
        <div className="bg-[var(--nc-bg-panel)] border-b border-[var(--nc-border-light)] p-2 flex items-center justify-between gap-2 text-xs">
          <button
            type="button"
            onClick={handleAddFunction}
            className="nc-button text-xs bg-[var(--nc-header-bg)] text-black font-bold flex items-center gap-1"
          >
            <Plus className="w-3.5 h-3.5" /> AGREGAR NUEVA FUNCIÓN
          </button>

          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-[var(--nc-text-accent)] font-bold hidden sm:inline">AGREGAR PLANTILLA:</span>
            <select
              onChange={(e) => {
                if (e.target.value !== '') {
                  handleApplyPreset(parseInt(e.target.value, 10));
                  e.target.value = '';
                }
              }}
              defaultValue=""
              className="bg-[var(--nc-bg-main)] text-[var(--nc-text)] border border-[var(--nc-border-light)] p-1 text-[11px] outline-none font-bold"
            >
              <option value="" disabled>Seleccionar Ejemplo...</option>
              {PRESET_FUNCTIONS.map((p, idx) => (
                <option key={idx} value={idx}>{p.name}</option>
              ))}
            </select>
          </div>
        </div>

        {/* List of Functions */}
        <div className="flex-1 overflow-y-auto p-3 space-y-3 text-xs min-h-[300px]">
          {items.length === 0 ? (
            <div className="text-center py-10 text-[var(--nc-text)] italic">
              No has configurado funciones. Haz clic en "+ AGREGAR NUEVA FUNCIÓN" o selecciona una plantilla.
            </div>
          ) : (
            items.map((item, idx) => (
              <div key={item.id} className="bg-[var(--nc-bg-panel)] border-2 border-[var(--nc-border-light)] p-3 space-y-2 relative">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 flex-1">
                    <span className="text-[var(--nc-text-accent)] font-bold text-xs">{idx + 1}.</span>
                    <input
                      type="text"
                      value={item.name}
                      onChange={(e) => handleUpdate(item.id, { name: e.target.value })}
                      placeholder="nombre_funcion"
                      className="bg-[var(--nc-bg-main)] border border-[var(--nc-border-light)] text-white px-2 py-1 text-xs font-bold outline-none flex-1"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRemove(item.id)}
                    className="text-red-400 hover:text-white p-1"
                    title="Eliminar función"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>

                <div>
                  <label className="text-[10px] text-[var(--nc-text-accent)] font-bold block mb-0.5">DESCRIPCIÓN PARA GEMINI:</label>
                  <input
                    type="text"
                    value={item.description}
                    onChange={(e) => handleUpdate(item.id, { description: e.target.value })}
                    placeholder="Instrucción de cuándo Gemini debe invocar esta función..."
                    className="w-full bg-[var(--nc-bg-main)] border border-[var(--nc-border-mid)] text-xs text-white px-2 py-1 outline-none"
                  />
                </div>

                <div>
                  <label className="text-[10px] text-[var(--nc-text)] font-bold block mb-0.5">PARÁMETROS (JSON SCHEMA):</label>
                  <textarea
                    value={item.parametersJson}
                    onChange={(e) => handleUpdate(item.id, { parametersJson: e.target.value })}
                    rows={4}
                    className="w-full bg-[var(--nc-bg-main)] border border-[var(--nc-border-mid)] text-[11px] font-mono text-[var(--nc-text)] p-2 outline-none resize-none"
                  />
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="bg-[var(--nc-header-bg)] p-2 flex items-center justify-between border-t-2 border-black">
          <span className="text-[10px] text-black font-bold">
            {items.length} {items.length === 1 ? 'función activa' : 'funciones activas'}
          </span>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onClose} className="nc-button text-xs">Cancelar</button>
            <button
              type="button"
              onClick={handleSave}
              className="nc-button text-xs bg-[var(--nc-active-bg)] text-black font-bold border-2 border-white hover:bg-white"
            >
              [ GUARDAR FUNCIONES ]
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
