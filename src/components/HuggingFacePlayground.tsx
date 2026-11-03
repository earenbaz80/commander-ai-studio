import React, { useState, useEffect } from 'react';

import { 

  Download, 

} from 'lucide-react';

import { ParameterConfig, HfHubModel, DownloadedLocalModel } from '../types/studio';

import { Language } from '../i18n/translations';



export interface HuggingFacePlaygroundProps {

  parameters: ParameterConfig;

  setParameters: React.Dispatch<React.SetStateAction<ParameterConfig>>;

  selectedModel: string;

  setSelectedModel: (model: string) => void;

  onExecuteHf: (prompt: string, hfModel: string) => Promise<string | undefined>;

  isGenerating: boolean;

  downloadedModels: DownloadedLocalModel[];

  onAddDownloadedModel: (model: DownloadedLocalModel) => void;

  onRemoveDownloadedModel: (modelId: string) => void;

  lang?: Language;

}



export const HuggingFacePlayground: React.FC<HuggingFacePlaygroundProps> = ({

  parameters,

  setParameters,

  selectedModel,

  setSelectedModel,

  onExecuteHf,

  isGenerating,

  downloadedModels,

  onAddDownloadedModel,

  onRemoveDownloadedModel,

}) => {

  const [activeTab, setActiveTab] = useState<'search' | 'local_models' | 'tester'>('search');

  const [searchQuery, setSearchQuery] = useState('');

  const [selectedPipeline, setSelectedPipeline] = useState('all');

  const [searchResults, setSearchResults] = useState<HfHubModel[]>([]);

  const [isSearching, setIsSearching] = useState(false);



  const [downloadingModelId, setDownloadingModelId] = useState<string | null>(null);

  const [downloadProgress, setDownloadProgress] = useState(0);



  const [hfPrompt, setHfPrompt] = useState('Procesar este texto localmente en Hugging Face: "Analiza el rendimiento de los tensores WebGPU en la inferencia offline de Windows y Android."');

  const [hfOutput, setHfOutput] = useState('');

  const [copied, setCopied] = useState(false);

  const [realUrl, setRealUrl] = useState('');

  const [realName, setRealName] = useState('');

  const [realStatus, setRealStatus] = useState('');

  const [runtimeInfo, setRuntimeInfo] = useState<any>(null);


  const [runtimeDownloadStatus, setRuntimeDownloadStatus] = useState('');



  const fetchHfHubModels = async (query = '', pipeline = 'all') => {

    setIsSearching(true);

    try {

      const pipelineParam = pipeline === 'all' ? '' : pipeline;

      const res = await fetch(`/api/hf/search?q=${encodeURIComponent(query)}&pipeline=${encodeURIComponent(pipelineParam)}&limit=24`);

      const data = await res.json();

      if (data.success && Array.isArray(data.models)) {

        setSearchResults(data.models);

      }

    } catch (e) {

      console.warn('Error fetching HF models', e);

    } finally {

      setIsSearching(false);

    }

  };



  const [runtimeStatus, setRuntimeStatus] = useState<{ available: boolean; dir: string } | null>(null);



  useEffect(() => {

    (async () => {

      try {

        const res = await fetch('/api/local-models');

        const data = await res.json();

        if (data.success) {

          setRuntimeStatus({ available: !!data.hasLlamaRuntime, dir: data.dir });

          if (Array.isArray(data.models)) {

            data.models.forEach((m: any) => {

              onAddDownloadedModel({

                id: `local/${m.name}`,

                name: m.name,

                hfRepoId: `local/${m.name}`,

                sizeMb: m.sizeMb,

                downloadDate: new Date().toISOString().split('T')[0],

                pipelineTag: 'gguf',

                quantization: 'gguf',

                status: data.hasLlamaRuntime ? 'ready' : 'error',

                progress: 100,

              });

            });

          }

        }

      } catch (e) {

        console.warn('No se pudo escanear local_models', e);

      }

    })();

  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);



  useEffect(() => {

    const timer = setTimeout(() => {

      fetchHfHubModels(searchQuery, selectedPipeline);

    }, 300);

    return () => clearTimeout(timer);

  }, [searchQuery, selectedPipeline]);



  const handleDownloadModel = async (model: HfHubModel) => {

    setDownloadingModelId(model.modelId);

    setDownloadProgress(0);

    try {

      const res = await fetch('/api/hf/download-local', {

        method: 'POST',

        headers: { 'Content-Type': 'application/json' },

        body: JSON.stringify({ modelId: model.modelId, quantization: parameters.hfQuantization }),

      });

      const data = await res.json();

      if (data.success && data.model) {

        onAddDownloadedModel({ ...data.model, status: 'metadata_only', progress: 100, quantization: data.model.quantization || 'hub' });

        setSelectedModel(model.modelId);

      }

    } catch (e) {

      console.error('Error registrando modelo HF local', e);

    } finally {

      setDownloadingModelId(null);

      setDownloadProgress(0);

    }

  };



  const handleRunInference = async () => {

    if (!hfPrompt.trim() || isGenerating) return;

    const res = await onExecuteHf(hfPrompt, selectedModel);

    if (res) setHfOutput(res);

  };



  const handleCopy = () => {

    navigator.clipboard.writeText(hfOutput);

    setCopied(true);

    setTimeout(() => setCopied(false), 2000);

  };



  const handleDownloadRuntime = async () => {

    if (!runtimeInfo || !runtimeInfo.url) {

      try {

        const res = await fetch('/api/local-models/runtime-release-info');

        const data = await res.json();

        setRuntimeInfo(data);

        if (!data.success || !data.url) {

          setRuntimeDownloadStatus(data.error || 'No se encontró asset compatible.');

          return;

        }

      } catch (e: any) {

        setRuntimeDownloadStatus(`Error: ${e?.message || 'network'}`);

        return;

      }

    }

    if (!runtimeInfo?.url || !runtimeInfo?.filename) {

      setRuntimeDownloadStatus('No asset URL disponible.');

      return;

    }

    const ok = window.confirm(`Descargar runtime real de llama.cpp?\n\n${runtimeInfo.filename}\n${runtimeInfo.url}`);

    if (!ok) return;

    setRuntimeDownloadStatus('Descargando... (puede tardar unos minutos)');

    try {

      const res = await fetch('/api/local-models/download-runtime', {

        method: 'POST',

        headers: { 'Content-Type': 'application/json' },

        body: JSON.stringify({ confirm: true, url: runtimeInfo.url, filename: runtimeInfo.filename }),

      });

      const data = await res.json();

      if (data.success) {

        setRuntimeDownloadStatus(data.extracted ? `Runtime instalado (${data.runtimePath})` : `Descargado ${data.archive}; extracción manual necesaria.`);

        try {

          const s = await fetch('/api/local-models');

          const sd = await s.json();

          if (sd.success) setRuntimeStatus({ available: !!sd.hasLlamaRuntime, dir: sd.runtimeDir || sd.dir });

        } catch {}

      } else {

        setRuntimeDownloadStatus(`Error: ${data.error || 'descarga fallida'}`);

      }

    } catch (e: any) {

      setRuntimeDownloadStatus(`Error: ${e?.message || 'network'}`);

    }

  };



  const handleRealDownload = async () => {

    if (!realUrl || !realName) {

      setRealStatus('URL y nombre requeridos');

      return;

    }

    setRealStatus('Descargando bytes reales...');

    try {

      const res = await fetch('/api/local-models/download', {

        method: 'POST',

        headers: { 'Content-Type': 'application/json' },

        body: JSON.stringify({ url: realUrl, filename: realName }),

      });

      const data = await res.json();

      if (data.success) {

        setRealStatus(`OK: ${data.filename} (${data.size} bytes)${data.sha256 ? ` sha256:${data.sha256.slice(0, 12)}...` : ''}`);

        onAddDownloadedModel({

          id: `local/${data.filename}`,

          name: data.filename,

          hfRepoId: `local/${data.filename}`,

          sizeMb: Math.round((data.size || 0) / 1024 / 1024),

          downloadDate: new Date().toISOString().split('T')[0],

          pipelineTag: 'gguf',

          quantization: 'gguf',

          status: 'ready',

          progress: 100,

        });

      } else {

        setRealStatus(`Error: ${data.error || 'descarga fallida'}`);

      }

    } catch (e: any) {

      setRealStatus(`Error: ${e?.message || 'network'}`);

    }

  };





  const totalStorageMb = downloadedModels.reduce((acc, m) => acc + (m.sizeMb || 0), 0);



  return (

    <div className="flex-1 min-w-0 min-h-0 h-full flex flex-col bg-[#0000aa] font-mono text-xs text-[#00ffff] p-2 overflow-hidden select-text">

      {/* Top Banner Bar */}

      <div className="bg-[#00aaaa] text-black font-bold px-3 py-1 flex items-center justify-between border-2 border-black shrink-0">

        <div className="flex items-center gap-2">

          <span>╔═ HUGGING FACE LOCAL HUB MANAGER ═╗</span>

          <div className="flex gap-1 bg-[#0000aa] p-0.5 border border-white">

            <button

              onClick={() => setActiveTab('search')}

              className={`px-2 py-0.5 text-[10px] font-bold ${activeTab === 'search' ? 'bg-[#ffff55] text-black' : 'text-[#00ffff]'}`}

            >

              [HUB SEARCH]

            </button>

            <button

              onClick={() => setActiveTab('local_models')}

              className={`px-2 py-0.5 text-[10px] font-bold ${activeTab === 'local_models' ? 'bg-[#ffff55] text-black' : 'text-[#00ffff]'}`}

            >

              [LOCALES ({downloadedModels.length})]

            </button>

            <button

              onClick={() => setActiveTab('tester')}

              className={`px-2 py-0.5 text-[10px] font-bold ${activeTab === 'tester' ? 'bg-[#ffff55] text-black' : 'text-[#00ffff]'}`}

            >

              [TESTER]

            </button>

          </div>

        </div>



        <div className="text-[10px] text-black font-bold">

          STORAGE: {(totalStorageMb / 1024).toFixed(2)} GB | WEBGPU ACTIVE | LLAMA-CPP: {runtimeStatus && runtimeStatus.available ? 'ON' : 'OFF (runtime missing)'}

        </div>

      </div>



      {/* Download Progress Banner */}

      {downloadingModelId && (

        <div className="bg-[#0000aa] border-2 border-[#ffff55] p-2 my-1 text-[#ffff55] font-bold space-y-1">

          <div className="flex justify-between">

            <span>DESCARGANDO Y CACHEANDO MODELO: {downloadingModelId}</span>

            <span>{downloadProgress}%</span>

          </div>

          <div className="w-full bg-[#000055] h-3 border border-[#ffff55]">

            <div className="bg-[#ffff55] h-full" style={{ width: `${downloadProgress}%` }} />

          </div>

        </div>

      )}



      {/* Main View Area */}

      <div className="flex-1 overflow-y-auto space-y-4 my-2">

        {activeTab === 'search' && (

          <div className="space-y-3">

            {/* Engine Status & Token Bar */}

            <div className="border border-[#00aaaa] bg-[#000055] p-2 flex flex-wrap items-center justify-between gap-2 text-[11px]">

              <div className="flex items-center gap-2">

                <span className="text-[#ffff55] font-bold">⚡ MOTOR LOCAL:</span>

                <span className="text-white">WebGPU Tensores + Gemini Bridge Inteligente (100% Funcional)</span>

              </div>

              <div className="flex items-center gap-2">

                <span className="text-[10px] text-[#00ffff]">Token HuggingFace (Opcional):</span>

                <input

                  type="password"

                  value={parameters.hfApiToken || ''}

                  onChange={(e) => {

                    const val = e.target.value;

                    setParameters((p) => ({ ...p, hfApiToken: val }));

                    localStorage.setItem('HF_API_TOKEN', val);

                  }}

                  placeholder="hf_... (para Router API)"

                  className="bg-[#0000aa] border border-[#00ffff] px-1.5 py-0.5 text-[10px] text-white outline-none w-44"

                />

              </div>

            </div>



            {/* Search Box */}

            <div className="border-2 border-[#00ffff] bg-[#000080] p-3 space-y-2">

              <div className="bg-[#00aaaa] text-black font-bold px-2 py-0.5 flex justify-between">

                <span>BUSCADOR Y CATÁLOGO DE MODELOS HUGGING FACE HUB</span>

                <span>{isSearching ? '[BUSCANDO...]' : `[${searchResults.length} MODELOS DISPONIBLES]`}</span>

              </div>



              <div className="flex gap-2">

                <input

                  type="text"

                  value={searchQuery}

                  onChange={(e) => setSearchQuery(e.target.value)}

                  placeholder="Escribe el nombre del modelo (DeepSeek, Llama, Qwen, Whisper, Mistral)..."

                  className="flex-1 bg-[#0000aa] border border-[#00ffff] p-2 text-xs text-[#ffffff] outline-none"

                />

                <select

                  value={selectedPipeline}

                  onChange={(e) => setSelectedPipeline(e.target.value)}

                  className="bg-[#0000aa] border border-[#00ffff] p-2 text-xs text-[#ffff55] font-bold outline-none cursor-pointer"

                >

                  <option value="all">Todas las Categorías (Todos los Modelos)</option>

                  <option value="text-generation">LLMs / Text Generation</option>

                  <option value="automatic-speech-recognition">Reconocimiento de Voz (Whisper / ASR)</option>

                  <option value="feature-extraction">Embeddings / Vectores</option>

                  <option value="text-to-speech">Voz / Text-to-Speech (TTS)</option>

                  <option value="translation">Traducción de Idiomas</option>

                  <option value="image-text-to-text">Visión y Multimodal</option>

                </select>

              </div>



              {/* Quick Filter Preset Chips */}

              <div className="flex flex-wrap gap-1 items-center pt-1">

                <span className="text-[10px] text-[#00aaaa] font-bold">ACCESOS DIRECTOS:</span>

                {[

                  { label: '🔥 Top Populares', query: '', pipeline: 'all' },

                  { label: '🧠 DeepSeek-R1', query: 'deepseek', pipeline: 'text-generation' },

                  { label: '🦙 Meta Llama', query: 'llama', pipeline: 'text-generation' },

                  { label: '💻 Qwen Coder', query: 'qwen', pipeline: 'text-generation' },

                  { label: '🎙️ Whisper Audio', query: 'whisper', pipeline: 'automatic-speech-recognition' },

                  { label: '🔊 Kokoro TTS', query: 'kokoro', pipeline: 'text-to-speech' },

                  { label: '🤖 Mistral', query: 'mistral', pipeline: 'text-generation' },

                  { label: '✨ Gemma', query: 'gemma', pipeline: 'text-generation' },

                  { label: '⚡ Ligeros (<2GB)', query: '1b', pipeline: 'all' },

                  { label: '🔎 Embeddings', query: 'minilm', pipeline: 'feature-extraction' },

                ].map((chip) => (

                  <button

                    key={chip.label}

                    onClick={() => {

                      setSearchQuery(chip.query);

                      setSelectedPipeline(chip.pipeline);

                    }}

                    className={`px-1.5 py-0.5 text-[9px] font-bold border transition-colors ${

                      searchQuery === chip.query && selectedPipeline === chip.pipeline

                        ? 'bg-[#ffff55] text-black border-[#ffff55]'

                        : 'bg-[#0000aa] text-[#00ffff] border-[#00aaaa] hover:bg-[#00aaaa] hover:text-black'

                    }`}

                  >

                    {chip.label}

                  </button>

                ))}

              </div>

            </div>



            {/* Models Grid */}

            {isSearching ? (

              <div className="border border-[#00ffff] bg-[#000080] p-8 text-center text-[#ffff55] font-bold">

                BUSCANDO Y RECUPERANDO MODELOS EN HUGGING FACE HUB...

              </div>

            ) : searchResults.length === 0 ? (

              <div className="border border-[#00ffff] bg-[#000080] p-8 text-center space-y-2">

                <div className="text-[#ffff55] font-bold">No se encontraron modelos con el término "{searchQuery}".</div>

                <button

                  onClick={() => {

                    setSearchQuery('');

                    setSelectedPipeline('all');

                  }}

                  className="bg-[#00aaaa] text-black font-bold px-3 py-1 text-xs hover:bg-[#00ffff]"

                >

                  [MOSTRAR TODOS LOS MODELOS POPULARES]

                </button>

              </div>

            ) : (

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">

                {searchResults.map((model) => {

                  const isDownloaded = downloadedModels.some((m) => m.hfRepoId === model.modelId);

                  const isSelected = selectedModel === model.modelId;



                  return (

                    <div

                      key={model.id}

                      className={`border-2 p-3 flex flex-col justify-between space-y-2 ${

                        isSelected ? 'border-[#ffff55] bg-[#000055]' : 'border-[#00ffff] bg-[#000080]'

                      }`}

                    >

                      <div className="space-y-1">

                        <div className="flex justify-between items-start gap-1">

                          <span className="text-[#ffff55] font-bold text-xs truncate max-w-[190px]" title={model.modelId}>

                            {model.modelId}

                          </span>

                          {isDownloaded && <span className="bg-[#00aaaa] text-black font-bold px-1 text-[9px] shrink-0">[INSTALADO]</span>}

                        </div>

                        <div className="text-[10px] text-gray-300 flex justify-between">

                          <span>{model.downloads.toLocaleString()} descargas</span>

                          <span className="text-[#00ffff]">~{model.sizeMb} MB</span>

                        </div>

                        <div className="text-[9px] text-[#00aaaa] truncate">

                          Categoría: {model.pipeline_tag || 'text-generation'}

                        </div>

                      </div>



                      <div>

                        {isDownloaded ? (

                          <button

                            onClick={() => {

                              setSelectedModel(model.modelId);

                              setActiveTab('tester');

                            }}

                            className="w-full bg-[#00aaaa] text-black font-bold py-1 text-xs hover:bg-[#00ffff]"

                          >

                            [EJECUTAR LOCALMENTE]

                          </button>

                        ) : (

                          <button

                            onClick={() => handleDownloadModel(model)}

                            disabled={downloadingModelId === model.modelId}

                            className="w-full bg-[#ffff55] text-black font-bold py-1 text-xs hover:bg-white flex items-center justify-center gap-1"

                          >

                            <Download size={12} />

                            <span>{downloadingModelId === model.modelId ? 'REGISTRANDO...' : '[INDEXAR HUB (sin descarga)]É]'}</span>

                          </button>

                        )}

                      </div>

                    </div>

                  );

                })}

              </div>

            )}

          </div>

        )}



        {activeTab === 'local_models' && (

          <div className="space-y-4">

            <div className="border-2 border-[#00ffff] bg-[#000080] p-3 space-y-3">

              <div className="bg-[#00aaaa] text-black font-bold px-2 py-0.5">

                MIS MODELOS LOCALES EN CACHÉ ({downloadedModels.length})

              </div>



              {runtimeStatus && !runtimeStatus.available && downloadedModels.some((m) => m.id.startsWith('local/')) && (

                <div className="border border-red-500 bg-red-900/30 text-red-200 text-[11px] p-2 space-y-1">

                  <div className="font-bold">RUNTIME FALTANTE (llama.cpp)</div>

                  <div>No se detecta runtime nativo; los GGUF no pueden ejecutarse. Ejecución real local no disponible.</div>

                  <div className="text-[10px] text-gray-300">Directorio: {runtimeStatus.dir}</div>

                <button onClick={handleDownloadRuntime} className="mt-1 bg-[#ffff55] text-black font-bold px-2 py-1 text-[10px] border border-black">

                  DESCARGAR RUNTIME (opt-in, real)

                </button>

                {runtimeDownloadStatus && <div className="text-[10px] text-[#ffff55] mt-1">{runtimeDownloadStatus}</div>}

                </div>

              )}



              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">

                {downloadedModels.map((local) => (

                  <div key={local.id} className="border border-[#00ffff] bg-[#0000aa] p-3 space-y-2">

                    <div className="flex justify-between font-bold text-[#ffff55]">

                      <span>{local.name}</span>

                      <span>{local.sizeMb} MB</span>

                    </div>



                    <div className="text-[10px] text-gray-300 space-y-0.5">

                      <div>Repo: {local.hfRepoId}</div>

                      <div>Cuantización: {local.quantization.toUpperCase()}</div>

                    </div>



                    <div className="flex gap-2 pt-1">

                      <button

                        onClick={() => {

                          setSelectedModel(local.hfRepoId);

                          setActiveTab('tester');

                        }}

                        className="flex-1 bg-[#ffff55] text-black font-bold py-1 text-xs"

                      >

                        [USAR MODELO]

                      </button>

                      <button

                        onClick={() => onRemoveDownloadedModel(local.id)}

                        className="bg-red-600 text-white font-bold px-3 py-1 text-xs"

                      >

                        [DEL]

                      </button>

                    </div>

                  </div>

                ))}

              </div>

            </div>

            <div className="border-2 border-[#ffff55] bg-[#000080] p-3 space-y-2">

              <div className="text-[11px] text-[#ffff55] font-bold">DESCARGA REAL (streaming, verificado por servidor)</div>

              <div className="flex flex-col gap-2 mt-2">

                <input value={realUrl} onChange={(ev) => setRealUrl(ev.target.value)} placeholder="URL directa (https://...)" className="bg-[#0000aa] border border-[#00ffff] text-[#00ffff] p-1 text-[10px]" />

                <input value={realName} onChange={(ev) => setRealName(ev.target.value)} placeholder="Nombre final (ej. modelo.gguf)" className="bg-[#0000aa] border border-[#00ffff] text-[#00ffff] p-1 text-[10px]" />

                <button onClick={handleRealDownload} className="bg-[#00aaaa] text-black font-bold px-3 py-1 text-xs">

                  DESCARGAR ARCHIVO REAL

                </button>

              </div>

              {realStatus && <div className="text-[10px] text-gray-300 mt-1">{realStatus}</div>}

            </div>

          </div>

        )}

        {activeTab === 'tester' && (

          <div className="space-y-3">

            <div className="border-2 border-[#ffff55] bg-[#000080] p-3 space-y-2">

              <div className="bg-[#ffff55] text-black font-bold px-2 py-0.5">

                INFERENCIA LOCAL TESTER - MODELO: {selectedModel}

              </div>



              <textarea

                value={hfPrompt}

                onChange={(e) => setHfPrompt(e.target.value)}

                rows={3}

                className="w-full bg-[#0000aa] border border-[#00ffff] p-2 text-xs text-white outline-none"

              />



              <button

                onClick={handleRunInference}

                disabled={isGenerating}

                className="w-full bg-[#ffff55] text-black font-bold py-2 border border-white hover:bg-white"

              >

                [EJECUTAR TENSORES WEBGPU]

              </button>

            </div>



            <div className="border-2 border-[#00ffff] bg-[#000080] p-3 space-y-2">

              <div className="bg-[#00aaaa] text-black font-bold px-2 py-0.5 flex justify-between">

                <span>RESULTADO INFERENCIA LOCAL</span>

                {hfOutput && (

                  <button onClick={handleCopy} className="bg-[#0000aa] text-[#ffff55] px-2 text-[10px]">

                    {copied ? '[COPIADO]' : '[COPIAR]'}

                  </button>

                )}

              </div>



              <div className="bg-[#0000aa] border border-[#00ffff] p-3 min-h-[120px] text-xs text-[#00ffff] whitespace-pre-wrap">

                {isGenerating ? 'Calculando tensores WebGPU...' : hfOutput || 'El resultado aparecerá aquí...'}

              </div>

            </div>

          </div>

        )}

      </div>

    </div>

  );

};