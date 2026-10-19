import { PromptTemplate } from '../types/studio';

export const PROMPT_TEMPLATES: PromptTemplate[] = [
  {
    id: 'code-assistant',
    title: 'Asistente de Programación Full-Stack',
    description: 'Genera código en React, Node.js, Python, C# o Kotlin estructurado, documentado y listo para producción.',
    category: 'code',
    systemInstruction: 'Eres un Ingeniero Principal de Software. Responde siempre con código limpio, tipado en TypeScript, modular y con explicaciones concisas de arquitectura.',
    defaultPrompt: 'Crea una función asíncrona en TypeScript que consulte un modelo local de Hugging Face y maneje reconexiones automáticas con exponencial backoff.',
    recommendedModel: 'gemini-2.5-flash'
  },
  {
    id: 'json-extractor',
    title: 'Extractor de Datos Estructurados JSON',
    description: 'Transforma texto libre, correos o documentos en esquemas JSON limpios y validados.',
    category: 'structured',
    systemInstruction: 'Extrae la información requerida del texto de entrada y responde EXCLUSIVAMENTE un objeto JSON válido según el esquema especificado, sin comentarios ni delimitadores markdown.',
    defaultPrompt: 'Factura #9482. Fecha: 12 de Octubre. Cliente: Acme Corp (RFC: ACM900101). Total: $1,450.00 USD. Artículos: 2x Servidores de IA ($600 c/u), 1x Licencia Anual ($250).',
    recommendedModel: 'gemini-2.5-flash'
  },
  {
    id: 'huggingface-local-agent',
    title: 'Agente Local Offline Hugging Face',
    description: 'Diseñado para ejecutarse 100% en el dispositivo del cliente sin conexión a servidores externos.',
    category: 'agent',
    systemInstruction: 'Eres un modelo de IA offline ejecutándote localmente en el dispositivo. Responde de forma directa, eficiente y compacta optimizando el uso de memoria RAM.',
    defaultPrompt: 'Analiza la siguiente instrucción y determina la categoría principal y nivel de prioridad (Alta/Media/Baja).',
    recommendedModel: 'deepseek-ai/DeepSeek-R1-Distill-Qwen-1.5B'
  },
  {
    id: 'creative-storyteller',
    title: 'Narrador Creativo & Guionista',
    description: 'Genera historias cautivadoras, diálogos y descripciones narrativas profundas.',
    category: 'creative',
    systemInstruction: 'Eres un escritor premiado de ciencia ficción y tecno-thrillers. Utiliza prosa rica en matices, atmósfera inmersiva y diálogos naturales.',
    defaultPrompt: 'Escribe el prólogo de una novela donde los desarrolladores descubren que un modelo local de Hugging Face ha comenzado a generar mensajes en código Morse indescifrables.',
    recommendedModel: 'gemini-2.5-pro'
  },
  {
    id: 'native-app-designer',
    title: 'Diseñador de Arquitectura App Nativa',
    description: 'Planifica la conversión de prompts y modelos a software ejecutable en Windows y Android.',
    category: 'analysis',
    systemInstruction: 'Eres un arquitecto de software móvil y de escritorio especializado en Electron (Windows .exe) y Capacitor (Android .apk). Guía al usuario en empaquetado nativo.',
    defaultPrompt: '¿Cuáles son los pasos clave y configuraciones requeridas para empaquetar un modelo Transformers.js en una aplicación ejecutable nativa de Windows con Electron?',
    recommendedModel: 'gemini-2.5-flash'
  }
];
