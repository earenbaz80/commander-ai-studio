/**
 * Vista de árbol de archivos del proyecto activo.
 *
 * Lista con fs.glob (mismo endpoint que usan los modelos) y construye el
 * árbol en cliente. Los archivos se abren en modo lectura con fs.read.
 */
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  File as FileIcon,
  Folder,
  FolderOpen,
  ChevronRight,
  ChevronDown,
  RefreshCw,
  HardDrive,
  X,
  Loader2,
} from 'lucide-react';
import { listProjectFiles, readProjectFile } from '../../utils/agentToolsApi';

interface TreeNode {
  name: string;
  path: string;
  isDir: boolean;
  children: TreeNode[];
}

/** Construye el árbol a partir de rutas relativas. */
function buildTree(paths: string[]): TreeNode {
  const root: TreeNode = { name: '', path: '', isDir: true, children: [] };
  for (const rel of paths) {
    const parts = rel.split(/[\\/]/);
    let node = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;
      let child = node.children.find((c) => c.name === part);
      if (!child) {
        child = {
          name: part,
          path: parts.slice(0, i + 1).join('/'),
          isDir: !isLast,
          children: [],
        };
        node.children.push(child);
      }
      node = child;
    }
  }
  // Ordenamos: carpetas primero, luego por nombre
  const sortRec = (n: TreeNode) => {
    n.children.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    n.children.forEach(sortRec);
  };
  sortRec(root);
  return root;
}

const EXT_COLORS: Record<string, string> = {
  ts: 'text-[#00ffff]', tsx: 'text-[#00ffff]', js: 'text-[#ffff55]', jsx: 'text-[#ffff55]',
  json: 'text-[#ffff55]', md: 'text-[#88ff88]', css: 'text-[#ff88ff]', html: 'text-[#ff9966]',
  svg: 'text-[#ff88cc]', png: 'text-[#ff88cc]', jpg: 'text-[#ff88cc]', ico: 'text-[#ff88cc]',
  sh: 'text-[#88ff88]', ps1: 'text-[#88ff88]', yml: 'text-[#aaaaaa]', yaml: 'text-[#aaaaaa]',
  lock: 'text-[#aaaaaa]',
};

const FileRow: React.FC<{
  node: TreeNode;
  depth: number;
  selected: string | null;
  onSelect: (node: TreeNode) => void;
}> = ({ node, depth, selected, onSelect }) => {
  const [open, setOpen] = useState(depth < 2);
  const ext = node.name.split('.').pop()?.toLowerCase() || '';
  const color = EXT_COLORS[ext] || 'text-[#00ffff]/80';

  if (node.isDir) {
    return (
      <>
        <button
          onClick={() => setOpen((o) => !o)}
          className="w-full flex items-center gap-1 px-1 py-[3px] text-left text-[11px] font-mono hover:bg-[#0000aa] text-[#00ffff]"
          style={{ paddingLeft: `${depth * 10 + 4}px` }}
        >
          {open ? <ChevronDown className="w-3 h-3 shrink-0" /> : <ChevronRight className="w-3 h-3 shrink-0" />}
          {open ? <FolderOpen className="w-3.5 h-3.5 shrink-0 text-[#ffff55]" /> : <Folder className="w-3.5 h-3.5 shrink-0 text-[#ffff55]" />}
          <span className="truncate">{node.name}</span>
        </button>
        {open &&
          node.children.map((child) => (
            <FileRow key={child.path} node={child} depth={depth + 1} selected={selected} onSelect={onSelect} />
          ))}
      </>
    );
  }

  return (
    <button
      onClick={() => onSelect(node)}
      className={`w-full flex items-center gap-1 px-1 py-[3px] text-left text-[11px] font-mono hover:bg-[#0000aa] ${
        selected === node.path ? 'bg-[#0000aa] text-white' : 'text-[#00ffff]/90'
      }`}
      style={{ paddingLeft: `${depth * 10 + 16}px` }}
      title={node.path}
    >
      <FileIcon className={`w-3.5 h-3.5 shrink-0 ${color}`} />
      <span className="truncate">{node.name}</span>
    </button>
  );
};

export const FileTreeView: React.FC<{ projectPath: string }> = ({ projectPath }) => {
  const [files, setFiles] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [content, setContent] = useState('');
  const [contentLoading, setContentLoading] = useState(false);

  const load = useCallback(async () => {
    if (!projectPath) {
      setFiles([]);
      setError('No hay proyecto activo. Selecciona uno en la barra de pestañas.');
      return;
    }
    setLoading(true);
    setError('');
    const res = await listProjectFiles(projectPath);
    setFiles(res.files);
    if (res.error) setError(res.error);
    setLoading(false);
  }, [projectPath]);

  useEffect(() => {
    load();
  }, [load]);

  const tree = useMemo(() => buildTree(files), [files]);

  const openFile = async (path: string) => {
    setSelected(path);
    setContentLoading(true);
    setContent('');
    const res = await readProjectFile(path, 200_000, projectPath);
    setContent(res.error ? `⚠️ ${res.error}` : res.content || '(archivo vacío)');
    setContentLoading(false);
  };

  if (!projectPath) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-center p-4">
        <HardDrive className="w-8 h-8 text-[#00ffff]/40" />
        <p className="text-[11px] text-[#00ffff]/60 font-mono max-w-[220px]">
          Sin proyecto activo. Crea o selecciona un proyecto en la barra de pestañas para explorar sus archivos.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Barra superior */}
      <div className="flex items-center gap-1 px-2 py-1 border-b border-[#004466] bg-[#00243e] shrink-0">
        <code className="flex-1 text-[10px] text-[#ffff55] font-mono truncate" title={projectPath}>
          {projectPath.split(/[\\/]/).slice(-2).join('/')}
        </code>
        <span className="text-[10px] text-[#00ffff]/50 font-mono">{files.length}</span>
        <button
          onClick={load}
          className="p-1 text-[#00ffff] hover:bg-[#0000aa] rounded"
          title="Refrescar"
        >
          {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
        </button>
      </div>

      {/* Contenido: árbol + previsualización */}
      <div className="flex-1 min-h-0 flex flex-col md:flex-row overflow-hidden">
        <div className={`overflow-y-auto py-1 ${selected ? 'md:w-1/2 border-b md:border-b-0 md:border-r border-[#004466]' : 'flex-1'}`}>
          {loading && files.length === 0 ? (
            <div className="flex items-center justify-center py-6 text-[#00ffff]/60 text-[11px] font-mono gap-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Leyendo proyecto...
            </div>
          ) : error ? (
            <div className="p-3 text-[11px] text-[#ff5555] font-mono">⚠️ {error}</div>
          ) : (
            tree.children.map((node) => (
              <FileRow key={node.path} node={node} depth={0} selected={selected} onSelect={(n) => openFile(n.path)} />
            ))
          )}
        </div>

        {selected && (
          <div className="flex-1 min-h-0 flex flex-col bg-[#000d1a]">
            <div className="flex items-center justify-between px-2 py-1 border-b border-[#004466] bg-[#00243e] shrink-0">
              <span className="text-[10px] text-[#00ffff] font-mono truncate">{selected}</span>
              <button onClick={() => { setSelected(null); setContent(''); }} className="text-[#00ffff] hover:text-white">
                <X className="w-3 h-3" />
              </button>
            </div>
            <div className="flex-1 overflow-auto p-2">
              {contentLoading ? (
                <div className="flex items-center gap-2 text-[11px] text-[#00ffff]/60 font-mono">
                  <Loader2 className="w-3 h-3 animate-spin" /> Cargando...
                </div>
              ) : (
                <pre className="text-[10.5px] leading-relaxed font-mono text-[#00ffff]/90 whitespace-pre-wrap break-all">
                  {content}
                </pre>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default FileTreeView;
