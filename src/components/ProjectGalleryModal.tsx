import React, { useState, useEffect } from 'react';
import { X, Search, Heart, FolderPlus, Sparkles, User, Tag, Share2, ArrowRight } from 'lucide-react';
import { 
  GalleryProject, 
  fetchPublicProjects, 
  fetchUserProjects, 
  saveProjectToGallery, 
  toggleProjectLike, 
  checkIsLiked,
  auth 
} from '../lib/firebase';
import { ParameterConfig } from '../types/studio';

export interface ProjectGalleryContentProps {
  onSelectProject: (project: GalleryProject) => void;
  onClose: () => void;
  currentPromptTitle: string;
  currentSystemInstruction: string;
  currentSelectedModel: string;
  parameters: ParameterConfig;
}

/** Contenido de la galería (pestañas internas + grid + publicación), sin el marco
 *  de modal. Lo usan ProjectGalleryModal y la Biblioteca unificada. */
export const ProjectGalleryContent: React.FC<ProjectGalleryContentProps> = ({
  onSelectProject,
  onClose,
  currentPromptTitle,
  currentSystemInstruction,
  currentSelectedModel,
  parameters,
}) => {
  const [activeTab, setActiveTab] = useState<'gallery' | 'my_projects' | 'publish'>('gallery');
  const [projects, setProjects] = useState<GalleryProject[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [userLikes, setUserLikes] = useState<Record<string, boolean>>({});

  // Publish form state
  const [pubTitle, setPubTitle] = useState(currentPromptTitle || '');
  const [pubDescription, setPubDescription] = useState('');
  const [pubTags, setPubTags] = useState('ia, prompt, commander');
  const [pubIsPublic, setPubIsPublic] = useState(true);
  const [pubStatus, setPubStatus] = useState<string | null>(null);

  useEffect(() => {
    setPubTitle(currentPromptTitle);
  }, [currentPromptTitle]);

  useEffect(() => {
    loadProjects();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  const loadProjects = async () => {
    setLoading(true);
    try {
      let data: GalleryProject[] = [];
      if (activeTab === 'gallery') {
        data = await fetchPublicProjects();
      } else if (activeTab === 'my_projects' && auth.currentUser) {
        data = await fetchUserProjects(auth.currentUser.uid);
      }
      setProjects(data);

      // Check likes status if user logged in
      if (auth.currentUser && data.length > 0) {
        const uid = auth.currentUser.uid;
        const likeEntries = await Promise.all(
          data.map(async (proj) => {
            const liked = await checkIsLiked(proj.id, uid);
            return [proj.id, liked] as const;
          })
        );
        setUserLikes(Object.fromEntries(likeEntries));
      }
    } catch (err) {
      console.error("Error loading gallery projects:", err);
    } finally {
      setLoading(false);
    }
  };

  // Search and Filter Logic
  const filteredProjects = projects.filter((p) => {
    const q = searchQuery.toLowerCase();
    const matchesSearch = 
      p.title.toLowerCase().includes(q) ||
      p.description.toLowerCase().includes(q) ||
      p.authorName.toLowerCase().includes(q) ||
      p.selectedModel.toLowerCase().includes(q) ||
      p.tags?.some((t) => t.toLowerCase().includes(q));

    const matchesTag = selectedTag ? p.tags?.includes(selectedTag) : true;

    return matchesSearch && matchesTag;
  });

  // Extract all unique tags
  const allTags = Array.from(new Set(projects.flatMap((p) => p.tags || []))).filter(Boolean);

  const handleLike = async (projectId: string) => {
    if (!auth.currentUser) {
      alert("Debes iniciar sesión para dar me gusta a los proyectos.");
      return;
    }
    const isLiked = !!userLikes[projectId];
    setUserLikes((prev) => ({ ...prev, [projectId]: !isLiked }));
    setProjects((prev) =>
      prev.map((p) => (p.id === projectId ? { ...p, likesCount: p.likesCount + (isLiked ? -1 : 1) } : p))
    );

    await toggleProjectLike(projectId, auth.currentUser.uid, isLiked);
  };

  const handlePublishSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!auth.currentUser) {
      setPubStatus('❌ Debes iniciar sesión para publicar en la galería.');
      return;
    }

    try {
      setLoading(true);
      setPubStatus('Publicando...');
      const tagsArray = pubTags.split(',').map((t) => t.trim()).filter(Boolean);

      await saveProjectToGallery({
        title: pubTitle || 'Proyecto Sin Título',
        description: pubDescription || 'Proyecto generado en Commander AI Studio',
        systemInstruction: currentSystemInstruction || '',
        defaultPrompt: 'Generado desde Norton Commander AI Studio',
        selectedModel: currentSelectedModel,
        provider: 'google',
        temperature: parameters.temperature,
        topP: parameters.topP,
        topK: parameters.topK,
        tags: tagsArray,
        authorId: auth.currentUser.uid,
        authorName: auth.currentUser.displayName || auth.currentUser.email || 'Anónimo',
        authorEmail: auth.currentUser.email || '',
        isPublic: pubIsPublic,
      });

      setPubStatus('✅ ¡Proyecto publicado exitosamente en la galería!');
      setTimeout(() => {
        setActiveTab('gallery');
        setPubStatus(null);
      }, 1200);
    } catch (err: any) {
      setPubStatus(`❌ Error al publicar: ${err.message || 'Inténtalo de nuevo'}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {/* Navigation Tabs */}
      <div className="flex items-center gap-2 p-2 bg-[#0000aa] border-b-2 border-[#00ffff] shrink-0">
        <button
          onClick={() => setActiveTab('gallery')}
          className={`nc-button flex items-center gap-1.5 text-xs ${activeTab === 'gallery' ? 'nc-active' : ''}`}
        >
          <Sparkles className="w-3.5 h-3.5" />
          <span>GALERÍA PÚBLICA</span>
        </button>
        <button
          onClick={() => setActiveTab('my_projects')}
          className={`nc-button flex items-center gap-1.5 text-xs ${activeTab === 'my_projects' ? 'nc-active' : ''}`}
        >
          <User className="w-3.5 h-3.5" />
          <span>MIS PROYECTOS</span>
        </button>
        <button
          onClick={() => setActiveTab('publish')}
          className={`nc-button flex items-center gap-1.5 text-xs ml-auto ${activeTab === 'publish' ? 'nc-active' : ''}`}
        >
          <FolderPlus className="w-3.5 h-3.5" />
          <span>PUBLICAR ACTUAL</span>
        </button>
      </div>

      {activeTab !== 'publish' ? (
        <div className="flex flex-col flex-1 overflow-hidden p-3 gap-3 min-h-0">
          {/* Search Bar & Tag Filter */}
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="flex-1 bg-[#0000aa] border-2 border-[#00ffff] flex items-center px-2 gap-2">
              <Search className="w-4 h-4 text-[#ffff55]" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Buscar por título, tag, autor, descripción o modelo..."
                className="w-full bg-transparent p-1.5 text-xs text-[#ffffff] outline-none font-mono placeholder-[#00ffff]/60"
              />
              {searchQuery && (
                <X className="w-4 h-4 text-[#00ffff] cursor-pointer" onClick={() => setSearchQuery('')} />
              )}
            </div>

            {allTags.length > 0 && (
              <div className="flex items-center gap-1 overflow-x-auto max-w-xs p-1 border border-[#00ffff] bg-[#0000aa]">
                <Tag className="w-3.5 h-3.5 text-[#ffff55] shrink-0" />
                <button
                  onClick={() => setSelectedTag(null)}
                  className={`text-[10px] px-1.5 py-0.5 font-mono ${selectedTag === null ? 'bg-[#ffff55] text-black font-bold' : 'text-[#00ffff]'}`}
                >
                  TODOS
                </button>
                {allTags.map((tag) => (
                  <button
                    key={tag}
                    onClick={() => setSelectedTag(selectedTag === tag ? null : tag)}
                    className={`text-[10px] px-1.5 py-0.5 font-mono shrink-0 ${selectedTag === tag ? 'bg-[#ffff55] text-black font-bold' : 'bg-[#000080] text-[#00ffff] border border-[#00ffff]'}`}
                  >
                    #{tag}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Gallery Grid / List */}
          <div className="flex-1 overflow-y-auto pr-1 grid grid-cols-1 md:grid-cols-2 gap-3 align-content-start nc-x-scroll">
            {loading ? (
              <div className="col-span-full h-40 flex items-center justify-center text-[#ffff55] font-mono text-sm">
                ⚡ CARGANDO GALERÍA DE COMANDOS...
              </div>
            ) : filteredProjects.length === 0 ? (
              <div className="col-span-full h-40 flex flex-col items-center justify-center text-[#00ffff] font-mono text-xs gap-2 border-2 border-dashed border-[#00ffff] p-4">
                <span>NO SE ENCONTRARON PROYECTOS PARA LA BÚSQUEDA.</span>
                {activeTab === 'my_projects' && !auth.currentUser && (
                  <span className="text-[#ffff55]">Debes iniciar sesión para ver tus proyectos guardados.</span>
                )}
              </div>
            ) : (
              filteredProjects.map((proj) => (
                <div
                  key={proj.id}
                  className="nc-panel p-3 flex flex-col justify-between border-2 border-[#00ffff] bg-[#0000aa] gap-2 hover:border-[#ffff55] transition-colors"
                >
                  <div>
                    <div className="flex items-start justify-between gap-2 border-b border-[#00ffff] pb-1.5">
                      <h3 className="font-bold text-[#ffff55] text-sm font-mono truncate">{proj.title}</h3>
                      <span className="bg-[#000080] text-[#00ffff] text-[10px] px-1.5 py-0.5 border border-[#00ffff] font-mono shrink-0">
                        {proj.selectedModel}
                      </span>
                    </div>

                    <p className="text-xs text-[#ffffff] font-mono my-2 line-clamp-2">
                      {proj.description || 'Sin descripción.'}
                    </p>

                    {proj.tags && proj.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 my-1">
                        {proj.tags.map((t) => (
                          <span key={t} className="text-[9px] text-[#00ffff] bg-[#000080] px-1 border border-[#00ffff]/60 font-mono">
                            #{t}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center justify-between border-t border-[#00ffff]/60 pt-2 text-[11px] font-mono text-[#00ffff]">
                    <span className="truncate">👤 {proj.authorName}</span>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => handleLike(proj.id)}
                        className={`flex items-center gap-1 nc-button text-[10px] py-0.5 px-1.5 ${userLikes[proj.id] ? 'bg-[#ffff55] text-black font-bold' : ''}`}
                      >
                        <Heart className={`w-3 h-3 ${userLikes[proj.id] ? 'fill-black' : ''}`} />
                        <span>{proj.likesCount || 0}</span>
                      </button>

                      <button
                        onClick={() => {
                          onSelectProject(proj);
                          onClose();
                        }}
                        className="nc-button text-[10px] py-0.5 px-2 bg-[#00aaaa] text-black font-bold flex items-center gap-1"
                      >
                        <span>CARGAR</span>
                        <ArrowRight className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      ) : (
        /* Publish Tab Form */
        <div className="flex-1 overflow-y-auto p-4 nc-x-scroll">
          <form onSubmit={handlePublishSubmit} className="max-w-xl mx-auto flex flex-col gap-4 bg-[#0000aa] p-4 border-2 border-[#00ffff]">
            <div className="text-sm font-bold text-[#ffff55] border-b-2 border-[#00ffff] pb-2 flex items-center gap-2">
              <FolderPlus className="w-5 h-5" />
              <span>PUBLICAR PROYECTO ACTUAL EN LA NUBE</span>
            </div>

            {pubStatus && (
              <div className="p-2 text-xs font-mono bg-[#000080] border border-[#00ffff] text-[#ffff55]">
                {pubStatus}
              </div>
            )}

            <div className="flex flex-col gap-1">
              <label className="text-xs text-[#00ffff] font-bold">TÍTULO DEL PROYECTO</label>
              <input
                type="text"
                required
                value={pubTitle}
                onChange={(e) => setPubTitle(e.target.value)}
                className="bg-[#000080] text-[#ffff55] p-2 text-xs border-2 border-[#00ffff] outline-none font-mono"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-xs text-[#00ffff] font-bold">DESCRIPCIÓN</label>
              <textarea
                rows={3}
                value={pubDescription}
                onChange={(e) => setPubDescription(e.target.value)}
                placeholder="Explica qué hace esta plantilla o instrucción de sistema..."
                className="bg-[#000080] text-white p-2 text-xs border-2 border-[#00ffff] outline-none font-mono resize-none"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-xs text-[#00ffff] font-bold">ETIQUETAS (SEPARADAS POR COMAS)</label>
              <input
                type="text"
                value={pubTags}
                onChange={(e) => setPubTags(e.target.value)}
                placeholder="ej. resumen, codigo, asistente, espanol"
                className="bg-[#000080] text-[#ffff55] p-2 text-xs border-2 border-[#00ffff] outline-none font-mono"
              />
            </div>

            <div className="flex items-center gap-2 border p-2 border-[#00ffff] bg-[#000080]">
              <input
                type="checkbox"
                id="pubIsPublic"
                checked={pubIsPublic}
                onChange={(e) => setPubIsPublic(e.target.checked)}
                className="accent-[#00ffff]"
              />
              <label htmlFor="pubIsPublic" className="text-xs text-white cursor-pointer font-mono">
                Hacer público en la galería comunitaria
              </label>
            </div>

            <div className="bg-[#000080] p-2 border border-[#00ffff]/60 text-[11px] font-mono text-[#00ffff]">
              ℹ️ Se guardará con el modelo actual: <span className="text-[#ffff55]">{currentSelectedModel}</span>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="nc-button py-2 text-xs font-bold flex items-center justify-center gap-2 bg-[#00aaaa] text-black"
            >
              <Share2 className="w-4 h-4" />
              <span>{loading ? 'GUARDANDO...' : 'GUARDAR Y PUBLICAR'}</span>
            </button>
          </form>
        </div>
      )}
    </>
  );
};

interface ProjectGalleryModalProps extends ProjectGalleryContentProps {
  isOpen: boolean;
}

export const ProjectGalleryModal: React.FC<ProjectGalleryModalProps> = ({
  isOpen,
  onClose,
  onSelectProject,
  currentPromptTitle,
  currentSystemInstruction,
  currentSelectedModel,
  parameters,
}) => {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4 cursor-pointer"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="nc-panel w-full max-w-4xl h-[85vh] flex flex-col border-2 border-[#00ffff] bg-[#000080] shadow-[10px_10px_0px_#000055] cursor-default"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Title Bar */}
        <div className="flex items-center justify-between nc-header p-2 shrink-0">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-black" />
            <span className="font-bold text-black tracking-wider">GALERÍA Y BÚSQUEDA DE PROYECTOS</span>
          </div>
          <button onClick={onClose} className="nc-button text-xs px-2 py-0.5">
            <X className="w-4 h-4" />
          </button>
        </div>

        <ProjectGalleryContent
          onSelectProject={onSelectProject}
          onClose={onClose}
          currentPromptTitle={currentPromptTitle}
          currentSystemInstruction={currentSystemInstruction}
          currentSelectedModel={currentSelectedModel}
          parameters={parameters}
        />
      </div>
    </div>
  );
};

export default ProjectGalleryModal;