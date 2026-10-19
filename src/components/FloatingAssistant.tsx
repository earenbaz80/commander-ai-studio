import type { Language } from '../i18n/translations';
import React, { useState, useEffect, useRef, useCallback, useImperativeHandle } from 'react';
import { Clipboard, PanelRight, Hammer, Library, Search, Trash2, Plus, Send, X } from 'lucide-react';
import { loadNonoPosition, saveNonoPosition, clearNonoPosition } from '../utils/nonoStorage';
import { askNono } from '../utils/nonoAsk';
import type { ParameterConfig } from '../types/studio';

/**
 * Nono - Asistente flotante: solo la cabeza del robot.
 * - Siempre visible, anclado a la línea divisoria entre el chat y los
 *   resultados ([data-chat-divider]), esquina inferior derecha.
 * - Ojos que siguen el puntero del mouse + parpadeo dinámico.
 * - Expresiones dinámicas según contexto.
 * - Observa el chat cuando el usuario escribe.
 * - Arrastrable; doble clic para volver a la esquina.
 *
 * Estética retro Norton (cyan #00ffff, amarillo #ffff55, navy).
 */

export type NonoExpression =
  | 'neutral'
  | 'happy'
  | 'sad'
  | 'surprised'
  | 'angry'
  | 'wink'
  | 'sleepy'
  | 'thinking'
  | 'error'
  | 'love'
  | 'cool'
  | 'watch'
  | 'curious';

/** Evento contextual de la app para que Nono reaccione. */
export interface NonoStatusEvent {
  type: 'generating' | 'done' | 'error' | 'success' | 'mode' | 'new_prompt';
  /** Detalle opcional (p. ej. el nuevo modo activo). */
  detail?: string;
}

interface Message {
  id: string;
  text: string;
  fromUser: boolean;
  timestamp: string;
}

interface FloatingAssistantProps {
  lang?: Language;
  /** Nombre del usuario para el saludo flotante (opcional). */
  displayName?: string;
  /** Callback para el botón "Nuevo prompt" del mini-chat (opcional) */
  onNewPrompt?: () => void;
  /** Último evento contextual de la app (generando, error, cambio de modo…). */
  status?: NonoStatusEvent | null;
  /** Acciones rápidas reales de la app (opcionales; sin ellas no se muestran chips). */
  onOpenWorkbench?: () => void;
  onOpenCompile?: () => void;
  onOpenGallery?: () => void;
  onOpenSearch?: () => void;
  /** Configuración del modelo para responder con IA real (fallback a plantillas). */
  selectedModel?: string;
  selectedProvider?: string;
  parameters?: ParameterConfig;
  /** Información del proyecto actual para sugerencias contextuales de Nono. */
  projectInfo?: {
    path?: string;
    files?: string[];
    hasPackageJson?: boolean;
    hasTsConfig?: boolean;
    hasGit?: boolean;
    framework?: string;
    mainLanguage?: string;
    goal?: string; // Goal/tarea actual del agente
    mode?: 'chat' | 'freeform' | 'agent'; // Modo actual
  };
  /** Configuración de sugerencias (frecuencia, tipo, etc.). */
  suggestionConfig?: {
    idleTimeMs?: number; // Tiempo de inactividad antes de sugerir (default: 15000)
    maxSuggestions?: number; // Máximo de sugerencias a mostrar (default: 3)
    includeModeSpecific?: boolean; // Incluir sugerencias por modo (default: true)
    includeProjectSpecific?: boolean; // Incluir sugerencias por proyecto (default: true)
    includeTaskSpecific?: boolean; // Incluir sugerencias por tarea (default: true)
  };
  /** Contexto de código del chat para que Nono razone sobre él (opcional). */
  codeContext?: string;
  /** Si true, Nono no se renderiza en pantalla. */
  hidden?: boolean;
}

/** Handle imperativo para abrir Nono desde fuera (ej. @nono en el chat general). */
export type FloatingAssistantHandle = {
  openWithPrompt: (prompt: string, sendImmediately?: boolean) => void;
};

const GREETINGS_ES = [
  '¡Hola! Soy Nono, ¿en qué puedo ayudarte?',
  '¡Hey! ¿Necesitas algo?',
  '¡Hola terrícola! Listo para ayudarte.',
  '¿Qué tal? Nono al rescate.',
  '¡Hola! Pregúntame lo que quieras.',
];

const GREETINGS_EN = [
  'Hi! I\'m Nono, how can I help?',
  'Hey! Need anything?',
  'Hello earthling! Ready to assist.',
  'What\'s up? Nono to the rescue.',
  'Hi! Ask me anything.',
];

const GREETINGS_DE = [
  'Hallo! Ich bin Nono, wie kann ich helfen?',
  'Hey! Brauchst du etwas?',
  'Hallo Erdling! Bereit zu helfen.',
  'Na, wie läuft\'s? Nono zur Rettung.',
  'Hallo! Frag mich einfach.',
];

/** Preguntas dinámicas que Nono muestra al pasar el puntero por encima. */
function buildHoverQuestions(lang: Language, displayName?: string): string[] {
  const name = (displayName || '').trim();
  if (lang === 'es') {
    return [
      name ? `${name}, ¿en qué te ayudo?` : '¿En qué te ayudo?',
      '¿Ya tienes un plan?',
      '¿Necesitas una mano?',
      '¿Qué construimos hoy?',
      '¿Pregúntame lo que quieras!',
      '¿Probamos otro modelo?',
      '¿Reviso tu código?',
      '¿Abro el Workbench?',
    ];
  }
  if (lang === 'de') {
    return [
      name ? `${name}, wie kann ich helfen?` : 'Wie kann ich helfen?',
      'Hast du schon einen Plan?',
      'Brauchst du eine Hand?',
      'Was bauen wir heute?',
      'Frag mich einfach!',
      'Probieren wir ein anderes Modell?',
      'Soll ich deinen Code prüfen?',
      'Soll ich die Workbench öffnen?',
    ];
  }
  return [
    name ? `${name}, how can I help?` : 'How can I help?',
    'Do you have a plan yet?',
    'Need a hand?',
    'What are we building today?',
    'Ask me anything!',
    'Shall we try another model?',
    'Want me to review your code?',
    'Shall I open the Workbench?',
  ];
}

const RESPONSES_ES: Record<string, string[]> = {
  'hola': ['¡Hola! ¿Cómo estás?', '¡Hey! Qué gusto verte.'],
  'ayuda': ['Puedo ayudarte con comandos, navegación y configuración. ¿Qué necesitas?', 'Cuéntame tu problema y buscaremos solución.'],
  'gracias': ['¡De nada! Para eso estoy.', '¡Un placer ayudarte!'],
  'adios': ['¡Hasta luego! Aquí estaré si me necesitas.', '¡Adiós! Que tengas buen día.'],
  'error': ['Ups, algo salió mal. ¿Intentamos de nuevo?', 'Eso no funcionó como esperaba...'],
  'procesando': ['Déjame pensar...', 'Procesando tu solicitud...', 'Un momento, estoy en ello.'],
  default: [
    'Interesante... cuéntame más.',
    'Entiendo. ¿Algo más en lo que pueda ayudarte?',
    'Buena pregunta. Déjame pensar...',
    'No estoy seguro, pero podemos averiguarlo juntos.',
    '¡Fascinante! ¿Qué más necesitas?',
  ],
};

const RESPONSES_EN: Record<string, string[]> = {
  'hello': ['Hi! How are you?', 'Hey! Good to see you.'],
  'help': ['I can help with commands, navigation, and settings. What do you need?', 'Tell me your problem and we\'ll find a solution.'],
  'thanks': ['You\'re welcome! That\'s what I\'m here for.', 'Happy to help!'],
  'bye': ['Goodbye! I\'ll be here if you need me.', 'Bye! Have a great day.'],
  'error': ['Oops, something went wrong. Try again?', 'That didn\'t work as expected...'],
  'processing': ['Let me think...', 'Processing your request...', 'One moment, I\'m on it.'],
  default: [
    'Interesting... tell me more.',
    'I see. Anything else I can help with?',
    'Good question. Let me think...',
    'I\'m not sure, but we can figure it out together.',
    'Fascinating! What else do you need?',
  ],
};

const RESPONSES_DE: Record<string, string[]> = {
  'hallo': ['Hallo! Wie geht es dir?', 'Hey! Schön, dich zu sehen.'],
  'hilfe': ['Ich kann bei Befehlen, Navigation und Einstellungen helfen. Was brauchst du?', 'Beschreibe dein Problem, dann finden wir eine Lösung.'],
  'danke': ['Gern geschehen! Dafür bin ich da.', 'Freut mich, zu helfen!'],
  'tschüss': ['Bis später! Ich bin da, wenn du mich brauchst.', 'Tschüss! Einen schönen Tag noch.'],
  'fehler': ['Ups, da ist etwas schiefgelaufen. Nochmal versuchen?', 'Das hat nicht wie erwartet funktioniert...'],
  'verarbeit': ['Lass mich nachdenken...', 'Ich verarbeite deine Anfrage...', 'Einen Moment, ich bin dran.'],
  default: [
    'Interessant... erzähl mir mehr.',
    'Verstehe. Kann ich sonst noch helfen?',
    'Gute Frage. Lass mich nachdenken...',
    'Ich bin nicht sicher, aber wir finden es gemeinsam heraus.',
    'Faszinierend! Was brauchst du noch?',
  ],
};

function getExpressionForText(text: string): NonoExpression {
  const lower = text.toLowerCase();
  if (lower.includes('hola') || lower.includes('hello') || lower.includes('hey') || lower.includes('hallo')) return 'happy';
  if (lower.includes('error') || lower.includes('fallo') || lower.includes('failed') || lower.includes('fehler')) return 'error';
  if (lower.includes('gracias') || lower.includes('thanks') || lower.includes('danke')) return 'love';
  if (lower.includes('adios') || lower.includes('bye') || lower.includes('chao') || lower.includes('tschüss')) return 'happy';
  if (lower.includes('ayuda') || lower.includes('help') || lower.includes('hilfe')) return 'thinking';
  if (lower.includes('?')) return 'surprised';
  return 'neutral';
}

/** Texto del saludo flotante que escribe Nono (solo lo muestra Nono). */
function buildGreeting(lang: Language, displayName?: string): string {
  const name = (displayName || '').trim();
  if (lang === 'es') {
    return name
      ? `¡Hola, ${name}! Soy Nono. ¿En qué puedo ayudarte hoy?`
      : '¡Hola! Soy Nono. ¿En qué puedo ayudarte hoy?';
  }
  if (lang === 'de') {
    return name
      ? `Hallo, ${name}! Ich bin Nono. Wie kann ich dir heute helfen?`
      : 'Hallo! Ich bin Nono. Wie kann ich dir heute helfen?';
  }
  return name
    ? `Hello, ${name}! I'm Nono. How can I help you today?`
    : "Hello! I'm Nono. How can I help you today?";
}

function getResponse(text: string, lang: Language): string {
  const lower = text.toLowerCase();
  const responses = lang === 'es' ? RESPONSES_ES : lang === 'de' ? RESPONSES_DE : RESPONSES_EN;
  for (const [key, value] of Object.entries(responses)) {
    if (key !== 'default' && lower.includes(key)) {
      return value[Math.floor(Math.random() * value.length)];
    }
  }
  const defaults = responses.default;
  return defaults[Math.floor(Math.random() * defaults.length)];
}

// Remove 3D effects from Nono head - flat retro design
// 3D gradients and filters removed for simpler vectorial appearance

/** Genera sugerencias contextuales tipo Google AI Studio basadas en modo, proyecto y tarea. */
function generateProjectSuggestions(projectInfo: FloatingAssistantProps['projectInfo'], lang: Language, suggestionConfig: FloatingAssistantProps['suggestionConfig']): string[] {
  if (!projectInfo) return [];
  
  const { files = [], hasPackageJson, hasTsConfig, hasGit, framework, mainLanguage, goal, mode } = projectInfo;
  const config = suggestionConfig ?? { idleTimeMs: 15000, maxSuggestions: 3, includeModeSpecific: true, includeProjectSpecific: true, includeTaskSpecific: true };
  const { maxSuggestions = 3, includeModeSpecific = true, includeProjectSpecific = true, includeTaskSpecific = true } = config;
  
  const suggestions: string[] = [];
  
  // Helper to limit array to maxSuggestions
  const limitSuggestions = (arr: string[]) => arr.slice(0, maxSuggestions);
  
  // 1. SUGERENCIAS POR MODO (si está habilitado)
  if (includeModeSpecific && mode) {
    if (lang === 'es') {
      if (mode === 'chat') {
        suggestions.push('¿Probamos otro modelo?');
        suggestions.push('¿Reiniciamos la conversación?');
        suggestions.push('¿Abrimos el Workbench?');
      } else if (mode === 'freeform') {
        suggestions.push('¿Completamos más texto?');
        suggestions.push('¿Probamos otro modelo?');
        suggestions.push('¿Guardamos este freeform?');
      } else if (mode === 'agent') {
        suggestions.push('¿Revisamos el progress del agente?');
        suggestions.push('¿Cambiamos de modelo?');
        suggestions.push('¿Hacemos pause al agente?');
      }
    } else if (lang === 'de') {
      if (mode === 'chat') {
        suggestions.push('Probieren wir ein anderes Modell?');
        suggestions.push('Starten wir die Unterhaltung neu?');
        suggestions.push('Öffnen wir die Workbench?');
      } else if (mode === 'freeform') {
        suggestions.push('Vervollständigen wir mehr Text?');
        suggestions.push('Probieren wir ein anderes Modell?');
        suggestions.push('Speichern wir dieses Freeform?');
      } else if (mode === 'agent') {
        suggestions.push('Prüfen wir den Fortschritt des Agenten?');
        suggestions.push('Wechseln wir das Modell?');
        suggestions.push('Pausieren wir den Agenten?');
      }
    } else {
      if (mode === 'chat') {
        suggestions.push('Shall we try another model?');
        suggestions.push('Shall we restart the conversation?');
        suggestions.push('Shall we open the Workbench?');
      } else if (mode === 'freeform') {
        suggestions.push('Shall we complete more text?');
        suggestions.push('Shall we try another model?');
        suggestions.push('Shall we save this freeform?');
      } else if (mode === 'agent') {
        suggestions.push('Check the agent progress?');
        suggestions.push('Change the model?');
        suggestions.push('Pause agent execution?');
      }
    }
  }
  
  // 2. SUGERENCIAS POR PROYECTO (si está habilitado)
  if (includeProjectSpecific) {
    // Project-specific suggestions based on files and config
    if (hasPackageJson) {
      if (lang === 'es') {
        suggestions.push('¿Ejecutamos `npm test` para verificar el proyecto?');
        suggestions.push('¿Configuramos scripts personalizados en package.json?');
      } else if (lang === 'de') {
        suggestions.push('Führen wir `npm test` aus, um das Projekt zu prüfen?');
        suggestions.push('Eigene Skripte in package.json konfigurieren?');
      } else {
        suggestions.push('Shall we run `npm test` to verify the project?');
        suggestions.push('Configure custom scripts in package.json?');
      }
    }
    if (hasTsConfig) {
      if (lang === 'es') {
        suggestions.push('¿Ejecutamos `tsc --noEmit` para type-checking?');
        suggestions.push('¿Habilitamos `strict: true` en tsconfig.json?');
      } else if (lang === 'de') {
        suggestions.push('`tsc --noEmit` für die Typprüfung ausführen?');
        suggestions.push('`strict: true` in tsconfig.json aktivieren?');
      } else {
        suggestions.push('Run `tsc --noEmit` for type-checking?');
        suggestions.push('Enable `strict: true` in tsconfig.json?');
      }
    }
    if (hasGit) {
      if (lang === 'es') {
        suggestions.push('¿Creamos un checkpoint antes de cambios mayores?');
        suggestions.push('¿Configuramos hooks de pre-commit con husky?');
      } else if (lang === 'de') {
        suggestions.push('Vor größeren Änderungen einen Checkpoint erstellen?');
        suggestions.push('Pre-Commit-Hooks mit husky konfigurieren?');
      } else {
        suggestions.push('Create a checkpoint before major changes?');
        suggestions.push('Configure pre-commit hooks with husky?');
      }
    }
    if (mainLanguage === 'typescript' || mainLanguage === 'javascript') {
      if (lang === 'es') {
        suggestions.push('¿Ejecutamos ESLint para encontrar issues?');
        suggestions.push('¿Añadimos Prettier para formateo consistente?');
      } else if (lang === 'de') {
        suggestions.push('ESLint ausführen, um Probleme zu finden?');
        suggestions.push('Prettier für einheitliche Formatierung hinzufügen?');
      } else {
        suggestions.push('Run ESLint to find issues?');
        suggestions.push('Add Prettier for consistent formatting?');
      }
    }
    if (files.some(f => f.endsWith('.test.ts') || f.endsWith('.spec.ts'))) {
      if (lang === 'es') {
        suggestions.push('¿Ejecutamos tests con coverage?');
      } else if (lang === 'de') {
        suggestions.push('Tests mit Coverage ausführen?');
      } else {
        suggestions.push('Run tests with coverage?');
      }
    }
    if (files.some(f => f.endsWith('.md'))) {
      if (lang === 'es') {
        suggestions.push('¿Generamos documentación automática?');
      } else if (lang === 'de') {
        suggestions.push('Automatische Dokumentation generieren?');
      } else {
        suggestions.push('Generate automatic documentation?');
      }
    }
    if (files.some(f => f.includes('Dockerfile') || f.includes('docker-compose'))) {
      if (lang === 'es') {
        suggestions.push('¿Optimizamos el Dockerfile para producción?');
      } else if (lang === 'de') {
        suggestions.push('Das Dockerfile für die Produktion optimieren?');
      } else {
        suggestions.push('Optimize Dockerfile for production?');
      }
    }
    if (framework) {
      if (lang === 'es') {
        suggestions.push(`¿Revisamos las mejores prácticas de ${framework}?`);
      } else if (lang === 'de') {
        suggestions.push(`Best Practices für ${framework} prüfen?`);
      } else {
        suggestions.push(`Review ${framework} best practices?`);
      }
    }
  }
  
  // 3. SUGERENCIAS POR TAREA/GOAL (si está habilitado y hay goal)
  if (includeTaskSpecific && goal) {
    // Extract key words from goal to generate relevant suggestions
    const goalLower = goal.toLowerCase();
    
    if (lang === 'es') {
      // General task-based suggestions
      suggestions.push('¿Revisamos el código por seguridad?');
      suggestions.push('¿Mejoramos la accesibilidad?');
      suggestions.push('¿Optimizamos el rendimiento?');
      
      // Task-specific based on goal keywords
      if (goalLower.includes('typescript') || goalLower.includes('javascript')) {
        suggestions.push('¿Añadimos TypeScript/JS a el proyecto?');
      }
      if (goalLower.includes('docker') || goalLower.includes('contener')) {
        suggestions.push('¿Configuramos Docker para este proyecto?');
      }
      if (goalLower.includes('test') || goalLower.includes('pruebas')) {
        suggestions.push('¿Ejecutamos tests de validación?');
      }
      if (goalLower.includes('document') || goalLower.includes('doc')) {
        suggestions.push('¿Generamos documentación?');
      }
      if (goalLower.includes('deploy') || goalLower.includes('publicar')) {
        suggestions.push('¿Desplegamos la aplicación?');
      }
      if (goalLower.includes('optim') || goalLower.includes('mejor')) {
        suggestions.push('¿Optimizamos el rendimiento?');
      }
    } else if (lang === 'de') {
      suggestions.push('Code auf Sicherheit prüfen?');
      suggestions.push('Barrierefreiheit verbessern?');
      suggestions.push('Leistung optimieren?');

      if (goalLower.includes('typescript') || goalLower.includes('javascript')) {
        suggestions.push('TypeScript/JS zum Projekt hinzufügen?');
      }
      if (goalLower.includes('docker') || goalLower.includes('container')) {
        suggestions.push('Docker für dieses Projekt konfigurieren?');
      }
      if (goalLower.includes('test') || goalLower.includes('tests')) {
        suggestions.push('Validierungstests ausführen?');
      }
      if (goalLower.includes('document') || goalLower.includes('doc')) {
        suggestions.push('Dokumentation generieren?');
      }
      if (goalLower.includes('deploy') || goalLower.includes('publish')) {
        suggestions.push('Die Anwendung bereitstellen?');
      }
      if (goalLower.includes('optim') || goalLower.includes('improve')) {
        suggestions.push('Leistung optimieren?');
      }
    } else {
      suggestions.push('Review code for security?');
      suggestions.push('Improve accessibility?');
      suggestions.push('Optimize performance?');
      
      if (goalLower.includes('typescript') || goalLower.includes('javascript')) {
        suggestions.push('Add TypeScript/JS to the project?');
      }
      if (goalLower.includes('docker') || goalLower.includes('container')) {
        suggestions.push('Configure Docker for this project?');
      }
      if (goalLower.includes('test') || goalLower.includes('tests')) {
        suggestions.push('Run validation tests?');
      }
      if (goalLower.includes('document') || goalLower.includes('doc')) {
        suggestions.push('Generate documentation?');
      }
      if (goalLower.includes('deploy') || goalLower.includes('publish')) {
        suggestions.push('Deploy the application?');
      }
      if (goalLower.includes('optim') || goalLower.includes('improve')) {
        suggestions.push('Optimize performance?');
      }
    }
  }
  
  // 4. Añadir algunas sugerencias genéricas si aún no hemos alcanzado maxSuggestions
  const genericSuggestionsES = [
    '¿Revisamos el código por seguridad?',
    '¿Mejoramos la accesibilidad?',
    '¿Optimizamos el rendimiento?',
    '¿Añadimos tests E2E?',
    '¿Configuramos CI/CD?',
  ];
  const genericSuggestionsEN = [
    'Review code for security?',
    'Improve accessibility?',
    'Optimize performance?',
    'Add E2E tests?',
    'Configure CI/CD?',
  ];
  const genericSuggestionsDE = [
    'Code auf Sicherheit prüfen?',
    'Barrierefreiheit verbessern?',
    'Leistung optimieren?',
    'E2E-Tests hinzufügen?',
    'CI/CD konfigurieren?',
  ];
  
  // Fill remaining slots with generic suggestions if under maxSuggestions
  let remainingSlots = maxSuggestions - suggestions.length;
  if (remainingSlots > 0 && lang === 'es') {
    for (let i = 0; i < remainingSlots && i < genericSuggestionsES.length; i++) {
      // Only add if not already in suggestions
      if (!suggestions.includes(genericSuggestionsES[i])) {
        suggestions.push(genericSuggestionsES[i]);
      }
    }
  } else if (remainingSlots > 0 && lang === 'de') {
    for (let i = 0; i < remainingSlots && i < genericSuggestionsDE.length; i++) {
      if (!suggestions.includes(genericSuggestionsDE[i])) {
        suggestions.push(genericSuggestionsDE[i]);
      }
    }
  } else if (remainingSlots > 0 && lang === 'en') {
    for (let i = 0; i < remainingSlots && i < genericSuggestionsEN.length; i++) {
      if (!suggestions.includes(genericSuggestionsEN[i])) {
        suggestions.push(genericSuggestionsEN[i]);
      }
    }
  }
  
  return limitSuggestions(suggestions);
}

/** Cabeza de Nono: ojos que miran al puntero, parpadeo, expresiones dinámicas - Estilo 3D mejorado */
export const NonoHead: React.FC<{
  expression: NonoExpression;
  eyeOffset: { x: number; y: number };
  blink: boolean;
  size?: number;
  show3D?: boolean;
}> = ({ expression, eyeOffset, blink, size = 64, show3D = true }) => {
  const strokeColor = expression === 'angry' || expression === 'error' ? '#ff5555' : '#00ffff';

  const pupilOffsetX = Math.max(-3, Math.min(3, eyeOffset.x * 0.5));
  const pupilOffsetY = Math.max(-2, Math.min(2, eyeOffset.y * 0.5));

  // LED de la antena: es el único indicador que parpadea en Nono.
  // · Activo → amarillo Norton. · Reposo (dormido) → verde. · Alerta/error → rojo.
  const ledAlert = expression === 'error' || expression === 'angry';
  const ledResting = expression === 'sleepy';
  const antennaColor = ledAlert ? '#ff5555' : ledResting ? '#00ff66' : '#ffff55';
  const ledState = ledAlert ? 'alert' : ledResting ? 'resting' : 'active';

  // Contorno de cabeza más fino: 1.5px en lugar de 2.5px para estilo más ligero
  const strokeWidth = 1.5;

  const renderEyes = () => {
    // 3D eye whites with gradient
    const eyeHighlight = show3D ? (
      <>
        <ellipse cx="17" cy="35" rx="1.5" ry="1" fill="#ffffff" opacity="0.3" />
        <ellipse cx="41" cy="35" rx="1.5" ry="1" fill="#ffffff" opacity="0.3" />
        <ellipse cx="16" cy="34" rx="0.8" ry="0.6" fill="#ffffff" opacity="0.5" />
        <ellipse cx="40" cy="34" rx="0.8" ry="0.6" fill="#ffffff" opacity="0.5" />
      </>
    ) : null;

    if (blink) {
      return (
        <>
          <line x1="14" y1="38" x2="26" y2="38" stroke={strokeColor} strokeWidth="2" strokeLinecap="round" filter="drop-shadow(0 1px 2px rgba(0,0,0,0.5))" />
          <line x1="38" y1="38" x2="50" y2="38" stroke={strokeColor} strokeWidth="2" strokeLinecap="round" filter="drop-shadow(0 1px 2px rgba(0,0,0,0.5))" />
        </>
      );
    }

    switch (expression) {
      case 'happy':
      case 'love':
        return (
          <>
            {eyeHighlight}
            <path d="M14 38 Q20 32 26 38" fill="none" stroke={strokeColor} strokeWidth="2" strokeLinecap="round" filter="drop-shadow(0 1px 2px rgba(0,0,0,0.3))" />
            <path d="M38 38 Q44 32 50 38" fill="none" stroke={strokeColor} strokeWidth="2" strokeLinecap="round" filter="drop-shadow(0 1px 2px rgba(0,0,0,0.3))" />
          </>
        );
      case 'sad':
        return (
          <>
            {eyeHighlight}
            <path d="M14 42 Q20 46 26 42" fill="none" stroke={strokeColor} strokeWidth="2" strokeLinecap="round" filter="drop-shadow(0 1px 2px rgba(0,0,0,0.3))" />
            <path d="M38 42 Q44 46 50 42" fill="none" stroke={strokeColor} strokeWidth="2" strokeLinecap="round" filter="drop-shadow(0 1px 2px rgba(0,0,0,0.3))" />
          </>
        );
      case 'surprised':
        return (
          <>
            {eyeHighlight}
            <circle cx="20" cy="38" r="6" fill={show3D ? 'url(#nonoEyeWhite)' : 'none'} stroke={strokeColor} strokeWidth="2" filter="drop-shadow(0 1px 2px rgba(0,0,0,0.3))" />
            <circle cx="44" cy="38" r="6" fill={show3D ? 'url(#nonoEyeWhite)' : 'none'} stroke={strokeColor} strokeWidth="2" filter="drop-shadow(0 1px 2px rgba(0,0,0,0.3))" />
            <circle cx={20 + pupilOffsetX} cy={38 + pupilOffsetY} r="3" fill="#000000" filter="drop-shadow(0 1px 1px rgba(0,0,0,0.5))" />
            <circle cx={44 + pupilOffsetX} cy={38 + pupilOffsetY} r="3" fill="#000000" filter="drop-shadow(0 1px 1px rgba(0,0,0,0.5))" />
            <circle cx={18 + pupilOffsetX} cy={36 + pupilOffsetY} r="0.8" fill="#ffffff" opacity="0.6" />
            <circle cx={42 + pupilOffsetX} cy={36 + pupilOffsetY} r="0.8" fill="#ffffff" opacity="0.6" />
          </>
        );
      case 'angry':
        return (
          <>
            <line x1="14" y1="34" x2="26" y2="40" stroke={strokeColor} strokeWidth="2" strokeLinecap="round" filter="drop-shadow(0 1px 2px rgba(0,0,0,0.3))" />
            <line x1="50" y1="34" x2="38" y2="40" stroke={strokeColor} strokeWidth="2" strokeLinecap="round" filter="drop-shadow(0 1px 2px rgba(0,0,0,0.3))" />
          </>
        );
      case 'wink':
        return (
          <>
            {eyeHighlight}
            <line x1="14" y1="38" x2="26" y2="38" stroke={strokeColor} strokeWidth="2" strokeLinecap="round" filter="drop-shadow(0 1px 2px rgba(0,0,0,0.3))" />
            <path d="M38 38 Q44 34 50 38" fill="none" stroke={strokeColor} strokeWidth="2" strokeLinecap="round" filter="drop-shadow(0 1px 2px rgba(0,0,0,0.3))" />
          </>
        );
      case 'sleepy':
        return (
          <>
            <path d="M14 38 Q20 40 26 38" fill="none" stroke={strokeColor} strokeWidth="1.5" strokeLinecap="round" filter="drop-shadow(0 1px 2px rgba(0,0,0,0.3))" />
            <path d="M38 38 Q44 40 50 38" fill="none" stroke={strokeColor} strokeWidth="1.5" strokeLinecap="round" filter="drop-shadow(0 1px 2px rgba(0,0,0,0.3))" />
          </>
        );
      case 'thinking':
      case 'watch':
        return (
          <>
            {eyeHighlight}
            <circle cx="20" cy="38" r="5" fill={show3D ? 'url(#nonoEyeWhite)' : 'none'} stroke={strokeColor} strokeWidth="2" filter="drop-shadow(0 1px 2px rgba(0,0,0,0.3))" />
            <circle cx="44" cy="38" r="5" fill={show3D ? 'url(#nonoEyeWhite)' : 'none'} stroke={strokeColor} strokeWidth="2" filter="drop-shadow(0 1px 2px rgba(0,0,0,0.3))" />
            <circle cx={20 + pupilOffsetX} cy={38 + pupilOffsetY} r="3" fill="#000000" filter="drop-shadow(0 1px 1px rgba(0,0,0,0.5))" />
            <circle cx={44 + pupilOffsetX} cy={38 + pupilOffsetY} r="3" fill="#000000" filter="drop-shadow(0 1px 1px rgba(0,0,0,0.5))" />
            <circle cx={18 + pupilOffsetX} cy={36 + pupilOffsetY} r="0.8" fill="#ffffff" opacity="0.6" />
            <circle cx={42 + pupilOffsetX} cy={36 + pupilOffsetY} r="0.8" fill="#ffffff" opacity="0.6" />
          </>
        );
      case 'curious':
        return (
          <>
            {eyeHighlight}
            <circle cx={20 + pupilOffsetX * 1.5} cy={38 + pupilOffsetY * 1.5} r="7" fill={show3D ? 'url(#nonoEyeWhite)' : 'none'} stroke={strokeColor} strokeWidth="2" filter="drop-shadow(0 1px 2px rgba(0,0,0,0.3))" />
            <circle cx={44 + pupilOffsetX * 1.5} cy={38 + pupilOffsetY * 1.5} r="7" fill={show3D ? 'url(#nonoEyeWhite)' : 'none'} stroke={strokeColor} strokeWidth="2" filter="drop-shadow(0 1px 2px rgba(0,0,0,0.3))" />
            <circle cx={20 + pupilOffsetX * 2} cy={38 + pupilOffsetY * 2} r="3.5" fill="#000000" filter="drop-shadow(0 1px 1px rgba(0,0,0,0.5))" />
            <circle cx={44 + pupilOffsetX * 2} cy={38 + pupilOffsetY * 2} r="3.5" fill="#000000" filter="drop-shadow(0 1px 1px rgba(0,0,0,0.5))" />
            <circle cx={17 + pupilOffsetX * 2} cy={35 + pupilOffsetY * 2} r="1" fill="#ffffff" opacity="0.8" />
            <circle cx={41 + pupilOffsetX * 2} cy={35 + pupilOffsetY * 2} r="1" fill="#ffffff" opacity="0.8" />
          </>
        );
      case 'error':
        return (
          <>
            <line x1="14" y1="32" x2="26" y2="44" stroke="#ff5555" strokeWidth="2" strokeLinecap="round" filter="drop-shadow(0 1px 2px rgba(255,0,0,0.3))" />
            <line x1="26" y1="32" x2="14" y2="44" stroke="#ff5555" strokeWidth="2" strokeLinecap="round" filter="drop-shadow(0 1px 2px rgba(255,0,0,0.3))" />
            <line x1="38" y1="32" x2="50" y2="44" stroke="#ff5555" strokeWidth="2" strokeLinecap="round" filter="drop-shadow(0 1px 2px rgba(255,0,0,0.3))" />
            <line x1="50" y1="32" x2="38" y2="44" stroke="#ff5555" strokeWidth="2" strokeLinecap="round" filter="drop-shadow(0 1px 2px rgba(255,0,0,0.3))" />
          </>
        );
      case 'cool':
        return (
          <>
            <rect x="12" y="34" width="16" height="10" rx="2" fill="#001a33" stroke={strokeColor} strokeWidth="1.5" filter="drop-shadow(0 1px 2px rgba(0,0,0,0.3))" />
            <rect x="36" y="34" width="16" height="10" rx="2" fill="#001a33" stroke={strokeColor} strokeWidth="1.5" filter="drop-shadow(0 1px 2px rgba(0,0,0,0.3))" />
            <line x1="28" y1="38" x2="36" y2="38" stroke={strokeColor} strokeWidth="1.5" />
          </>
        );
      default: // neutral - ojos que miran al puntero
        return (
          <>
            {eyeHighlight}
            <circle cx="20" cy="38" r="6" fill={show3D ? 'url(#nonoEyeWhite)' : 'none'} stroke={strokeColor} strokeWidth="2" filter="drop-shadow(0 1px 2px rgba(0,0,0,0.3))" />
            <circle cx="44" cy="38" r="6" fill={show3D ? 'url(#nonoEyeWhite)' : 'none'} stroke={strokeColor} strokeWidth="2" filter="drop-shadow(0 1px 2px rgba(0,0,0,0.3))" />
            <circle cx={20 + pupilOffsetX} cy={38 + pupilOffsetY} r="3" fill="#000000" filter="drop-shadow(0 1px 1px rgba(0,0,0,0.5))" />
            <circle cx={44 + pupilOffsetX} cy={38 + pupilOffsetY} r="3" fill="#000000" filter="drop-shadow(0 1px 1px rgba(0,0,0,0.5))" />
            <circle cx={18 + pupilOffsetX} cy={36 + pupilOffsetY} r="0.8" fill="#ffffff" opacity="0.6" />
            <circle cx={42 + pupilOffsetX} cy={36 + pupilOffsetY} r="0.8" fill="#ffffff" opacity="0.6" />
          </>
        );
    }
  };

  const renderMouth = () => {
    switch (expression) {
      case 'happy':
      case 'love':
        return <path d="M20 50 Q32 58 44 50" fill="none" stroke={strokeColor} strokeWidth="2.5" strokeLinecap="round" />;
      case 'sad':
        return <path d="M20 56 Q32 48 44 56" fill="none" stroke={strokeColor} strokeWidth="2.5" strokeLinecap="round" />;
      case 'surprised':
        return <ellipse cx="32" cy="52" rx="4" ry="5" fill="none" stroke={strokeColor} strokeWidth="2" />;
      case 'angry':
        return <path d="M22 54 L42 50" stroke="#ff5555" strokeWidth="2.5" strokeLinecap="round" />;
      case 'wink':
        return <path d="M22 52 Q32 56 42 52" fill="none" stroke={strokeColor} strokeWidth="2.5" strokeLinecap="round" />;
      case 'sleepy':
        return <line x1="24" y1="52" x2="40" y2="52" stroke={strokeColor} strokeWidth="2" strokeLinecap="round" />;
      case 'thinking':
      case 'watch':
        return <path d="M26 54 Q32 52 38 54" fill="none" stroke={strokeColor} strokeWidth="2" strokeLinecap="round" />;
      case 'curious':
        return <ellipse cx="32" cy="52" rx="3" ry="4" fill="none" stroke={strokeColor} strokeWidth="2" />;
      case 'error':
        return <path d="M24 56 L40 50" stroke="#ff5555" strokeWidth="2.5" strokeLinecap="round" />;
      case 'cool':
        return <path d="M24 52 Q32 56 40 52" fill="none" stroke={strokeColor} strokeWidth="2.5" strokeLinecap="round" />;
      default:
        return <line x1="24" y1="52" x2="40" y2="52" stroke={strokeColor} strokeWidth="2" strokeLinecap="round" />;
    }
  };

  return (
    <svg viewBox="0 0 64 64" width={size} height={size} data-expression={expression} data-blink={blink ? 'true' : 'false'}>
      <defs>
        {/* 3D radial gradient for body */}
        <radialGradient id="nonoBody" cx="50%" cy="30%" r="70%">
          <stop offset="0%" stopColor="#003355" />
          <stop offset="50%" stopColor="#002244" />
          <stop offset="100%" stopColor="#001122" />
        </radialGradient>
        {/* 3D eye white gradient */}
        <radialGradient id="nonoEyeWhite" cx="40%" cy="35%" r="80%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.9" />
          <stop offset="50%" stopColor="#e8f4ff" stopOpacity="0.7" />
          <stop offset="100%" stopColor="#cce8ff" stopOpacity="0.4" />
        </radialGradient>
        {/* 3D body highlight gradient */}
        <linearGradient id="nonoHighlight" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#00ffff" stopOpacity="0.15" />
          <stop offset="100%" stopColor="#00ffff" stopOpacity="0" />
        </linearGradient>
        {/* Filtro de sombra vectorial para profundidad */}
        <filter id="nonoShadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="3" dy="6" stdDeviation="4" floodColor="#000000" floodOpacity="0.4" />
          <feGaussianBlur stdDeviation="0.5" result="blur" />
        </filter>
        {/* Inner glow for 3D effect */}
        <filter id="nonoInnerGlow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="2" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      {/* Cabeza con sombra vectorial 3D */}
      <g filter="url(#nonoShadow)">
        <rect x="8" y="12" width="48" height="44" rx="12" fill="url(#nonoBody)" stroke={strokeColor} strokeWidth={strokeWidth} />
        {/* Inner highlight for 3D depth */}
        <rect x="10" y="14" width="44" height="18" rx="10" fill="url(#nonoHighlight)" stroke="none" opacity="0.3" />
      </g>
      {/* Antena */}
      <line x1="32" y1="12" x2="32" y2="6" stroke={strokeColor} strokeWidth="2.5" strokeLinecap="round" filter="drop-shadow(0 2px 4px rgba(0,0,0,0.3))" />
      {/* LED de la antena: único parpadeo de Nono (halo + núcleo) */}
      <g className="nono-antenna-led" data-led={ledState}>
        <circle cx="32" cy="5" r="6" fill={antennaColor} opacity="0.25" className="nono-led-halo" filter="drop-shadow(0 0 8px currentColor)" />
        <circle cx="32" cy="5" r="3" fill={antennaColor} className="nono-led-core" filter="drop-shadow(0 0 4px currentColor)" />
      </g>
      {/* Ojos */}
      {renderEyes()}
      {/* Boca */}
      {renderMouth()}
      {/* Mejillas */}
      {(expression === 'happy' || expression === 'love') && (
        <>
          <circle cx="14" cy="48" r="3" fill="#ff5555" opacity="0.3" filter="drop-shadow(0 1px 2px rgba(255,0,0,0.3))" />
          <circle cx="50" cy="48" r="3" fill="#ff5555" opacity="0.3" filter="drop-shadow(0 1px 2px rgba(255,0,0,0.3))" />
        </>
      )}
    </svg>
  );
};

export const FloatingAssistant = React.forwardRef<FloatingAssistantHandle, FloatingAssistantProps>(({
  lang = 'es',
  displayName,
  onNewPrompt,
  status,
  onOpenWorkbench,
  onOpenCompile,
  onOpenGallery,
  onOpenSearch,
  selectedModel,
  selectedProvider,
  parameters,
  projectInfo,
  suggestionConfig,
  codeContext,
  hidden,
}, ref) => {
  const [isOpen, setIsOpen] = useState(false);
  const [expression, setExpression] = useState<NonoExpression>('neutral');
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [eyeOffset, setEyeOffset] = useState({ x: 0, y: 0 });
  const [blink, setBlink] = useState(false);
  const [isWatchingChat, setIsWatchingChat] = useState(false);
  const [isChatTyping, setIsChatTyping] = useState(false);
  const [chatBounceToken, setChatBounceToken] = useState(0);
  const [anchor, setAnchor] = useState({ bottom: 8, right: 8 });
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [actionFeedback, setActionFeedback] = useState('');
  const [typedGreeting, setTypedGreeting] = useState('');
  const [greetingVisible, setGreetingVisible] = useState(false);
  const [hoverPhrase, setHoverPhrase] = useState('');
  const [contextPhrase, setContextPhrase] = useState('');

  const dragRef = useRef<{ startX: number; startY: number; startPosX: number; startPosY: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const isWatchingChatRef = useRef(false);
  const chatTypingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressClickRef = useRef(false);
  const hasMovedRef = useRef(false);
  const dragRafRef = useRef<number | null>(null);
  const pendingDragPositionRef = useRef<{ x: number; y: number } | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const blinkTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const greetingTypeRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const greetingHideRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const onAskRef = useRef<(text: string) => Promise<string | null>>(askNono);
  const reactionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suggestionIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const suggestionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const contextPhraseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [projectSuggestion, setProjectSuggestion] = useState('');
  const [showProjectSuggestion, setShowProjectSuggestion] = useState(false);

  // Mantiene la referencia actual de `askNono` con los parámetros del momento.
  const ask = useCallback(
    async (text: string) => {
      return askNono(text, { selectedModel, selectedProvider, parameters, lang, codeContext });
    },
    [selectedModel, selectedProvider, parameters, lang, codeContext]
  );
  onAskRef.current = ask;

  // Restaurar posición guardada (con clamp a la ventana actual)
  useEffect(() => {
    const saved = loadNonoPosition();
    if (saved) {
      setDragPos({
        x: Math.max(0, Math.min(saved.x, window.innerWidth - 70)),
        y: Math.max(0, Math.min(saved.y, window.innerHeight - 70)),
      });
    }
  }, []);

  // Persistir posición cuando el usuario suelta a Nono
  useEffect(() => {
    if (dragPos && !isDragging) {
      saveNonoPosition(dragPos);
    }
  }, [dragPos, isDragging]);

  // Anclaje a la línea divisoria del chat ([data-chat-divider])
  useEffect(() => {
    let ro: ResizeObserver | null = null;
    let currentDivider: Element | null = null;

    const measure = () => {
      const divider = document.querySelector('[data-chat-divider]');
      if (divider !== currentDivider) {
        if (ro) { ro.disconnect(); ro = null; }
        currentDivider = divider;
        if (divider) {
          ro = new ResizeObserver(measure);
          ro.observe(divider);
        }
      }
      if (divider) {
        const rect = divider.getBoundingClientRect();
        // Borde inferior de Nono se sienta sobre la línea (4px de solape)
        setAnchor({
          bottom: Math.max(0, window.innerHeight - rect.top - 4),
          right: 8,
        });
      } else {
        setAnchor({ bottom: 8, right: 8 });
      }
    };

    measure();
    const mo = new MutationObserver(measure);
    mo.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('resize', measure);
    // Fallback por si el divider aparece tarde (cambio de modo)
    const interval = setInterval(measure, 1000);

    return () => {
      mo.disconnect();
      window.removeEventListener('resize', measure);
      clearInterval(interval);
      if (ro) ro.disconnect();
    };
  }, []);

  // Saludo flotante con efecto de tipeado (solo lo muestra Nono, sin recuadro)
  const greetingText = buildGreeting(lang, displayName);
  useEffect(() => {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    setTypedGreeting('');
    setGreetingVisible(false);
    if (greetingTypeRef.current) clearInterval(greetingTypeRef.current);
    if (greetingHideRef.current) clearTimeout(greetingHideRef.current);

    const startDelay = setTimeout(() => {
      setGreetingVisible(true);
      setExpression('happy');

      // Con "reduced motion" mostramos el texto completo de golpe
      if (reduceMotion) {
        setTypedGreeting(greetingText);
        greetingHideRef.current = setTimeout(() => setGreetingVisible(false), 8000);
        return;
      }

      let i = 0;
      greetingTypeRef.current = setInterval(() => {
        i += 1;
        setTypedGreeting(greetingText.slice(0, i));
        if (i >= greetingText.length) {
          if (greetingTypeRef.current) clearInterval(greetingTypeRef.current);
          greetingTypeRef.current = null;
          setExpression((prev) => (prev === 'happy' ? 'neutral' : prev));
          greetingHideRef.current = setTimeout(() => setGreetingVisible(false), 8000);
        }
      }, 42);
    }, 1100);

    return () => {
      clearTimeout(startDelay);
      if (greetingTypeRef.current) clearInterval(greetingTypeRef.current);
      if (greetingHideRef.current) clearTimeout(greetingHideRef.current);
    };
  }, [greetingText]);

  // Ojos siguen el mouse globalmente
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      const head = headRef.current;
      if (!head) return;
      const rect = head.getBoundingClientRect();
      const headCenterX = rect.left + rect.width / 2;
      const headCenterY = rect.top + rect.height / 2;
      const dx = e.clientX - headCenterX;
      const dy = e.clientY - headCenterY;
      const angle = Math.atan2(dy, dx);
      setEyeOffset({
        x: Math.cos(angle),
        y: Math.sin(angle),
      });
    };
    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);

  // Parpadeo aleatorio
  useEffect(() => {
    let cancelled = false;
    const blinkLoop = () => {
      if (cancelled) return;
      blinkTimerRef.current = setTimeout(() => {
        if (cancelled) return;
        setBlink(true);
        setTimeout(() => {
          if (cancelled) return;
          setBlink(false);
          blinkLoop();
        }, 120);
      }, 2000 + Math.random() * 4000);
    };
    blinkLoop();
    return () => {
      cancelled = true;
      if (blinkTimerRef.current) clearTimeout(blinkTimerRef.current);
    };
  }, []);

  // Observa el chat: la expresión curious se activa SOLO cuando el usuario
  // escribe en el textarea del chat; si deja de escribir durante 1s, Nono
  // abandona "curious" (vuelve a 'watch' si sigue enfocado, o 'neutral').
  useEffect(() => {
    const onFocusIn = (e: FocusEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('.nono-panel')) return;
      if (target.hasAttribute('data-chat-input')) {
        isWatchingChatRef.current = true;
        setIsWatchingChat(true);
        setExpression('watch');
      }
    };
    const onFocusOut = (e: FocusEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('.nono-panel')) return;
      if (target.hasAttribute('data-chat-input')) {
        isWatchingChatRef.current = false;
        setIsWatchingChat(false);
        setIsChatTyping(false);
        if (chatTypingTimerRef.current) {
          clearTimeout(chatTypingTimerRef.current);
          chatTypingTimerRef.current = null;
        }
        setExpression((prev) => (prev === 'curious' ? 'neutral' : prev));
      }
    };
    const onChatInput = (e: Event) => {
      const target = e.target as HTMLElement;
      if (target.closest('.nono-panel')) return;
      if (!target.hasAttribute('data-chat-input')) return;
      isWatchingChatRef.current = true;
      setIsWatchingChat(true);
      // Reinicia el temporizador de 1s de inactividad
      if (chatTypingTimerRef.current) clearTimeout(chatTypingTimerRef.current);
      setIsChatTyping((prev) => {
        if (!prev) setChatBounceToken((t) => t + 1);
        return true;
      });
      setExpression('curious');
      chatTypingTimerRef.current = setTimeout(() => {
        chatTypingTimerRef.current = null;
        setIsChatTyping(false);
        setExpression((prev) =>
          prev === 'curious' ? (isWatchingChatRef.current ? 'watch' : 'neutral') : prev
        );
      }, 1000);
    };
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);
    document.addEventListener('input', onChatInput, true);
    return () => {
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
      document.removeEventListener('input', onChatInput, true);
      if (chatTypingTimerRef.current) {
        clearTimeout(chatTypingTimerRef.current);
        chatTypingTimerRef.current = null;
      }
    };
  }, []);

  // Auto-sleep después de inactividad (con un ojo abierto)
  // Nono aparenta dormir pero conserva su estado de observación.
  // Si estaba watching chat, mantiene ese estado al "dormir".
  useEffect(() => {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    idleTimerRef.current = setTimeout(() => {
      // Dormir con "un ojo abierto": expresión sleepy pero manteniendo
      // el estado de observación si estaba activo antes.
      if (!isOpen && isWatchingChat) {
        // Estaba viendo el chat -> dormir pero con ojo medio abierto
        setExpression('sleepy');
        // Mantener isWatchingChat true mientras dormimos
      } else if (!isOpen && !isWatchingChat) {
        // Inactividad pura -> dormir de verdad
        setExpression('sleepy');
      }
      // Si open, no dormir
    }, 300000); // 5 minutes instead of 30 seconds
    return () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    };
  }, [expression, isOpen, isWatchingChat]);

  // Sugerencias de proyecto contextuales (cada 45-60s cuando Nono está inactivo)
  useEffect(() => {
    if (!projectInfo || isOpen || isWatchingChat) return;
    
    const showSuggestion = () => {
      const suggestions = generateProjectSuggestions(projectInfo, lang, suggestionConfig);
      if (suggestions.length > 0) {
        const suggestion = suggestions[Math.floor(Math.random() * suggestions.length)];
        setProjectSuggestion(suggestion);
        setShowProjectSuggestion(true);
        setExpression('thinking');
        
        // Ocultar después de 5 segundos
        setTimeout(() => {
          setShowProjectSuggestion(false);
          setProjectSuggestion('');
          setExpression((prev) => (prev === 'thinking' ? 'neutral' : prev));
        }, 5000);
      }
    };

    // Primera sugerencia después de 15s de inactividad
    const idleTime = suggestionConfig?.idleTimeMs ?? 8000;
    suggestionTimerRef.current = setTimeout(showSuggestion, idleTime);
    
    // Luego cada 45-60s
    suggestionIntervalRef.current = setInterval(() => {
      if (!isOpen && !isWatchingChat && projectInfo) {
        showSuggestion();
      }
    }, 50000);

    return () => {
      if (suggestionTimerRef.current) clearTimeout(suggestionTimerRef.current);
      if (suggestionIntervalRef.current) clearInterval(suggestionIntervalRef.current);
      setShowProjectSuggestion(false);
    };
  }, [projectInfo, lang, isOpen, isWatchingChat]);

  // Frase contextual breve (reacciones de la app); se limpia sola.
  const showContextPhrase = useCallback((text: string, ms = 3800) => {
    setContextPhrase(text);
    if (contextPhraseTimerRef.current) clearTimeout(contextPhraseTimerRef.current);
    contextPhraseTimerRef.current = setTimeout(() => setContextPhrase(''), ms);
  }, []);

  // Reacciones contextuales según el último evento de la app.
  useEffect(() => {
    if (!status) return;
    if (reactionTimerRef.current) clearTimeout(reactionTimerRef.current);

    const t = status.type;
    if (t === 'generating') {
      setExpression('thinking');
    } else if (t === 'done') {
      setExpression('happy');
      reactionTimerRef.current = setTimeout(() => {
        setExpression((prev) => (prev === 'happy' ? 'neutral' : prev));
      }, 2500);
    } else if (t === 'error') {
      setExpression('error');
      showContextPhrase(lang === 'es' ? '⚠️ Algo falló. ¿Reviso el error?' : lang === 'de' ? '⚠️ Etwas ist fehlgeschlagen. Soll ich mir das ansehen?' : '⚠️ Something failed. Want me to look?');
      reactionTimerRef.current = setTimeout(() => {
        setExpression((prev) => (prev === 'error' ? 'neutral' : prev));
      }, 4500);
    } else if (t === 'success') {
      setExpression('love');
      reactionTimerRef.current = setTimeout(() => {
        setExpression((prev) => (prev === 'love' ? 'neutral' : prev));
      }, 3000);
    } else if (t === 'mode') {
      if (status.detail) {
        showContextPhrase(
          lang === 'es' ? `🔄 Modo ${status.detail}` : lang === 'de' ? `🔄 Modus ${status.detail}` : `🔄 Mode ${status.detail}`,
          3000
        );
      }
    } else if (t === 'new_prompt') {
      setExpression('happy');
      reactionTimerRef.current = setTimeout(() => {
        setExpression((prev) => (prev === 'happy' ? 'neutral' : prev));
      }, 2500);
    }

    return () => {
      if (reactionTimerRef.current) clearTimeout(reactionTimerRef.current);
    };
  }, [status, lang, showContextPhrase]);

  // Scroll al final de mensajes
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Cerrar con Escape
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) setIsOpen(false);
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isOpen]);

  const addMessage = useCallback((text: string, fromUser: boolean) => {
    const msg: Message = {
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      text,
      fromUser,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };
    setMessages((prev) => [...prev, msg]);
  }, []);

  const handleToggle = () => {
    setGreetingVisible(false);
    if (!isOpen && messages.length === 0) {
      const greetings = lang === 'es' ? GREETINGS_ES : lang === 'de' ? GREETINGS_DE : GREETINGS_EN;
      const greeting = greetings[Math.floor(Math.random() * greetings.length)];
      setExpression('happy');
      addMessage(greeting, false);
    }
    setIsOpen((prev) => !prev);
    if (!isOpen) {
      setExpression('happy');
      setTimeout(() => inputRef.current?.focus(), 300);
    }
  };

  const handleCommand = (cmdRaw: string) => {
    const cmd = cmdRaw.toLowerCase();
    if (cmd.startsWith('/workbench') && onOpenWorkbench) {
      onOpenWorkbench();
      showActionFeedback(lang === 'es' ? '🧩 Abriendo Workbench' : lang === 'de' ? '🧩 Workbench wird geöffnet' : '🧩 Opening Workbench');
    } else if (cmd.startsWith('/comp') && onOpenCompile) {
      onOpenCompile();
      showActionFeedback(lang === 'es' ? '🛠️ Abriendo compilador' : lang === 'de' ? '🛠️ Compiler wird geöffnet' : '🛠️ Opening compiler');
    } else if (cmd.startsWith('/galer') && onOpenGallery) {
      onOpenGallery();
      showActionFeedback(lang === 'es' ? '🌐 Abriendo galería' : lang === 'de' ? '🌐 Galerie wird geöffnet' : '🌐 Opening gallery');
    } else if (cmd.startsWith('/bus') && onOpenSearch) {
      onOpenSearch();
      showActionFeedback(lang === 'es' ? '🔍 Abriendo búsqueda' : lang === 'de' ? '🔍 Suche wird geöffnet' : '🔍 Opening search');
    } else if (cmd.startsWith('/nuevo') || cmd.startsWith('/new')) {
      onNewPrompt?.();
      setIsOpen(false);
    } else {
      setIsTyping(true);
      setTimeout(() => {
        addMessage(
          lang === 'es'
            ? 'Comando no reconocido. Prueba: /workbench, /compilar, /galeria, /buscar, /nuevo'
            : lang === 'de' ? 'Unbekannter Befehl. Versuche: /workbench, /compile, /gallery, /search, /new' : 'Unknown command. Try: /workbench, /compile, /gallery, /search, /new',
          false
        );
        setIsTyping(false);
      }, 500);
    }
  };

  const handleSend = () => {
    const text = inputValue.trim();
    if (!text) return;
    addMessage(text, true);
    setInputValue('');
    setExpression(getExpressionForText(text));

    // Comandos de consola rápidos (sin pasar por el modelo).
    if (text.startsWith('/')) {
      handleCommand(text);
      return;
    }

    setIsTyping(true);

    // Respaldo con plantillas: se agenda YA (timing predecible y offline).
    // Si el modelo contesta rápido, se cancela y se usa su respuesta.
    const fallbackTimer = setTimeout(() => {
      const response = getResponse(text, lang);
      addMessage(response, false);
      setIsTyping(false);
      setExpression('happy');
      setTimeout(() => setExpression('neutral'), 3000);
    }, 1000 + Math.random() * 1500);

    void (async () => {
      let reply: string | null = null;
      try {
        reply = await onAskRef.current(text);
      } catch {
        reply = null;
      }
      if (reply && reply.trim()) {
        clearTimeout(fallbackTimer);
        addMessage(reply.trim(), false);
        setIsTyping(false);
        setExpression('happy');
        setTimeout(() => setExpression('neutral'), 3000);
      }
    })();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSend();
  };

  // Handle imperativo: abrir Nono con un prompt desde fuera (ej. @nono en chat general)
  useImperativeHandle(ref, () => ({
    openWithPrompt: (prompt: string, sendImmediately = false) => {
      setIsOpen(true);
      setInputValue(prompt);
      if (sendImmediately && prompt.trim()) {
        // Pequeño delay para que el input se actualice antes de enviar
        setTimeout(() => handleSend(), 50);
      }
    },
  }), [handleSend]);

  // ---- Acciones rápidas del mini-chat ----
  const showActionFeedback = useCallback((message: string) => {
    setActionFeedback(message);
    setTimeout(() => setActionFeedback(''), 1800);
  }, []);

  const handleClearChat = () => {
    setMessages([]);
    setExpression('happy');
    showActionFeedback(lang === 'es' ? '🗑️ Chat limpiado' : lang === 'de' ? '🗑️ Chat geleert' : '🗑️ Chat cleared');
  };

  const handleCopyLast = async () => {
    const last = messages[messages.length - 1];
    if (!last) {
      showActionFeedback(lang === 'es' ? 'Nada que copiar' : lang === 'de' ? 'Nichts zum Kopieren' : 'Nothing to copy');
      return;
    }
    try {
      await navigator.clipboard.writeText(last.text);
      setExpression('happy');
      showActionFeedback(lang === 'es' ? '📋 ¡Copiado!' : lang === 'de' ? '📋 Kopiert!' : '📋 Copied!');
    } catch {
      showActionFeedback(lang === 'es' ? 'Error al copiar' : lang === 'de' ? 'Kopieren fehlgeschlagen' : 'Copy failed');
    }
  };

  const handleNewPromptClick = () => {
    onNewPrompt?.();
    setIsOpen(false);
    showActionFeedback(lang === 'es' ? '🆕 Nuevo prompt' : lang === 'de' ? '🆕 Neuer Prompt' : '🆕 New prompt');
  };

  // Preguntas dinámicas al pasar el puntero por Nono
  const handleHeadMouseEnter = () => {
    if (isOpen) return;
    if (!isWatchingChat) setExpression('happy');
    const questions = buildHoverQuestions(lang, displayName);
    setHoverPhrase(questions[Math.floor(Math.random() * questions.length)]);
  };

  const handleHeadMouseLeave = () => {
    setHoverPhrase('');
    if (!isOpen && !isTyping && !isWatchingChat) setExpression('neutral');
  };

  // Drag handlers (posición absoluta mientras se arrastra)
  const handleMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('.nono-panel')) return;
    setGreetingVisible(false);
    hasMovedRef.current = false;
    suppressClickRef.current = false;
    setIsDragging(true);
    const rect = headRef.current?.getBoundingClientRect();
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startPosX: rect ? rect.left : 0,
      startPosY: rect ? rect.top : 0,
    };
  };

  const handleMouseMove = useCallback((e: any) => {
    if (!isDragging || !dragRef.current) return;
    const clientX = typeof e?.clientX === 'number' ? e.clientX : (e?.touches?.[0]?.clientX ?? 0);
    const clientY = typeof e?.clientY === 'number' ? e.clientY : (e?.touches?.[0]?.clientY ?? 0);

    if (!hasMovedRef.current) {
      const dx = clientX - dragRef.current.startX;
      const dy = clientY - dragRef.current.startY;
      if (Math.hypot(dx, dy) > 5) hasMovedRef.current = true;
    }

    const newX = Math.max(0, Math.min(dragRef.current.startPosX + (clientX - dragRef.current.startX), window.innerWidth - 70));
    const newY = Math.max(0, Math.min(dragRef.current.startPosY + (clientY - dragRef.current.startY), window.innerHeight - 70));

    pendingDragPositionRef.current = { x: newX, y: newY };

    if (dragRafRef.current === null) {
      dragRafRef.current = requestAnimationFrame(() => {
        const next = pendingDragPositionRef.current;
        if (next) setDragPos(next);
        dragRafRef.current = null;
        pendingDragPositionRef.current = null;
      });
    }
  }, [isDragging]);

  const handleMouseUp = () => {
    suppressClickRef.current = hasMovedRef.current;

    // Flush any pending drag frame to avoid a skipped last movement.
    if (dragRafRef.current !== null) {
      cancelAnimationFrame(dragRafRef.current);
      dragRafRef.current = null;
    }
    const pending = pendingDragPositionRef.current;
    if (pending) setDragPos(pending);
    pendingDragPositionRef.current = null;

    setIsDragging(false);
    dragRef.current = null;
    hasMovedRef.current = false;
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    if ((e.target as HTMLElement).closest('.nono-panel')) return;
    setGreetingVisible(false);
    hasMovedRef.current = false;
    suppressClickRef.current = false;
    setIsDragging(true);
    const t = e.touches[0];
    const rect = headRef.current?.getBoundingClientRect();
    dragRef.current = {
      startX: t.clientX,
      startY: t.clientY,
      startPosX: rect ? rect.left : 0,
      startPosY: rect ? rect.top : 0,
    };
  };

  useEffect(() => {
    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('touchmove', handleMouseMove, { passive: false });
      window.addEventListener('mouseup', handleMouseUp);
      window.addEventListener('touchend', handleMouseUp);
      return () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('touchmove', handleMouseMove as any);
        window.removeEventListener('mouseup', handleMouseUp);
        window.removeEventListener('touchend', handleMouseUp);
      };
    }
  }, [isDragging, handleMouseMove]);

  // Estilo de la cabeza: anclada a la línea o arrastrada
  // Offset de ~2mm (≈8px) — la sombra es vectorial (SVG filter)
  const GAP = 8; // 2 mm ≈ 8px
  const headStyle: React.CSSProperties = dragPos
    ? {
        left: 0,
        top: 0,
        transform: `translate3d(${dragPos.x}px, ${dragPos.y}px, 0) ${isChatTyping && !isDragging ? 'rotate(-7deg)' : ''}`,
        willChange: 'transform',
        transition: isChatTyping ? 'transform 0.25s ease-out' : 'none',
      }
    : isChatTyping
      ? { bottom: anchor.bottom + GAP, right: anchor.right + GAP, transform: 'rotate(-7deg)', transition: 'transform 0.25s ease-out' }
      : { bottom: anchor.bottom + GAP, right: anchor.right + GAP };

  // Panel: se abre justo encima de la cabeza (64px de altura + 4px de margen)
  const headBottomEdge = dragPos
    ? window.innerHeight - dragPos.y - 64
    : anchor.bottom;
  const panelStyle: React.CSSProperties = {
    bottom: Math.max(8, Math.min(headBottomEdge + 68, window.innerHeight - 340)),
    right: 8,
    height: 320,
  };

  // Saludo flotante: se sitúa encima de la cabeza, alineado a su borde derecho
  const headTopPx = dragPos
    ? dragPos.y
    : Math.max(0, window.innerHeight - anchor.bottom - GAP - 64);
  const headRightPx = dragPos
    ? Math.max(8, window.innerWidth - dragPos.x - 64)
    : anchor.right + GAP;
  const greetingStyle: React.CSSProperties = {
    top: Math.max(8, headTopPx - 58),
    right: headRightPx,
    maxWidth: 'min(280px, calc(100vw - 2rem))',
  };

  if (hidden) return null;

  return (
    <>
      {/* Texto flotante de Nono: saludo con tipeado o pregunta dinámica al pasar el puntero */}
      {(() => {
        const floatingMessage = hoverPhrase || contextPhrase || projectSuggestion || typedGreeting;
        const floatingVisible = Boolean(hoverPhrase) || Boolean(contextPhrase) || showProjectSuggestion || greetingVisible;
        const typingCaret = !hoverPhrase && !contextPhrase && !showProjectSuggestion && greetingVisible && typedGreeting.length < greetingText.length;
        if (!floatingVisible && typedGreeting.length === 0) return null;
        return (
          <div
            className={`pointer-events-none fixed z-[9997] transition-opacity duration-300 ${
              floatingVisible ? 'opacity-100' : 'opacity-0'
            }`}
            style={greetingStyle}
            data-nono-greeting="true"
            data-nono-hover={hoverPhrase ? 'true' : undefined}
            data-nono-suggestion={showProjectSuggestion ? 'true' : undefined}
            aria-live="polite"
          >
            <p
              className="text-right text-[#00ffff] font-bold text-sm leading-snug"
              style={{
                textShadow:
                  '0 2px 8px rgba(0,0,0,0.9), 0 0 3px rgba(0,0,0,0.95), 0 0 16px rgba(0,255,255,0.4)',
              }}
            >
              {floatingMessage}
              {typingCaret && (
                <span className="ml-0.5 inline-block h-3.5 w-[2px] animate-pulse bg-[#00ffff] align-middle" />
              )}
            </p>
          </div>
        );
      })()}

      {/* Panel de chat */}
      {isOpen && (
        <div
          className="nono-panel fixed z-[9999] w-80 max-w-[calc(100vw-2rem)] bg-[#001a33] border-2 border-[#00ffff] rounded-lg shadow-[0_0_30px_rgba(0,255,255,0.3)] flex flex-col overflow-hidden"
          style={panelStyle}
        >
          {/* Header del panel */}
          <div className="flex items-center justify-between px-3 py-2 bg-[#00aaaa] border-b-2 border-[#000055] shrink-0">
            <div className="flex items-center gap-2">
              <span className="text-black font-bold text-sm">Nono</span>
              <span className="text-[10px] text-black/60">{isTyping ? '...' : 'online'}</span>
            </div>
            <button
              onClick={() => setIsOpen(false)}
              aria-label={lang === 'es' ? 'Cerrar panel' : lang === 'de' ? 'Panel schließen' : 'Close panel'}
              data-tooltip={lang === 'es' ? 'Cerrar panel' : lang === 'de' ? 'Panel schließen' : 'Close panel'}
              className="text-black hover:text-red-500 font-bold leading-none px-1"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Acciones rápidas */}
          <div className="flex items-center gap-1 px-2 py-1 bg-[#00243e] border-b border-[#004466] shrink-0">
            <button
              onClick={handleClearChat}
              data-tooltip={lang === 'es' ? 'Limpiar chat' : lang === 'de' ? 'Chat leeren' : 'Clear chat'}
              aria-label={lang === 'es' ? 'Limpiar chat' : lang === 'de' ? 'Chat leeren' : 'Clear chat'}
              className="text-[#00ffff] hover:bg-[#000080] border border-[#004466] rounded px-1.5 py-0.5 text-[10px] font-bold"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={handleCopyLast}
              data-tooltip={lang === 'es' ? 'Copiar último mensaje' : lang === 'de' ? 'Letzte Nachricht kopieren' : 'Copy last message'}
              aria-label={lang === 'es' ? 'Copiar último mensaje' : lang === 'de' ? 'Letzte Nachricht kopieren' : 'Copy last message'}
              className="text-[#00ffff] hover:bg-[#000080] border border-[#004466] rounded px-1.5 py-0.5 text-[10px] font-bold"
            >
              <Clipboard className="w-3.5 h-3.5" />
            </button>
            {onNewPrompt && (
              <button
                onClick={handleNewPromptClick}
                data-tooltip={lang === 'es' ? 'Nuevo prompt' : lang === 'de' ? 'Neuer Prompt' : 'New prompt'}
                aria-label={lang === 'es' ? 'Nuevo prompt' : lang === 'de' ? 'Neuer Prompt' : 'New prompt'}
                className="text-[#ffff55] hover:bg-[#000080] border border-[#004466] rounded px-1.5 py-0.5 text-[10px] font-bold"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            )}
            {actionFeedback && (
              <span className="ml-auto text-[10px] text-[#ffff55] animate-pulse">{actionFeedback}</span>
            )}
          </div>

          {/* Chips de acciones reales de la app */}
          {(onOpenWorkbench || onOpenCompile || onOpenGallery || onOpenSearch) && (
            <div className="flex flex-wrap gap-1 px-2 py-1 bg-[#001633] border-b border-[#004466] shrink-0">
              {onOpenWorkbench && (
                <button
                  onClick={() => { onOpenWorkbench(); setExpression('happy'); }}
                  data-tooltip={lang === 'es' ? 'Abrir Workbench' : lang === 'de' ? 'Workbench öffnen' : 'Open Workbench'}
                  data-tooltip-sub={lang === 'es' ? 'Abre el panel de archivos y herramientas' : lang === 'de' ? 'Panel für Dateien und Tools öffnen' : 'Open the files & tools panel'}
                  aria-label={lang === 'es' ? 'Abrir Workbench' : lang === 'de' ? 'Workbench öffnen' : 'Open Workbench'}
                  className="flex items-center gap-1 text-[9px] font-bold text-[#00ffff] bg-[#0000aa] hover:bg-[#00aaaa] hover:text-black border border-[#00ffff]/60 rounded px-1.5 py-0.5"
                >
                  <PanelRight className="w-3 h-3" /> {lang === 'es' ? 'Workbench' : lang === 'de' ? 'Workbench' : 'Workbench'}
                </button>
              )}
              {onOpenCompile && (
                <button
                  onClick={() => { onOpenCompile(); setExpression('happy'); }}
                  data-tooltip={lang === 'es' ? 'Compilar / Exportar proyecto' : lang === 'de' ? 'Projekt kompilieren / exportieren' : 'Compile / Export project'}
                  data-tooltip-sub={lang === 'es' ? 'Abre el compilador nativo' : lang === 'de' ? 'Nativen Compiler öffnen' : 'Open the native compiler'}
                  aria-label={lang === 'es' ? 'Compilar / Exportar proyecto' : lang === 'de' ? 'Projekt kompilieren / exportieren' : 'Compile / Export project'}
                  className="flex items-center gap-1 text-[9px] font-bold text-[#ffff55] bg-[#0000aa] hover:bg-[#00aaaa] hover:text-black border border-[#00ffff]/60 rounded px-1.5 py-0.5"
                >
                  <Hammer className="w-3 h-3" /> {lang === 'es' ? 'Compilar' : lang === 'de' ? 'Kompilieren' : 'Compile'}
                </button>
              )}
              {onOpenGallery && (
                <button
                  onClick={() => { onOpenGallery(); setExpression('happy'); }}
                  data-tooltip={lang === 'es' ? 'Galería de proyectos' : lang === 'de' ? 'Projektgalerie' : 'Project gallery'}
                  data-tooltip-sub={lang === 'es' ? 'Explora y carga proyectos de la comunidad' : lang === 'de' ? 'Community-Projekte durchsuchen und laden' : 'Browse and load community projects'}
                  aria-label={lang === 'es' ? 'Galería de proyectos' : lang === 'de' ? 'Projektgalerie' : 'Project gallery'}
                  className="flex items-center gap-1 text-[9px] font-bold text-[#00ffff] bg-[#0000aa] hover:bg-[#00aaaa] hover:text-black border border-[#00ffff]/60 rounded px-1.5 py-0.5"
                >
                  <Library className="w-3 h-3" /> {lang === 'es' ? 'Galería' : lang === 'de' ? 'Galerie' : 'Gallery'}
                </button>
              )}
              {onOpenSearch && (
                <button
                  onClick={() => { onOpenSearch(); setExpression('happy'); }}
                  data-tooltip={lang === 'es' ? 'Buscar en el proyecto' : lang === 'de' ? 'Projekt durchsuchen' : 'Search the project'}
                  data-tooltip-sub={lang === 'es' ? 'Abre la búsqueda de código' : lang === 'de' ? 'Codesuche öffnen' : 'Open the code search'}
                  aria-label={lang === 'es' ? 'Buscar en el proyecto' : lang === 'de' ? 'Projekt durchsuchen' : 'Search the project'}
                  className="flex items-center gap-1 text-[9px] font-bold text-[#00ffff] bg-[#0000aa] hover:bg-[#00aaaa] hover:text-black border border-[#00ffff]/60 rounded px-1.5 py-0.5"
                >
                  <Search className="w-3 h-3" /> {lang === 'es' ? 'Buscar' : lang === 'de' ? 'Suchen' : 'Search'}
                </button>
              )}
            </div>
          )}

          {/* Mensajes */}
          <div className="flex-1 overflow-y-auto p-3 space-y-2 bg-[#000d1a]">
            {messages.map((msg) => (
              <div key={msg.id} className={`flex ${msg.fromUser ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`nc-x-scroll max-w-[85%] px-3 py-1.5 rounded-lg text-xs ${
                    msg.fromUser
                      ? 'bg-[#ffff55] text-black font-bold'
                      : 'bg-[#00243e] text-[#00ffff] border border-[#004466]'
                  }`}
                >
                  <p>{msg.text}</p>
                  <span className="text-[9px] opacity-50 block text-right">{msg.timestamp}</span>
                </div>
              </div>
            ))}
            {isTyping && (
              <div className="flex justify-start">
                <div className="bg-[#00243e] text-[#00ffff] border border-[#004466] px-3 py-1.5 rounded-lg text-xs">
                  <span className="animate-pulse">● ● ●</span>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="flex gap-1 p-2 bg-[#001a33] border-t border-[#004466] shrink-0">
            <input
              ref={inputRef}
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={lang === 'es' ? 'Escribe un mensaje...' : lang === 'de' ? 'Nachricht eingeben...' : 'Type a message...'}
              className="flex-1 bg-[#000080] text-[#00ffff] text-xs px-2 py-1.5 rounded border border-[#004466] outline-none placeholder:text-[#00ffff]/40 focus:border-[#00ffff]"
            />
            <button
              onClick={handleSend}
              aria-label={lang === 'es' ? 'Enviar mensaje' : lang === 'de' ? 'Nachricht senden' : 'Send message'}
              className="nc-button !px-2 !py-1 text-xs font-bold flex items-center gap-1"
            >
              <Send className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Cabeza flotante de Nono - solo la cabeza, sin botón ni marco */}
      <div
        ref={headRef}
        onMouseDown={handleMouseDown}
        onTouchStart={handleTouchStart}
        onClick={(e) => {
          if (suppressClickRef.current) {
            suppressClickRef.current = false;
            e.preventDefault();
            return;
          }
          handleToggle();
        }}
        onDoubleClick={() => { setDragPos(null); clearNonoPosition(); }}
        onMouseEnter={handleHeadMouseEnter}
        onMouseLeave={handleHeadMouseLeave}
        tabIndex={0}
        aria-grabbed={isDragging}
        aria-expanded={isOpen}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            if (suppressClickRef.current) {
              suppressClickRef.current = false;
              return;
            }
            handleToggle();
          }
        }}
        className={`fixed z-[9998] select-none touch-none focus:outline-none focus-visible:outline-none outline-none ${isDragging ? 'cursor-grabbing' : ''} ${expression !== 'sleepy' ? 'nono-awake' : ''} ${isChatTyping && !isDragging ? 'nono-lean-chat' : ''}`}
        style={headStyle}
        aria-label="Nono"
      >
        <NonoHead key={chatBounceToken} expression={expression} eyeOffset={eyeOffset} blink={blink} size={64} show3D={true} />
        {/* "Zzz" de cómic mientras Nono duerme */}
        {expression === 'sleepy' && !hoverPhrase && !contextPhrase && (
          <div className="nono-sleep-z absolute pointer-events-none" aria-hidden="true">
            <span>Z</span>
            <span>z</span>
            <span>z</span>
          </div>
        )}
      </div>
    </>
  );
});

export default FloatingAssistant;
