import React, { useState } from 'react';
import { X, Copy, Check, Code2, Terminal, FileCode, Cpu, Monitor, Smartphone, Globe, Download } from 'lucide-react';
import { ParameterConfig } from '../types/studio';
import JSZip from 'jszip';
import { Language, TRANSLATIONS } from '../i18n/translations';

interface CodeModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedModel: string;
  parameters: ParameterConfig;
  promptText: string;
  lang?: Language;
}

export const CodeModal: React.FC<CodeModalProps> = ({
  isOpen,
  onClose,
  selectedModel,
  parameters,
  promptText,
  lang = 'es',
}) => {
  const t = TRANSLATIONS[lang];
  const [activeTab, setActiveTab] = useState<'js' | 'python' | 'curl' | 'android' | 'swift' | 'csharp' | 'go'>('js');
  const [copied, setCopied] = useState(false);
  const [downloading, setDownloading] = useState(false);

  if (!isOpen) return null;

  const safePrompt = promptText.replace(/"/g, '\\"').replace(/\n/g, '\\n');

  const toolsJs = [];
  if (parameters.tools?.googleSearch) toolsJs.push('{ googleSearch: {} }');
  if (parameters.tools?.codeExecution) toolsJs.push('{ codeExecution: {} }');
  const toolsSnippet = toolsJs.length > 0 ? `\n      tools: [${toolsJs.join(', ')}],` : '';

  const jsonSnippetJs = parameters.responseFormat === 'json' 
    ? `\n      responseMimeType: "application/json",${parameters.jsonSchema ? `\n      responseSchema: ${parameters.jsonSchema},` : ''}`
    : '';

  const snippets = {
    js: `// npm install @google/genai
import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({
  apiKey: process.env.COMMANDER_API_KEY || process.env.API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'commander-studio',
    }
  }
});

async function main() {
  const response = await ai.models.generateContent({
    model: "${selectedModel}",
    contents: "${safePrompt}",
    config: {
      temperature: ${parameters.temperature},
      topP: ${parameters.topP},
      topK: ${parameters.topK},
      systemInstruction: "${parameters.systemInstruction.replace(/"/g, '\\"')}",${jsonSnippetJs}${toolsSnippet}
    }
  });

  console.log(response.text);
}

main();`,

    python: `# pip install google-genai
import os
from google import genai

client = genai.Client(api_key=os.environ.get("GEMINI_API_KEY"))

response = client.models.generate_content(
    model="${selectedModel}",
    contents="${safePrompt}",
    config={
        "temperature": ${parameters.temperature},
        "top_p": ${parameters.topP},
        "system_instruction": "${parameters.systemInstruction.replace(/"/g, '\\"')}",${parameters.responseFormat === 'json' ? '\n        "response_mime_type": "application/json",' : ''}${parameters.tools?.googleSearch ? '\n        "tools": [{"google_search": {}}],' : ''}
    }
)

print(response.text)`,

    curl: `curl "https://generativelanguage.googleapis.com/v1beta/models/${selectedModel}:generateContent?key=$GEMINI_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "contents": [{"parts": [{"text": "${safePrompt}"}]}],
    "generationConfig": {
      "temperature": ${parameters.temperature},
      "topP": ${parameters.topP}
    }
  }'`,

    android: `// Kotlin para Android Studio (Google Generative AI SDK)
import com.google.ai.client.generativeai.GenerativeModel

val generativeModel = GenerativeModel(
    modelName = "${selectedModel}",
    apiKey = BuildConfig.apiKey
)

suspend fun runPrompt() {
    val prompt = "${safePrompt}"
    val response = generativeModel.generateContent(prompt)
    println(response.text)
}`,

    swift: `// Swift para iOS / macOS (Google Generative AI SDK)
import GoogleGenerativeAI

let model = GenerativeModel(name: "${selectedModel}", apiKey: "YOUR_API_KEY")

Task {
    let response = try await model.generateContent("${safePrompt}")
    print(response.text ?? "")
}`,

    csharp: `// C# .NET / Windows Executable (HttpClient)
using System;
using System.Net.Http;
using System.Text;
using System.Threading.Tasks;

class Program {
    static async Task Main() {
        var client = new HttpClient();
        var json = @"{""contents"":[{""parts"":[{""text"":""${safePrompt}""}]}]}";
        var content = new StringContent(json, Encoding.UTF8, "application/json");
        var response = await client.PostAsync("https://generativelanguage.googleapis.com/v1beta/models/${selectedModel}:generateContent?key=" + Environment.GetEnvironmentVariable("GEMINI_API_KEY"), content);
        var result = await response.Content.ReadAsStringAsync();
        Console.WriteLine(result);
    }
}`,

    go: `// Go (Golang SDK)
package main

import (
	"context"
	"fmt"
	"os"
	"github.com/google/generative-ai-go/genai"
	"google.golang.org/api/option"
)

func main() {
	ctx := context.Background()
	client, err := genai.NewClient(ctx, option.WithAPIKey(os.Getenv("GEMINI_API_KEY")))
	if err != nil {
		panic(err)
	}
	defer client.Close()

	model := client.GenerativeModel("${selectedModel}")
	resp, err := model.GenerateContent(ctx, genai.Text("${safePrompt}"))
	if err != nil {
		panic(err)
	}

	for _, cand := range resp.Candidates {
		for _, part := range cand.Content.Parts {
			fmt.Println(part)
		}
	}
}`
  };

  const currentSnippet = snippets[activeTab];

  const handleCopy = () => {
    navigator.clipboard.writeText(currentSnippet);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadZip = async () => {
    setDownloading(true);
    try {
      const zip = new JSZip();
      zip.file('README.md', `# Proyecto AI Studio - ${selectedModel}\n\nCódigo generado automáticamente para integración nativa con ${activeTab.toUpperCase()}.\n\n## Instrucciones\n1. Configura tu GEMINI_API_KEY en las variables de entorno.\n2. Ejecuta el archivo de entrada correspondiente.\n`);
      zip.file('.env.example', `GEMINI_API_KEY=tu_api_key_aqui\n`);

      let fileName = 'index.js';
      if (activeTab === 'python') fileName = 'main.py';
      else if (activeTab === 'go') fileName = 'main.go';
      else if (activeTab === 'android') fileName = 'MainActivity.kt';
      else if (activeTab === 'swift') fileName = 'CommanderAIApp.swift';
      else if (activeTab === 'csharp') fileName = 'Program.cs';
      else if (activeTab === 'curl') fileName = 'request.sh';

      zip.file(fileName, currentSnippet);

      if (activeTab === 'js') {
        zip.file('package.json', JSON.stringify({
          name: 'commander-ai-project',
          version: '1.0.0',
          dependencies: {
            '@google/genai': '^2.4.0'
          }
        }, null, 2));
      }

      const blob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `commander-ai-project-${activeTab}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e: any) {
      alert('Error creando archivo ZIP: ' + e.message);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-2 sm:p-4 font-mono select-none cursor-pointer"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div 
        className="bg-[#0000aa] border-2 border-[#00ffff] w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl cursor-default"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="bg-[#00aaaa] text-black font-bold px-3 py-2 flex items-center justify-between border-b-2 border-black">
          <div className="flex items-center gap-2">
            <Code2 className="w-4 h-4 text-black" />
            <span className="text-xs sm:text-sm">╔═ OBTENER CÓDIGO DE INTEGRACIÓN MULTI-LENGUAJE ═╗</span>
          </div>
          <button type="button" onClick={onClose} className="nc-button px-2 py-0.5 text-xs hover:bg-red-600 hover:text-white">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Tabs for Languages */}
        <div className="bg-[#000080] border-b border-[#00ffff] p-2 flex flex-wrap gap-1 text-xs">
          {[
            { id: 'js', label: 'JS/TS SDK', icon: FileCode },
            { id: 'python', label: 'Python SDK', icon: Terminal },
            { id: 'curl', label: 'cURL REST', icon: Globe },
            { id: 'android', label: 'Kotlin (Android)', icon: Smartphone },
            { id: 'swift', label: 'Swift (iOS)', icon: Cpu },
            { id: 'csharp', label: 'C# (.NET/Win)', icon: Monitor },
            { id: 'go', label: 'Go (Golang)', icon: Code2 },
          ].map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id as any)}
                className={`px-2.5 py-1 font-bold text-[11px] flex items-center gap-1.5 border ${
                  isActive ? 'bg-[#ffff55] text-black border-white' : 'bg-[#0000aa] text-[#00ffff] border-[#00aaaa]'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Code Content */}
        <div className="flex-1 overflow-y-auto p-3 bg-[#000080] relative min-h-[300px]">
          <div className="absolute top-4 right-4 flex items-center gap-2 z-10">
            <button
              type="button"
              onClick={handleDownloadZip}
              disabled={downloading}
              className="nc-button text-xs bg-[#ffff55] text-black font-bold flex items-center gap-1 border border-white hover:bg-white"
            >
              <Download className="w-3.5 h-3.5" />
              <span>{downloading ? (lang === 'es' ? 'Generando ZIP...' : lang === 'de' ? 'ZIP wird erstellt...' : 'Generating ZIP...') : t.downloadZip}</span>
            </button>
            <button
              type="button"
              onClick={handleCopy}
              className="nc-button text-xs bg-[#00aaaa] text-black font-bold flex items-center gap-1 border border-white"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-green-700" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? t.copied : t.copy}</span>
            </button>
          </div>

          <pre className="text-xs text-[#00ffff] font-mono whitespace-pre-wrap leading-relaxed overflow-x-auto p-2">
            {currentSnippet}
          </pre>
        </div>

        {/* Footer */}
        <div className="bg-[#00aaaa] p-2 flex items-center justify-between border-t-2 border-black text-xs text-black font-bold">
          <span>{lang === 'es' ? 'Modelo' : lang === 'de' ? 'Modell' : 'Model'}: {selectedModel}</span>
          <button type="button" onClick={onClose} className="nc-button text-xs">
            {t.close}
          </button>
        </div>
      </div>
    </div>
  );
};
