import { ChatMessage } from '../types/studio';
import { ChatCodeSnippet } from '../components/ChatLiveAppViewerModal';

export function extractSnippetsFromMessages(messages: ChatMessage[], targetMessageId?: string): ChatCodeSnippet[] {
  const list: ChatCodeSnippet[] = [];
  const msgs = targetMessageId 
    ? messages.filter((m) => m.id === targetMessageId) 
    : messages.filter((m) => m.role === 'model');

  msgs.forEach((msg, mIndex) => {
    const codeBlockRegex = /```([a-zA-Z0-9_\-+]*)\s*([\s\S]*?)```/g;
    let match;
    let count = 1;
    while ((match = codeBlockRegex.exec(msg.content)) !== null) {
      const langStr = (match[1] || 'html').toLowerCase().trim();
      const code = match[2].trim();
      if (!code) continue;

      let label = 'App Web / HTML';
      if (['jsx', 'tsx', 'react'].includes(langStr)) label = 'Componente React';
      else if (['svg'].includes(langStr)) label = 'Gráfico SVG';
      else if (['js', 'javascript', 'ts', 'typescript'].includes(langStr)) label = 'Script JavaScript';
      else if (['html', 'htm'].includes(langStr)) label = 'Página HTML';
      else label = `Código (${langStr.toUpperCase()})`;

      list.push({
        id: `${msg.id}-${count}`,
        title: `${label} #${count} (Turno ${mIndex + 1})`,
        language: langStr,
        code,
        sourceMessageId: msg.id,
        sourceRole: msg.role,
      });
      count++;
    }
  });

  if (list.length === 0) {
    list.push({
      id: 'default-app',
      title: 'Plantilla Demo • Commander Live Viewer',
      language: 'html',
      code: `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>Commander AI Live App</title>
  <style>
    body {
      background: #000080;
      color: #ffff55;
      font-family: 'Courier New', monospace;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 90vh;
      margin: 0;
      padding: 20px;
      text-align: center;
    }
    .card {
      background: #0000aa;
      border: 3px double #00ffff;
      padding: 30px;
      box-shadow: 6px 6px 0px #000033;
      max-width: 600px;
    }
    h1 { color: #00ffff; margin-bottom: 10px; font-size: 24px; }
    p { color: #ffffff; font-size: 14px; line-height: 1.6; }
    button {
      background: #ffff55;
      color: #000000;
      border: 2px solid #ffffff;
      padding: 10px 24px;
      font-weight: bold;
      font-size: 14px;
      cursor: pointer;
      margin-top: 15px;
      font-family: monospace;
    }
    button:hover { background: #00ffff; }
  </style>
</head>
<body>
  <div class="card">
    <h1>🚀 COMMANDER LIVE APP VIEWER</h1>
    <p>¡El visor de aplicaciones en vivo está listo!</p>
    <p>Pídele a la IA en el chat que cree una aplicación web, un juego o un componente React, y ejecútalo instantáneamente con el botón <b>[▶ Ver en Ejecución]</b>.</p>
    <button onclick="alert('¡El visor de aplicaciones en vivo está completamente activo!')">PROBAR INTERACCIÓN</button>
  </div>
</body>
</html>`,
    });
  }

  return list;
}
