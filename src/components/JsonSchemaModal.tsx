import React, { useState, useEffect } from 'react';
import { X, Plus, Trash2, Check, Copy, FileJson } from 'lucide-react';
import { StructuredOutputConfig, SchemaProperty } from '../types/studio';

interface JsonSchemaModalProps {
  isOpen: boolean;
  onClose: () => void;
  config?: StructuredOutputConfig;
  onSaveSchema: (schemaJson: string, config: StructuredOutputConfig) => void;
}

const SCHEMA_PRESETS: { name: string; description: string; properties: SchemaProperty[]; rootType: 'OBJECT' | 'ARRAY' }[] = [
  {
    name: 'Análisis de Sentimiento y Clasificación',
    description: 'Clasifica el texto y extrae sentimiento, confianza y palabras clave.',
    rootType: 'OBJECT',
    properties: [
      { id: '1', name: 'sentimiento', type: 'ENUM', enumValues: ['positivo', 'neutral', 'negativo'], required: true, description: 'Sentimiento predominante en el texto.' },
      { id: '2', name: 'puntuacion_confianza', type: 'NUMBER', required: true, description: 'Nivel de confianza del análisis del 0.0 al 1.0.' },
      { id: '3', name: 'palabras_clave', type: 'ARRAY', arrayItemType: 'STRING', required: true, description: 'Términos o conceptos clave mencionados.' },
      { id: '4', name: 'resumen_breve', type: 'STRING', required: false, description: 'Resumen en una frase del análisis.' }
    ]
  },
  {
    name: 'Extracción de Información de Producto',
    description: 'Extrae nombre, precio, categoría, disponibilidad y características.',
    rootType: 'OBJECT',
    properties: [
      { id: '1', name: 'nombre_producto', type: 'STRING', required: true, description: 'Nombre completo o comercial del producto.' },
      { id: '2', name: 'precio', type: 'NUMBER', required: true, description: 'Precio monetario numérico.' },
      { id: '3', name: 'moneda', type: 'ENUM', enumValues: ['USD', 'EUR', 'MXN', 'ARS', 'GBP'], required: true, description: 'Código ISO de la divisa.' },
      { id: '4', name: 'en_stock', type: 'BOOLEAN', required: true, description: 'Si el artículo se encuentra disponible para compra.' },
      { id: '5', name: 'especificaciones', type: 'ARRAY', arrayItemType: 'STRING', required: false, description: 'Lista de especificaciones técnicas principales.' }
    ]
  },
  {
    name: 'Lista de Tareas / Pasos Estructurados',
    description: 'Desglosa un objetivo en una serie ordenada de acciones numeradas.',
    rootType: 'OBJECT',
    properties: [
      { id: '1', name: 'titulo_proyecto', type: 'STRING', required: true, description: 'Título general del objetivo o proyecto.' },
      { id: '2', name: 'duracion_estimada_minutos', type: 'NUMBER', required: false, description: 'Tiempo aproximado para completar todo el proceso.' },
      { id: '3', name: 'pasos', type: 'ARRAY', arrayItemType: 'STRING', required: true, description: 'Pasos secuenciales para completar la tarea.' },
      { id: '4', name: 'requiere_supervision', type: 'BOOLEAN', required: false, description: 'Si se requiere aprobación humana para continuar.' }
    ]
  }
];

export const JsonSchemaModal: React.FC<JsonSchemaModalProps> = ({
  isOpen,
  onClose,
  config,
  onSaveSchema,
}) => {
  const [activeTab, setActiveTab] = useState<'visual' | 'raw'>('visual');
  const [rootType, setRootType] = useState<'OBJECT' | 'ARRAY'>('OBJECT');
  const [properties, setProperties] = useState<SchemaProperty[]>([
    { id: '1', name: 'resultado', type: 'STRING', required: true, description: 'Respuesta principal esperada.' },
    { id: '2', name: 'confianza', type: 'NUMBER', required: true, description: 'Nivel numérico de 0 a 1.' },
  ]);
  const [rawJson, setRawJson] = useState<string>('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (config?.properties && config.properties.length > 0) {
      setProperties(config.properties);
      setRootType(config.rootType || 'OBJECT');
    }
    if (config?.rawSchemaJson) {
      setRawJson(config.rawSchemaJson);
    }
  }, [config]);

  // Generate Gemini-compatible JSON Schema from visual properties
  const generateSchema = () => {
    const propsObj: Record<string, any> = {};
    const requiredArr: string[] = [];

    properties.forEach((prop) => {
      if (!prop.name.trim()) return;
      const cleanName = prop.name.trim().replace(/\s+/g, '_');
      
      const propDef: any = {
        type: prop.type,
      };

      if (prop.description?.trim()) {
        propDef.description = prop.description.trim();
      }

      if (prop.type === 'ENUM' && prop.enumValues && prop.enumValues.length > 0) {
        propDef.enum = prop.enumValues;
      }

      if (prop.type === 'ARRAY') {
        propDef.items = {
          type: prop.arrayItemType || 'STRING',
        };
      }

      propsObj[cleanName] = propDef;

      if (prop.required) {
        requiredArr.push(cleanName);
      }
    });

    if (rootType === 'ARRAY') {
      return {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: propsObj,
          required: requiredArr.length > 0 ? requiredArr : undefined,
        },
      };
    }

    return {
      type: 'OBJECT',
      properties: propsObj,
      required: requiredArr.length > 0 ? requiredArr : undefined,
    };
  };

  const currentSchema = generateSchema();
  const currentSchemaString = JSON.stringify(currentSchema, null, 2);

  const handleAddProperty = () => {
    const newProp: SchemaProperty = {
      id: Date.now().toString(),
      name: `campo_${properties.length + 1}`,
      type: 'STRING',
      required: true,
      description: '',
    };
    setProperties([...properties, newProp]);
  };

  const handleUpdateProperty = (id: string, updates: Partial<SchemaProperty>) => {
    setProperties(properties.map((p) => (p.id === id ? { ...p, ...updates } : p)));
  };

  const handleRemoveProperty = (id: string) => {
    setProperties(properties.filter((p) => p.id !== id));
  };

  const handleApplyPreset = (presetIndex: number) => {
    const preset = SCHEMA_PRESETS[presetIndex];
    if (preset) {
      setProperties(preset.properties);
      setRootType(preset.rootType);
    }
  };

  const handleSave = () => {
    const schemaToSave = activeTab === 'raw' && rawJson.trim() ? rawJson : currentSchemaString;
    const finalConfig: StructuredOutputConfig = {
      enabled: true,
      rootType,
      properties,
      rawSchemaJson: schemaToSave,
      mode: activeTab,
    };
    onSaveSchema(schemaToSave, finalConfig);
    onClose();
  };

  const handleCopySchema = () => {
    navigator.clipboard.writeText(activeTab === 'raw' && rawJson.trim() ? rawJson : currentSchemaString);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!isOpen) return null;

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-2 sm:p-4 font-mono select-none cursor-pointer"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div 
        className="bg-[#0000aa] border-2 border-[#00ffff] w-full max-w-4xl max-h-[92vh] flex flex-col shadow-2xl cursor-default"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="bg-[#00aaaa] text-black font-bold px-3 py-2 flex items-center justify-between border-b-2 border-black">
          <div className="flex items-center gap-2">
            <FileJson className="w-4 h-4 text-black" />
            <span className="text-xs sm:text-sm">╔═ CONSTRUCTOR DE SALIDA ESTRUCTURADA (JSON SCHEMA) ═╗</span>
          </div>
          <button 
            type="button" 
            onClick={onClose} 
            className="nc-button px-2 py-0.5 text-xs hover:bg-red-600 hover:text-white"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Toolbar & Tabs */}
        <div className="bg-[#000080] border-b border-[#00ffff] p-2 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setActiveTab('visual')}
              className={`px-3 py-1 font-bold border transition-colors ${
                activeTab === 'visual' ? 'bg-[#ffff55] text-black border-white' : 'bg-[#0000aa] text-[#00ffff] border-[#00aaaa]'
              }`}
            >
              [ CONSTRUCTOR VISUAL ]
            </button>
            <button
              type="button"
              onClick={() => {
                setRawJson(currentSchemaString);
                setActiveTab('raw');
              }}
              className={`px-3 py-1 font-bold border transition-colors ${
                activeTab === 'raw' ? 'bg-[#ffff55] text-black border-white' : 'bg-[#0000aa] text-[#00ffff] border-[#00aaaa]'
              }`}
            >
              [ EDITOR RAW JSON ]
            </button>
          </div>

          {/* Preset Selector */}
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-[#ffff55] font-bold hidden sm:inline">PLANTILLAS RÁPIDAS:</span>
            <select
              onChange={(e) => {
                if (e.target.value !== '') {
                  handleApplyPreset(parseInt(e.target.value, 10));
                  e.target.value = '';
                }
              }}
              defaultValue=""
              className="bg-[#0000aa] text-[#ffff55] border border-[#00ffff] p-1 text-[11px] outline-none"
            >
              <option value="" disabled>Seleccionar Plantilla...</option>
              {SCHEMA_PRESETS.map((p, idx) => (
                <option key={idx} value={idx}>{p.name}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-3 grid grid-cols-1 lg:grid-cols-12 gap-3 text-xs min-h-[350px]">
          {/* Left Column: Visual Builder or Raw Editor */}
          <div className="lg:col-span-7 flex flex-col space-y-3">
            {activeTab === 'visual' ? (
              <>
                <div className="flex items-center justify-between bg-[#000080] border border-[#00ffff] p-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-bold text-[#ffff55]">TIPO RAÍZ:</span>
                    <button
                      type="button"
                      onClick={() => setRootType('OBJECT')}
                      className={`px-2 py-0.5 font-bold border text-[10px] ${
                        rootType === 'OBJECT' ? 'bg-[#00ffff] text-black' : 'bg-[#0000aa] text-white'
                      }`}
                    >
                      OBJECT (Objeto Único)
                    </button>
                    <button
                      type="button"
                      onClick={() => setRootType('ARRAY')}
                      className={`px-2 py-0.5 font-bold border text-[10px] ${
                        rootType === 'ARRAY' ? 'bg-[#00ffff] text-black' : 'bg-[#0000aa] text-white'
                      }`}
                    >
                      ARRAY (Lista de Objetos)
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={handleAddProperty}
                    className="nc-button text-[10px] flex items-center gap-1 bg-[#00aaaa] text-black"
                  >
                    <Plus className="w-3 h-3" /> AGREGAR CAMPO
                  </button>
                </div>

                {/* Properties List */}
                <div className="space-y-2 max-h-[380px] overflow-y-auto pr-1">
                  {properties.map((prop, idx) => (
                    <div key={prop.id} className="bg-[#000080] border border-[#00ffff] p-2 space-y-1.5 relative">
                      <div className="flex items-center gap-2">
                        <span className="text-[#ffff55] font-bold text-[10px]">{idx + 1}.</span>
                        <input
                          type="text"
                          value={prop.name}
                          onChange={(e) => handleUpdateProperty(prop.id, { name: e.target.value })}
                          placeholder="nombre_campo"
                          className="flex-1 bg-[#0000aa] border border-[#00ffff] text-white px-2 py-0.5 text-xs font-bold outline-none"
                        />
                        <select
                          value={prop.type}
                          onChange={(e) => handleUpdateProperty(prop.id, { type: e.target.value as any })}
                          className="bg-[#0000aa] border border-[#00ffff] text-[#ffff55] px-1 py-0.5 text-xs font-bold outline-none"
                        >
                          <option value="STRING">STRING (Texto)</option>
                          <option value="NUMBER">NUMBER (Número)</option>
                          <option value="BOOLEAN">BOOLEAN (Verdadero/Falso)</option>
                          <option value="ARRAY">ARRAY (Lista)</option>
                          <option value="ENUM">ENUM (Opciones Fijas)</option>
                        </select>
                        <label className="flex items-center gap-1 text-[10px] text-[#00ffff] cursor-pointer">
                          <input
                            type="checkbox"
                            checked={prop.required}
                            onChange={(e) => handleUpdateProperty(prop.id, { required: e.target.checked })}
                            className="accent-[#00ffff]"
                          />
                          Req
                        </label>
                        <button
                          type="button"
                          onClick={() => handleRemoveProperty(prop.id)}
                          className="text-red-400 hover:text-white p-1"
                          title="Eliminar campo"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      {/* Enum Values Configuration */}
                      {prop.type === 'ENUM' && (
                        <div className="bg-[#0000aa] border border-[#00aaaa] p-1.5 flex items-center gap-2">
                          <span className="text-[10px] text-[#ffff55]">VALORES PERMITIDOS (separados por coma):</span>
                          <input
                            type="text"
                            value={(prop.enumValues || []).join(', ')}
                            onChange={(e) => handleUpdateProperty(prop.id, {
                              enumValues: e.target.value.split(',').map((v) => v.trim()).filter(Boolean),
                            })}
                            placeholder="opcion1, opcion2, opcion3"
                            className="flex-1 bg-[#000080] border border-[#00ffff] text-white px-1.5 py-0.5 text-xs"
                          />
                        </div>
                      )}

                      {/* Array item type */}
                      {prop.type === 'ARRAY' && (
                        <div className="bg-[#0000aa] border border-[#00aaaa] p-1.5 flex items-center gap-2">
                          <span className="text-[10px] text-[#ffff55]">TIPO DE ELEMENTOS DE LA LISTA:</span>
                          <select
                            value={prop.arrayItemType || 'STRING'}
                            onChange={(e) => handleUpdateProperty(prop.id, { arrayItemType: e.target.value as any })}
                            className="bg-[#000080] border border-[#00ffff] text-white px-1.5 py-0.5 text-xs"
                          >
                            <option value="STRING">STRING</option>
                            <option value="NUMBER">NUMBER</option>
                            <option value="BOOLEAN">BOOLEAN</option>
                          </select>
                        </div>
                      )}

                      {/* Description */}
                      <input
                        type="text"
                        value={prop.description || ''}
                        onChange={(e) => handleUpdateProperty(prop.id, { description: e.target.value })}
                        placeholder="Descripción para guiar al modelo (opcional)..."
                        className="w-full bg-[#0000aa] border border-[#00aaaa] text-[10px] text-white px-2 py-0.5"
                      />
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="flex-1 flex flex-col space-y-1">
                <span className="text-[11px] text-[#ffff55] font-bold">ESQUEMA JSON SCHEMA BRUTO:</span>
                <textarea
                  value={rawJson}
                  onChange={(e) => setRawJson(e.target.value)}
                  className="flex-1 w-full bg-[#000080] border-2 border-[#00ffff] p-2 text-xs font-mono text-white outline-none resize-none min-h-[300px]"
                  placeholder="Introduce el esquema JSON compatible con OpenAPI / Gemini..."
                />
              </div>
            )}
          </div>

          {/* Right Column: Live JSON Schema Output Preview */}
          <div className="lg:col-span-5 flex flex-col space-y-2 bg-[#000080] border-2 border-[#00ffff] p-2.5">
            <div className="flex items-center justify-between border-b border-[#00ffff] pb-1">
              <span className="text-[11px] font-bold text-[#ffff55]">PREVISUALIZACIÓN JSON SCHEMA:</span>
              <button
                type="button"
                onClick={handleCopySchema}
                className="nc-button text-[10px] py-0.5 px-2 flex items-center gap-1"
              >
                {copied ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
                {copied ? 'COPIADO' : 'COPIAR'}
              </button>
            </div>
            
            <pre className="flex-1 bg-[#0000aa] border border-[#00aaaa] p-2 text-[10px] text-[#00ffff] overflow-auto max-h-[350px] font-mono leading-relaxed">
              {activeTab === 'raw' && rawJson.trim() ? rawJson : currentSchemaString}
            </pre>

            <div className="border-t border-[#00aaaa] pt-2 text-[10px] text-[#ffff55] space-y-1">
              <div className="font-bold">💡 EFECTO EN GEMINI:</div>
              <p className="text-white/80 leading-normal">
                Al activar este esquema, Gemini responderá <strong>estrictamente</strong> en formato JSON validado según esta estructura, sin texto adicional ni markdown circundante.
              </p>
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="bg-[#00aaaa] p-2 flex items-center justify-between border-t-2 border-black">
          <button
            type="button"
            onClick={() => {
              setProperties([]);
              setRawJson('');
            }}
            className="nc-button text-xs hover:bg-red-600 hover:text-white"
          >
            Limpiar Campos
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="nc-button text-xs"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="nc-button text-xs bg-[#ffff55] text-black font-bold border-2 border-white hover:bg-white"
            >
              [ APLICAR ESQUEMA AL MODELO ]
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
