import { ParameterConfig } from '../types/studio';

export interface MentionItem {
  id: string;
  label: string;
  category: 'file' | 'doc' | 'param' | 'git';
  description: string;
  badge: string;
  getContent: (params?: { parameters?: ParameterConfig; selectedModel?: string; files?: { name: string; content: string }[] }) => string;
}

export const OFFICIAL_DOCS: Record<string, string> = {
  'tauri': `[TAURI v2 OFFICIAL QUICK REFERENCE]
- IPC Invocation in Frontend:
  import { invoke } from '@tauri-apps/api/core';
  const response = await invoke('my_custom_command', { payload: { id: 123 } });
- Rust Command Definition (src-tauri/src/lib.rs):
  #[tauri::command]
  fn my_custom_command(payload: CustomPayload) -> Result<String, String> {
      Ok(format!("Processed {}", payload.id))
  }
- Permissions & Capabilities:
  Configure permissions in src-tauri/capabilities/default.json (e.g. core:default, shell:allow-open).`,

  'electron': `[ELECTRON OFFICIAL QUICK REFERENCE]
- Main Process (main.cjs):
  const { app, BrowserWindow, ipcMain } = require('electron');
  function createWindow() {
    const win = new BrowserWindow({
      webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true }
    });
    win.loadFile('index.html');
  }
- Preload Bridge (preload.cjs):
  const { contextBridge, ipcRenderer } = require('electron');
  contextBridge.exposeInMainWorld('api', {
    sendData: (data) => ipcRenderer.invoke('app:send-data', data)
  });`,

  'claude': `[ANTHROPIC CLAUDE API QUICK REFERENCE]
- Endpoint: POST https://api.anthropic.com/v1/messages
- Headers:
  x-api-key: ANTHROPIC_API_KEY
  anthropic-version: 2023-06-01
  content-type: application/json
- Recommended Models:
  - claude-3-7-sonnet-20250219 (Hybrid Reasoning & Coding Leader)
  - claude-3-5-sonnet-20241022 (High Precision Architecture & Code)
  - claude-3-5-haiku-20241022 (Ultra Fast Inference)`,

  'gemini': `[GOOGLE GENAI SDK QUICK REFERENCE]
- SDK: @google/genai
- Usage:
  import { GoogleGenAI, ThinkingLevel } from '@google/genai';
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: 'Hello',
    config: {
      temperature: 0.7,
      thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH }
    }
  });`,

  'huggingface': `[TRANSFORMERS.JS / WEBGPU QUICK REFERENCE]
- Browser Local Inference:
  import { pipeline, env } from '@huggingface/transformers';
  env.backends.onnx.wasm.numThreads = 4;
  const generator = await pipeline('text-generation', 'deepseek-ai/DeepSeek-R1-Distill-Qwen-1.5B', {
    device: 'webgpu',
    dtype: 'q4'
  });
  const output = await generator('Prompt', { max_new_tokens: 256 });`,

  'tailwind': `[TAILWIND CSS v4 REFERENCE]
- Import: @import "tailwindcss"; in global CSS.
- Common Retro Utility Combinations:
  bg-[#000080] text-[#00ffff] font-mono border-2 border-[#00ffff]
  hover:bg-[#00ffff] hover:text-black transition-colors`,
};

export const CONTEXT_MENTIONS: MentionItem[] = [
  // 1. Files
  {
    id: '@src/App.tsx',
    label: '@src/App.tsx',
    category: 'file',
    description: 'Componente React principal de la aplicación',
    badge: 'FILE',
    getContent: (opts) => {
      const custom = opts?.files?.find(f => f.name === 'src/App.tsx');
      return custom?.content || `// src/App.tsx (Main Application Component)\nexport function App() {\n  return <div>Commander AI Studio</div>;\n}`;
    }
  },
  {
    id: '@package.json',
    label: '@package.json',
    category: 'file',
    description: 'Dependencias y scripts npm del proyecto',
    badge: 'FILE',
    getContent: (opts) => {
      const custom = opts?.files?.find(f => f.name === 'package.json');
      return custom?.content || `{\n  "name": "commander-project",\n  "version": "1.0.0",\n  "dependencies": { "react": "^19.0.0", "@google/genai": "^2.4.0" }\n}`;
    }
  },
  {
    id: '@tauri.conf.json',
    label: '@tauri.conf.json',
    category: 'file',
    description: 'Configuración nativa de ventana y empaquetado Tauri v2',
    badge: 'FILE',
    getContent: (opts) => {
      const custom = opts?.files?.find(f => f.name === 'tauri.conf.json');
      return custom?.content || `{\n  "package": { "productName": "CommanderApp", "version": "1.0.0" },\n  "tauri": { "windows": [{ "title": "Commander", "width": 1024, "height": 720 }] }\n}`;
    }
  },
  {
    id: '@electron/main.cjs',
    label: '@electron/main.cjs',
    category: 'file',
    description: 'Proceso principal y gestión de ventanas de Electron',
    badge: 'FILE',
    getContent: (opts) => {
      const custom = opts?.files?.find(f => f.name === 'electron/main.cjs');
      return custom?.content || `const { app, BrowserWindow } = require('electron');\nfunction createWindow() { new BrowserWindow({ width: 1024, height: 720 }); }\napp.whenReady().then(createWindow);`;
    }
  },
  {
    id: '@src/index.css',
    label: '@src/index.css',
    category: 'file',
    description: 'Estilos globales y paleta retro de la interfaz',
    badge: 'FILE',
    getContent: (opts) => {
      const custom = opts?.files?.find(f => f.name === 'src/index.css');
      return custom?.content || `body { background-color: #000080; color: #00ffff; font-family: monospace; }`;
    }
  },
  {
    id: '@server.ts',
    label: '@server.ts',
    category: 'file',
    description: 'Servidor Express con proxies de Gemini, Anthropic y Hugging Face',
    badge: 'FILE',
    getContent: () => `// server.ts (Express Backend & AI Proxies)\n// Endpoints: /api/gemini/stream, /api/anthropic/stream, /api/hf/generate, /api/export/native-project`,
  },

  // 2. Docs
  {
    id: '@docs:tauri',
    label: '@docs:tauri',
    category: 'doc',
    description: 'Referencia oficial de Tauri v2 (IPC, Rust Commands & Config)',
    badge: 'DOCS',
    getContent: () => OFFICIAL_DOCS['tauri'],
  },
  {
    id: '@docs:electron',
    label: '@docs:electron',
    category: 'doc',
    description: 'Referencia oficial de Electron (Preload, IPC, Multi-Window)',
    badge: 'DOCS',
    getContent: () => OFFICIAL_DOCS['electron'],
  },
  {
    id: '@docs:claude',
    label: '@docs:claude',
    category: 'doc',
    description: 'Documentación oficial de Anthropic Claude 3.7 / 3.5 Sonnet',
    badge: 'DOCS',
    getContent: () => OFFICIAL_DOCS['claude'],
  },
  {
    id: '@docs:gemini',
    label: '@docs:gemini',
    category: 'doc',
    description: 'Documentación oficial de Google @google/genai SDK',
    badge: 'DOCS',
    getContent: () => OFFICIAL_DOCS['gemini'],
  },
  {
    id: '@docs:huggingface',
    label: '@docs:huggingface',
    category: 'doc',
    description: 'Documentación de Transformers.js & Modelos Locales WebGPU',
    badge: 'DOCS',
    getContent: () => OFFICIAL_DOCS['huggingface'],
  },
  {
    id: '@docs:tailwind',
    label: '@docs:tailwind',
    category: 'doc',
    description: 'Guía de utilidades Tailwind CSS v4 para diseño retro/cyberpunk',
    badge: 'DOCS',
    getContent: () => OFFICIAL_DOCS['tailwind'],
  },

  // 3. Parameters / Inference
  {
    id: '@model',
    label: '@model',
    category: 'param',
    description: 'Parámetros del modelo activo (temperatura, maxTokens, thinking)',
    badge: 'PARAM',
    getContent: (opts) => {
      const p = opts?.parameters;
      const m = opts?.selectedModel || 'gemini-2.5-flash';
      return `[ACTIVE INFERENCE CONFIG]\nModel: ${m}\nTemperature: ${p?.temperature ?? 0.7}\nMax Tokens: ${p?.maxTokens ?? 2048}\nTopP: ${p?.topP ?? 0.95}\nThinking Level: ${p?.thinkingLevel ?? 'LOW'}`;
    },
  },
  {
    id: '@system',
    label: '@system',
    category: 'param',
    description: 'Instrucción del sistema (System Instruction) actual',
    badge: 'PARAM',
    getContent: (opts) => `[CURRENT SYSTEM INSTRUCTION]\n${opts?.parameters?.systemInstruction || 'No system instruction defined.'}`,
  },
  {
    id: '@schema',
    label: '@schema',
    category: 'param',
    description: 'Esquema JSON estructurado configurado en el estudio',
    badge: 'PARAM',
    getContent: (opts) => `[STRUCTURED JSON SCHEMA]\n${opts?.parameters?.jsonSchema || 'No JSON schema configured.'}`,
  },

  // 4. Git / Diffs
  {
    id: '@git:diff',
    label: '@git:diff',
    category: 'git',
    description: 'Resumen de modificaciones y diffs pendientes en el proyecto',
    badge: 'GIT',
    getContent: (opts) => {
      return `[GIT STATUS & DIFFS]\nArchivos en seguimiento: ${opts?.files?.length || 4}\nEstado: Espacio de trabajo activo en memoria con soporte de exportación nativa.`;
    },
  },
];

/**
 * Filtra las menciones según la consulta escrita tras `@`.
 * `extraItems` permite inyectar archivos reales del proyecto (picker dinámico).
 */
export function filterMentions(query: string, extraItems: MentionItem[] = []): MentionItem[] {
  const cleanQuery = query.toLowerCase().replace(/^@/, '');
  const seen = new Set<string>();
  const merged: MentionItem[] = [];
  for (const item of [...extraItems, ...CONTEXT_MENTIONS]) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    merged.push(item);
  }
  if (!cleanQuery) return merged;
  return merged.filter(
    (item) =>
      item.label.toLowerCase().includes(cleanQuery) ||
      item.description.toLowerCase().includes(cleanQuery) ||
      item.category.toLowerCase().includes(cleanQuery)
  );
}

/**
 * Searches for all @mentions present in promptText and produces an enriched prompt context.
 */
export function resolveContextMentions(
  promptText: string,
  options?: {
    parameters?: ParameterConfig;
    selectedModel?: string;
    files?: { name: string; content: string }[];
  }
): { cleanPrompt: string; enrichedContext: string } {
  let enriched = '';
  let clean = promptText;

  for (const item of CONTEXT_MENTIONS) {
    if (promptText.includes(item.id)) {
      const content = item.getContent(options);
      enriched += `\n\n=== CONTEXT: ${item.label} ===\n${content}\n`;
    }
  }

  return {
    cleanPrompt: clean,
    enrichedContext: enriched.trim(),
  };
}
