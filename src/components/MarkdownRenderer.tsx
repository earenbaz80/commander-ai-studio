import React, { useState } from 'react';
import { Copy, Check, Code2, Brain, Play } from 'lucide-react';

interface MarkdownRendererProps {
  content: string;
  isStreaming?: boolean;
  onRunCode?: (code: string, language: string) => void;
}

export const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({ content, isStreaming, onRunCode }) => {
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [showThinking, setShowThinking] = useState(false);

  // Extract <think> ... </think> or [DeepSeek Reasoning] if present
  let thinkingText: string | null = null;
  let mainContent = content;

  const thinkMatch = content.match(/<think>([\s\S]*?)<\/think>/i);
  if (thinkMatch) {
    thinkingText = thinkMatch[1].trim();
    mainContent = content.replace(/<think>[\s\S]*?<\/think>/i, '').trim();
  } else if (content.startsWith('[DeepSeek Local Reasoner]')) {
    const parts = content.split('\n\n');
    thinkingText = parts[0];
    mainContent = parts.slice(1).join('\n\n');
  }

  const handleCopyCode = (codeText: string, index: number) => {
    navigator.clipboard.writeText(codeText);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  // Split content by code blocks: ```lang ... ```
  const parts = mainContent.split(/(```[\w-]*\n[\s\S]*?```)/g);

  return (
    <div className="font-mono text-xs leading-relaxed space-y-2 select-text">
      {/* Reasoning / Thinking Accordion (Google AI Studio / DeepSeek Feature) */}
      {thinkingText && (
        <div className="bg-[#000080] border border-[#00ffff] p-2 text-xs mb-2">
          <button
            type="button"
            onClick={() => setShowThinking(!showThinking)}
            className="w-full flex items-center justify-between font-bold text-[#ffff55] text-[11px] select-none text-left"
          >
            <div className="flex items-center gap-1.5">
              <Brain className="w-3.5 h-3.5 text-[#ffff55]" />
              <span>PROCESO DE PENSAMIENTO / RAZONAMIENTO DEL MODELO</span>
            </div>
            <span className="text-[10px] text-[#00ffff]">
              {showThinking ? '[OCULTAR ▲]' : '[VER PENSAMIENTO ▼]'}
            </span>
          </button>
          {showThinking && (
            <div className="mt-2 text-[11px] text-white/85 font-mono whitespace-pre-wrap pl-2.5 border-l-2 border-[#ffff55] bg-[#0000aa]/60 p-2 max-h-60 overflow-y-auto">
              {thinkingText}
            </div>
          )}
        </div>
      )}

      {/* Render Text and Code Blocks */}
      {parts.map((part, index) => {
        if (part.startsWith('```') && part.endsWith('```')) {
          // Extract language and code
          const firstLineEnd = part.indexOf('\n');
          const lang = part.substring(3, firstLineEnd).trim() || 'code';
          const code = part.substring(firstLineEnd + 1, part.length - 3);

          return (
            <div key={index} className="my-2.5 bg-[#0e0f14] border-2 border-black rounded overflow-hidden shadow-lg">
              <div className="bg-[#1c1d29] px-3 py-1.5 flex items-center justify-between border-b border-[#2d2f42] text-[11px] font-mono text-[#a8c7fa] select-none">
                <div className="flex items-center gap-1.5 font-bold uppercase tracking-wider">
                  <Code2 className="w-3.5 h-3.5 text-[#00ffff]" />
                  <span>{lang}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  {onRunCode && ['html', 'htm', 'jsx', 'tsx', 'js', 'javascript', 'svg', 'react'].includes(lang.toLowerCase()) && (
                    <button
                      type="button"
                      onClick={() => onRunCode(code, lang)}
                      className="nc-button text-[11px] py-0.5 px-2.5 flex items-center gap-1 bg-[#ffff55] text-black hover:bg-white font-bold border-white shadow-[1px_1px_0px_#000000]"
                      title="Ejecutar en el Visor de App en Vivo"
                    >
                      <Play className="w-3 h-3 text-[#000080] fill-[#000080]" />
                      <span>Ejecutar en Vivo</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => handleCopyCode(code, index)}
                    className="nc-button text-[11px] py-0.5 px-2 flex items-center gap-1 bg-[#000080] text-[#00ffff] border-[#00ffff]"
                  >
                    {copiedIndex === index ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
                    <span>{copiedIndex === index ? 'Copiado!' : 'Copiar Código'}</span>
                  </button>
                </div>
              </div>
              <pre className="p-3 text-[11px] sm:text-xs font-mono text-[#e3e2e6] overflow-x-auto leading-relaxed bg-[#0b0c10]">
                <code>{code}</code>
              </pre>
            </div>
          );
        }

        // Render Markdown paragraphs, headings, bullet lists
        return (
          <div key={index} className="space-y-1.5">
            {part.split('\n\n').map((paragraph, pIdx) => {
              const trimmed = paragraph.trim();
              if (!trimmed) return null;

              // Headings
              if (trimmed.startsWith('### ')) {
                return (
                  <h3 key={pIdx} className="text-sm font-bold text-[#ffff55] mt-2 mb-1 border-b border-[#00ffff]/30 pb-0.5">
                    {trimmed.replace('### ', '')}
                  </h3>
                );
              }
              if (trimmed.startsWith('## ')) {
                return (
                  <h2 key={pIdx} className="text-base font-bold text-[#00ffff] mt-3 mb-1 border-b border-[#00ffff] pb-0.5">
                    {trimmed.replace('## ', '')}
                  </h2>
                );
              }
              if (trimmed.startsWith('# ')) {
                return (
                  <h1 key={pIdx} className="text-lg font-bold text-[#ffff55] mt-3 mb-1.5 border-b-2 border-[#00ffff] pb-1">
                    {trimmed.replace('# ', '')}
                  </h1>
                );
              }

              // Bullet points
              if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
                const items = trimmed.split('\n');
                return (
                  <ul key={pIdx} className="list-disc pl-5 space-y-1 text-white">
                    {items.map((it, iIdx) => (
                      <li key={iIdx}>
                        {renderInlineFormatting(it.replace(/^[-*]\s+/, ''))}
                      </li>
                    ))}
                  </ul>
                );
              }

              // Numbered lists
              if (/^\d+\.\s/.test(trimmed)) {
                const items = trimmed.split('\n');
                return (
                  <ol key={pIdx} className="list-decimal pl-5 space-y-1 text-white">
                    {items.map((it, iIdx) => (
                      <li key={iIdx}>
                        {renderInlineFormatting(it.replace(/^\d+\.\s+/, ''))}
                      </li>
                    ))}
                  </ol>
                );
              }

              return (
                <p key={pIdx} className="text-white leading-relaxed whitespace-pre-wrap">
                  {renderInlineFormatting(paragraph)}
                </p>
              );
            })}
          </div>
        );
      })}

      {isStreaming && (
        <span className="inline-block w-2 h-4 bg-[#ffff55] ml-1 animate-pulse align-middle" />
      )}
    </div>
  );
};

// Helper to format inline bold, inline code, and links
function renderInlineFormatting(text: string): React.ReactNode {
  // Split by inline code: `code`
  const codeParts = text.split(/(`[^`]+`)/g);

  return codeParts.map((cPart, cIdx) => {
    if (cPart.startsWith('`') && cPart.endsWith('`')) {
      return (
        <code key={cIdx} className="bg-[#000080] text-[#ffff55] px-1 py-0.5 rounded border border-[#00ffff] text-[11px] font-mono mx-0.5">
          {cPart.slice(1, -1)}
        </code>
      );
    }

    // Bold formatting **text**
    const boldParts = cPart.split(/(\*\*[^*]+\*\*)/g);
    return boldParts.map((bPart, bIdx) => {
      if (bPart.startsWith('**') && bPart.endsWith('**')) {
        return (
          <strong key={bIdx} className="font-bold text-[#ffff55]">
            {bPart.slice(2, -2)}
          </strong>
        );
      }
      return bPart;
    });
  });
}
