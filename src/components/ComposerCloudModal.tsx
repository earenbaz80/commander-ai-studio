import React, { useState, useEffect } from 'react';
import { ProjectFile } from './ComposerPlayground';
import { 
  auth, 
  ComposerCloudProject, 
  saveComposerProject, 
  fetchUserComposerProjects, 
  fetchPublicComposerProjects, 
  deleteComposerProject 
} from '../lib/firebase';
import { 
  Cloud, 
  UploadCloud, 
  X, 
  Trash2, 
  FolderOpen, 
  Globe, 
  Lock, 
  RefreshCw, 
  Check, 
  FileCode, 
  Share2 
} from 'lucide-react';
import { Language } from '../i18n/translations';

interface ComposerCloudModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentFiles: ProjectFile[];
  selectedModel: string;
  onLoadProject: (files: ProjectFile[], projectName: string) => void;
  lang?: Language;
}

export const ComposerCloudModal: React.FC<ComposerCloudModalProps> = ({
  isOpen,
  onClose,
  currentFiles,
  selectedModel,
  onLoadProject,
  lang = 'es',
}) => {
  const [activeTab, setActiveTab] = useState<'save' | 'my_projects' | 'community'>('save');
  const [projectName, setProjectName] = useState('Mi Proyecto Nativo Commander');
  const [description, setDescription] = useState('Aplicación multi-archivo creada con Commander Composer');
  const [isPublic, setIsPublic] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoadingList, setIsLoadingList] = useState(false);
  const [userProjects, setUserProjects] = useState<ComposerCloudProject[]>([]);
  const [publicProjects, setPublicProjects] = useState<ComposerCloudProject[]>([]);
  const [successMsg, setSuccessMsg] = useState('');

  const currentUser = auth.currentUser;

  const loadProjects = async () => {
    setIsLoadingList(true);
    try {
      if (currentUser) {
        const userProjs = await fetchUserComposerProjects(currentUser.uid);
        setUserProjects(userProjs);
      }
      const pubProjs = await fetchPublicComposerProjects();
      setPublicProjects(pubProjs);
    } catch (err: any) {
      console.error('Error fetching cloud projects:', err);
    } finally {
      setIsLoadingList(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadProjects();
    }
  }, [isOpen, currentUser]);

  if (!isOpen) return null;

  const handleSaveToCloud = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser) {
      alert(lang === 'es' ? 'Debes iniciar sesión para guardar en la nube.' : lang === 'de' ? 'Bitte melde dich an, um in der Cloud zu speichern.' : 'Please sign in to save to cloud.');
      return;
    }
    if (!projectName.trim()) {
      alert(lang === 'es' ? 'Ingresa un nombre para el proyecto.' : lang === 'de' ? 'Gib einen Projektnamen ein.' : 'Enter a project name.');
      return;
    }

    setIsSaving(true);
    try {
      const filesToSave = currentFiles.map((f) => ({
        name: f.name,
        content: f.proposedContent !== undefined ? f.proposedContent : f.originalContent,
      }));

      await saveComposerProject({
        name: projectName.trim(),
        description: description.trim(),
        files: filesToSave,
        selectedModel,
        isPublic,
      });

      setSuccessMsg(lang === 'es' ? '✓ ¡Proyecto sincronizado exitosamente con Firestore!' : lang === 'de' ? '✓ Projekt erfolgreich mit Firestore synchronisiert!' : '✓ Project synced to Firestore successfully!');
      await loadProjects();
      setTimeout(() => {
        setSuccessMsg('');
        setActiveTab('my_projects');
      }, 1500);
    } catch (err: any) {
      alert((lang === 'es' ? 'Error al guardar en la nube: ' : lang === 'de' ? 'Fehler beim Speichern in der Cloud: ' : 'Error saving to cloud: ') + err.message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (projId: string, name: string) => {
    if (confirm(lang === 'es' ? `¿Eliminar "${name}" de Firestore?` : lang === 'de' ? `"${name}" aus Firestore löschen?` : `Delete "${name}" from Firestore?`)) {
      try {
        await deleteComposerProject(projId);
        setUserProjects((prev) => prev.filter((p) => p.id !== projId));
      } catch (err: any) {
        alert('Error: ' + err.message);
      }
    }
  };

  const handleOpenProject = (proj: ComposerCloudProject) => {
    if (confirm(lang === 'es' ? `¿Cargar el proyecto "${proj.name}" en el Composer? Se sobreescribirá el espacio actual.` : lang === 'de' ? `Projekt "${proj.name}" in den Composer laden? Der aktuelle Arbeitsbereich wird überschrieben.` : `Load "${proj.name}" into workspace? Current files will be replaced.`)) {
      const formatted: ProjectFile[] = proj.files.map((f) => ({
        name: f.name,
        originalContent: f.content,
      }));
      onLoadProject(formatted, proj.name);
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-4 font-mono select-none">
      <div className="w-full max-w-4xl bg-[#000080] border-4 border-[#00ffff] shadow-[8px_8px_0px_#000000] flex flex-col max-h-[85vh] overflow-hidden text-xs text-white">
        {/* Header */}
        <div className="bg-[#00aaaa] text-black px-3 py-1.5 font-bold flex items-center justify-between border-b-2 border-black shrink-0">
          <div className="flex items-center gap-2">
            <Cloud className="w-5 h-5 text-black" />
            <span className="text-sm uppercase tracking-wider">
              {lang === 'es' ? 'GESTIÓN Y SINCRONIZACIÓN EN LA NUBE (FIRESTORE)' : lang === 'de' ? 'CLOUD-WORKSPACE-SYNC (FIRESTORE)' : 'CLOUD WORKSPACE SYNC (FIRESTORE)'}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="nc-button !py-0.5 !px-2 bg-red-600 text-white hover:bg-red-500 font-bold"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="bg-[#000055] p-1.5 flex gap-1 border-b-2 border-[#00ffff] shrink-0">
          <button
            type="button"
            onClick={() => setActiveTab('save')}
            className={`px-3 py-1 text-xs font-bold border flex items-center gap-1.5 ${
              activeTab === 'save'
                ? 'bg-[#ffff55] text-black border-white'
                : 'bg-[#0000aa] text-[#00ffff] border-[#00aaaa] hover:bg-[#000080]'
            }`}
          >
            <UploadCloud className="w-4 h-4" />
            <span>{lang === 'es' ? 'GUARDAR PROYECTO ACTUAL' : lang === 'de' ? 'AKTUELLES PROJEKT SPEICHERN' : 'SAVE CURRENT PROJECT'}</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveTab('my_projects');
              loadProjects();
            }}
            className={`px-3 py-1 text-xs font-bold border flex items-center gap-1.5 ${
              activeTab === 'my_projects'
                ? 'bg-[#ffff55] text-black border-white'
                : 'bg-[#0000aa] text-[#00ffff] border-[#00aaaa] hover:bg-[#000080]'
            }`}
          >
            <FolderOpen className="w-4 h-4" />
            <span>{lang === 'es' ? `MIS PROYECTOS (${userProjects.length})` : lang === 'de' ? `MEINE PROJEKTE (${userProjects.length})` : `MY PROJECTS (${userProjects.length})`}</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveTab('community');
              loadProjects();
            }}
            className={`px-3 py-1 text-xs font-bold border flex items-center gap-1.5 ${
              activeTab === 'community'
                ? 'bg-[#ffff55] text-black border-white'
                : 'bg-[#0000aa] text-[#00ffff] border-[#00aaaa] hover:bg-[#000080]'
            }`}
          >
            <Globe className="w-4 h-4" />
            <span>{lang === 'es' ? `COMUNIDAD / GALERÍA (${publicProjects.length})` : lang === 'de' ? `COMMUNITY / GALERIE (${publicProjects.length})` : `COMMUNITY (${publicProjects.length})`}</span>
          </button>
        </div>

        {/* Tab Content */}
        <div className="flex-1 overflow-y-auto p-3 min-h-0">
          {activeTab === 'save' && (
            <form onSubmit={handleSaveToCloud} className="space-y-3 max-w-2xl mx-auto bg-[#0000aa] border-2 border-[#00ffff] p-4 shadow">
              {!currentUser && (
                <div className="bg-[#ff3333] text-white p-2 border border-black font-bold text-xs flex items-center gap-2">
                  <Lock className="w-4 h-4" />
                  <span>
                    {lang === 'es'
                      ? 'Inicia sesión primero desde el botón de usuario en la esquina superior para habilitar el guardado.'
                      : lang === 'de' ? 'Melde dich über die Benutzerschaltfläche oben im Header an, um das Speichern in der Cloud zu aktivieren.' : 'Please sign in from the top header user button to enable cloud saving.'}
                  </span>
                </div>
              )}

              <div>
                <label className="block text-[#ffff55] font-bold mb-1">
                  {lang === 'es' ? 'Nombre del Proyecto:' : lang === 'de' ? 'Projektname:' : 'Project Name:'}
                </label>
                <input
                  type="text"
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  className="w-full bg-[#000080] border border-[#00ffff] p-2 text-white outline-none"
                  required
                />
              </div>

              <div>
                <label className="block text-[#ffff55] font-bold mb-1">
                  {lang === 'es' ? 'Descripción o Notas de Versión:' : lang === 'de' ? 'Beschreibung:' : 'Description:'}
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full bg-[#000080] border border-[#00ffff] p-2 text-white outline-none h-16 resize-none"
                />
              </div>

              <div className="flex items-center gap-2 bg-[#000055] p-2 border border-[#00aaaa]">
                <input
                  type="checkbox"
                  id="pubCheck"
                  checked={isPublic}
                  onChange={(e) => setIsPublic(e.target.checked)}
                  className="w-4 h-4 accent-[#00ffff]"
                />
                <label htmlFor="pubCheck" className="text-white cursor-pointer select-none">
                  {lang === 'es' ? 'Hacer público en la galería de la comunidad (otros usuarios podrán clonarlo)' : lang === 'de' ? 'In der Community-Galerie veröffentlichen' : 'Make public in community gallery'}
                </label>
              </div>

              <div className="bg-[#000080] border border-[#00aaaa] p-2 text-[11px] space-y-1">
                <div className="text-[#ffff55] font-bold">
                  {lang === 'es' ? 'Archivos que se sincronizarán (' : lang === 'de' ? 'Zu synchronisierende Dateien (' : 'Files to sync ('}{currentFiles.length}):
                </div>
                <div className="flex flex-wrap gap-1">
                  {currentFiles.map((f) => (
                    <span key={f.name} className="bg-[#000055] text-[#00ffff] px-1.5 py-0.5 border border-[#00ffff] text-[10px]">
                      {f.name}
                    </span>
                  ))}
                </div>
              </div>

              {successMsg && (
                <div className="bg-[#004400] text-[#00ff66] border border-[#00ff66] p-2 font-bold flex items-center gap-1.5">
                  <Check className="w-4 h-4" />
                  <span>{successMsg}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={isSaving || !currentUser}
                className="w-full bg-[#00ffff] text-black font-bold py-2 text-xs hover:bg-white transition-colors disabled:opacity-50 flex items-center justify-center gap-2 border border-black shadow"
              >
                {isSaving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <UploadCloud className="w-4 h-4" />}
                <span>
                  {isSaving ? (lang === 'es' ? 'SINCRONIZANDO CON FIRESTORE...' : lang === 'de' ? 'SYNCHRONISIERE MIT FIRESTORE...' : 'SYNCING TO FIRESTORE...') : (lang === 'es' ? 'GUARDAR EN LA NUBE' : lang === 'de' ? 'IN DIE CLOUD SPEICHERN' : 'SAVE TO CLOUD')}
                </span>
              </button>
            </form>
          )}

          {activeTab === 'my_projects' && (
            <div className="space-y-2">
              {isLoadingList ? (
                <div className="text-center p-8 text-[#00ffff]">
                  <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2" />
                  <span>{lang === 'es' ? 'Cargando proyectos desde Firestore...' : lang === 'de' ? 'Projekte werden aus Firestore geladen...' : 'Loading projects from Firestore...'}</span>
                </div>
              ) : !currentUser ? (
                <div className="text-center p-8 text-[#ffff55] bg-[#0000aa] border border-[#00ffff]">
                  {lang === 'es' ? 'Inicia sesión para ver y gestionar tus proyectos guardados.' : lang === 'de' ? 'Bitte melde dich an, um deine Projekte zu sehen.' : 'Please sign in to view your projects.'}
                </div>
              ) : userProjects.length === 0 ? (
                <div className="text-center p-8 text-[#00aaaa] bg-[#0000aa] border border-[#00ffff]">
                  {lang === 'es' ? 'Aún no tienes proyectos guardados en la nube.' : lang === 'de' ? 'Keine gespeicherten Projekte in der Cloud gefunden.' : 'No saved projects found in cloud.'}
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {userProjects.map((proj) => (
                    <div key={proj.id} className="bg-[#0000aa] border-2 border-[#00ffff] p-3 flex flex-col justify-between gap-2 shadow">
                      <div>
                        <div className="flex items-start justify-between gap-1">
                          <h3 className="font-bold text-sm text-[#ffff55] truncate">{proj.name}</h3>
                          <span className={`text-[9px] px-1 py-0.2 border font-bold ${proj.isPublic ? 'bg-[#004400] text-[#55ff55] border-[#55ff55]' : 'bg-[#555500] text-[#ffff55] border-[#ffff55]'}`}>
                            {proj.isPublic ? 'PÚBLICO' : 'PRIVADO'}
                          </span>
                        </div>
                        {proj.description && <p className="text-[11px] text-[#a8c7fa] mt-1 line-clamp-2">{proj.description}</p>}
                        
                        <div className="flex items-center gap-2 mt-2 text-[10px] text-[#00ffff]">
                          <span className="flex items-center gap-1">
                            <FileCode className="w-3 h-3" /> {proj.files.length} archivos
                          </span>
                          <span>•</span>
                          <span>{new Date(proj.updatedAt).toLocaleDateString()}</span>
                        </div>
                      </div>

                      <div className="flex gap-1 border-t border-[#000055] pt-2">
                        <button
                          type="button"
                          onClick={() => handleOpenProject(proj)}
                          className="flex-1 bg-[#ffff55] text-black hover:bg-white font-bold py-1 px-2 text-[10px] flex items-center justify-center gap-1 border border-black shadow"
                        >
                          <FolderOpen className="w-3.5 h-3.5" />
                          <span>{lang === 'es' ? 'ABRIR EN COMPOSER' : lang === 'de' ? 'IM COMPOSER ÖFFNEN' : 'OPEN IN COMPOSER'}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(proj.id, proj.name)}
                          className="bg-red-700 text-white hover:bg-red-600 p-1 px-2 border border-black"
                          title="Eliminar proyecto"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === 'community' && (
            <div className="space-y-2">
              {isLoadingList ? (
                <div className="text-center p-8 text-[#00ffff]">
                  <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2" />
                  <span>{lang === 'es' ? 'Cargando proyectos de la comunidad...' : lang === 'de' ? 'Community-Projekte werden geladen...' : 'Loading community projects...'}</span>
                </div>
              ) : publicProjects.length === 0 ? (
                <div className="text-center p-8 text-[#00aaaa] bg-[#0000aa] border border-[#00ffff]">
                  {lang === 'es' ? 'No hay proyectos públicos compartidos todavía.' : lang === 'de' ? 'Noch keine öffentlichen Projekte geteilt.' : 'No public projects shared yet.'}
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {publicProjects.map((proj) => (
                    <div key={proj.id} className="bg-[#0000aa] border-2 border-[#00ffff] p-3 flex flex-col justify-between gap-2 shadow">
                      <div>
                        <div className="flex items-start justify-between gap-1">
                          <h3 className="font-bold text-sm text-[#ffff55] truncate">{proj.name}</h3>
                          <span className="text-[9px] bg-[#004400] text-[#55ff55] border border-[#55ff55] px-1 font-bold">
                            GALERÍA
                          </span>
                        </div>
                        {proj.description && <p className="text-[11px] text-[#a8c7fa] mt-1 line-clamp-2">{proj.description}</p>}
                        
                        <div className="flex items-center gap-2 mt-2 text-[10px] text-[#00ffff]">
                          <span>Autor: {proj.authorName}</span>
                          <span>•</span>
                          <span>{proj.files.length} archivos</span>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleOpenProject(proj)}
                        className="w-full bg-[#00ff66] text-black hover:bg-white font-bold py-1 px-2 text-[10px] flex items-center justify-center gap-1 border border-black shadow"
                      >
                        <Share2 className="w-3.5 h-3.5" />
                        <span>{lang === 'es' ? 'CLONAR / ABRIR EN COMPOSER' : lang === 'de' ? 'KLONEN / IM COMPOSER ÖFFNEN' : 'CLONE / OPEN IN COMPOSER'}</span>
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="bg-[#000080] border-t-2 border-[#00ffff] p-2 flex items-center justify-between shrink-0">
          <span className="text-[10px] text-[#a8c7fa]">
            {lang === 'es'
              ? '☁️ Sincronización en la nube con Firestore y autenticación con roles y reglas de seguridad.'
              : lang === 'de' ? '☁️ Cloud-Synchronisation mit Firestore und rollenbasierten Sicherheitsregeln.' : '☁️ Cloud synchronization with Firestore and role-based security rules.'}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="nc-button !py-1 !px-3 font-bold"
          >
            {lang === 'es' ? 'CERRAR' : lang === 'de' ? 'SCHLIESSEN' : 'CLOSE'}
          </button>
        </div>
      </div>
    </div>
  );
};
