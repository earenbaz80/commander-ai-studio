import type { Language } from '../i18n/translations';
import React, { useState, useCallback, useRef } from 'react';
import {
  GripVertical,
  Trash2,
  Edit2,
  X,
  ChevronUp,
  ChevronDown,
  Plus,
  Save,
  ListTodo,
} from 'lucide-react';

export interface PlanItem {
  id: string;
  text: string;
  done: boolean;
  subItems?: PlanSubItem[];
}

export interface PlanSubItem {
  id: string;
  text: string;
  done: boolean;
}

interface PlanEditorProps {
  plan: PlanItem[];
  onPlanChange: (plan: PlanItem[]) => void;
  isRunning: boolean;
  lang: Language;
}

const PlanEditor: React.FC<PlanEditorProps> = ({ 
  plan, 
  onPlanChange, 
  isRunning, 
  lang 
}) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const t = {
    addStep: lang === 'es' ? 'Agregar paso' : lang === 'de' ? 'Schritt hinzufügen' : 'Add step',
    editStep: lang === 'es' ? 'Editar paso' : lang === 'de' ? 'Schritt bearbeiten' : 'Edit step',
    deleteStep: lang === 'es' ? 'Eliminar paso' : lang === 'de' ? 'Schritt löschen' : 'Delete step',
    moveUp: lang === 'es' ? 'Mover arriba' : lang === 'de' ? 'Nach oben' : 'Move up',
    moveDown: lang === 'es' ? 'Mover abajo' : lang === 'de' ? 'Nach unten' : 'Move down',
    addSubtask: lang === 'es' ? 'Agregar subtarea' : lang === 'de' ? 'Teilaufgabe hinzufügen' : 'Add subtask',
    expand: lang === 'es' ? 'Expandir' : lang === 'de' ? 'Aufklappen' : 'Expand',
    collapse: lang === 'es' ? 'Colapsar' : lang === 'de' ? 'Zuklappen' : 'Collapse',
    noPlan: lang === 'es' ? 'Sin plan aún. Agrega tu primer paso.' : lang === 'de' ? 'Noch kein Plan. Füge deinen ersten Schritt hinzu.' : 'No plan yet. Add your first step.',
    dragHint: lang === 'es' ? 'Arrastra para reordenar' : lang === 'de' ? 'Zum Sortieren ziehen' : 'Drag to reorder',
  };

  const handleAddStep = useCallback(() => {
    const newItem: PlanItem = {
      id: `plan_${Date.now()}`,
      text: '',
      done: false,
      subItems: [],
    };
    const newPlan = [...plan, newItem];
    onPlanChange(newPlan);
    setEditingId(newItem.id);
  }, [plan, onPlanChange]);

  const handleDeleteStep = useCallback((id: string) => {
    const newPlan = plan.filter(item => item.id !== id);
    onPlanChange(newPlan);
  }, [plan, onPlanChange]);

  const handleMoveUp = useCallback((index: number) => {
    if (index === 0) return;
    const newPlan = [...plan];
    [newPlan[index], newPlan[index - 1]] = [newPlan[index - 1], newPlan[index]];
    onPlanChange(newPlan);
  }, [plan, onPlanChange]);

  const handleMoveDown = useCallback((index: number) => {
    if (index === plan.length - 1) return;
    const newPlan = [...plan];
    [newPlan[index], newPlan[index + 1]] = [newPlan[index + 1], newPlan[index]];
    onPlanChange(newPlan);
  }, [plan, onPlanChange]);

  /** Reordena moviendo el elemento de `from` a la posición `to`. */
  const handleReorder = useCallback((from: number, to: number) => {
    if (from === to || from < 0 || to < 0 || from >= plan.length || to >= plan.length) return;
    const newPlan = [...plan];
    const [moved] = newPlan.splice(from, 1);
    newPlan.splice(to, 0, moved);
    onPlanChange(newPlan);
  }, [plan, onPlanChange]);

  const handleToggleDone = useCallback((id: string) => {
    const newPlan = plan.map(item => 
      item.id === id ? { ...item, done: !item.done } : item
    );
    onPlanChange(newPlan);
  }, [plan, onPlanChange]);

  const handleTextChange = useCallback((id: string, text: string) => {
    const newPlan = plan.map(item => 
      item.id === id ? { ...item, text } : item
    );
    onPlanChange(newPlan);
  }, [plan, onPlanChange]);

  const handleAddSubtask = useCallback((parentId: string) => {
    const newPlan = plan.map(item => {
      if (item.id === parentId) {
        return {
          ...item,
          subItems: [...(item.subItems || []), {
            id: `sub_${Date.now()}`,
            text: '',
            done: false,
          }]
        };
      }
      return item;
    });
    onPlanChange(newPlan);
  }, [plan, onPlanChange]);

  const handleSubtaskChange = useCallback((parentId: string, subId: string, text: string) => {
    const newPlan = plan.map(item => {
      if (item.id === parentId) {
        return {
          ...item,
          subItems: item.subItems?.map(sub => 
            sub.id === subId ? { ...sub, text } : sub
          ) || []
        };
      }
      return item;
    });
    onPlanChange(newPlan);
  }, [plan, onPlanChange]);

  const handleSubtaskDone = useCallback((parentId: string, subId: string) => {
    const newPlan = plan.map(item => {
      if (item.id === parentId) {
        return {
          ...item,
          subItems: item.subItems?.map(sub => 
            sub.id === subId ? { ...sub, done: !sub.done } : sub
          ) || []
        };
      }
      return item;
    });
    onPlanChange(newPlan);
  }, [plan, onPlanChange]);

  const handleDeleteSubtask = useCallback((parentId: string, subId: string) => {
    const newPlan = plan.map(item => {
      if (item.id === parentId) {
        return {
          ...item,
          subItems: item.subItems?.filter(sub => sub.id !== subId) || []
        };
      }
      return item;
    });
    onPlanChange(newPlan);
  }, [plan, onPlanChange]);

  const toggleExpand = useCallback((id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const isExpanded = (id: string) => expandedIds.has(id);

  if (plan.length === 0 && !isRunning) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center text-[var(--nc-text)]/70 p-4">
        <div className="w-12 h-12 mb-2 border-2 border-[var(--nc-border-light)] rounded-full flex items-center justify-center">
          <span className="text-[var(--nc-text-accent)] text-xl">+</span>
        </div>
        <p className="text-xs text-[var(--nc-text)]/60 mb-4">{t.noPlan}</p>
        <button
          type="button"
          onClick={handleAddStep}
          disabled={isRunning}
          className="nc-button text-xs px-3 py-1.5 flex items-center gap-1.5"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>{t.addStep}</span>
        </button>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      <div className="flex items-center justify-between p-2.5 border-b-2 border-[var(--nc-border-light)]/20 bg-[#000028] shrink-0">
        <div className="flex items-center gap-1.5 text-[var(--nc-text-accent)] font-bold text-[11px]">
          <ListTodo className="w-4 h-4" />
          <span>{t.addStep}</span>
          <span className="text-[var(--nc-text)]/60 text-[10px]">({plan.length})</span>
        </div>
        <button
          type="button"
          onClick={handleAddStep}
          disabled={isRunning}
          className="nc-button text-[10px] px-2 py-1 flex items-center gap-1"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>{t.addStep}</span>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {plan.map((item, index) => (
          <PlanItemComponent
            key={item.id}
            item={item}
            index={index}
            isEditing={editingId === item.id}
            editText={editText}
            isExpanded={isExpanded(item.id)}
            isRunning={isRunning}
            onToggleExpand={() => toggleExpand(item.id)}
            onStartEdit={() => {
              setEditText(item.text);
              setEditingId(item.id);
            }}
            onSaveEdit={() => {
              setEditingId(null);
            }}
            onCancelEdit={() => {
              setEditText(item.text);
              setEditingId(null);
            }}
            onTextChange={handleTextChange}
            onToggleDone={() => handleToggleDone(item.id)}
            onDelete={() => handleDeleteStep(item.id)}
            onMoveUp={() => index > 0 && handleMoveUp(index)}
            onMoveDown={() => index < plan.length - 1 && handleMoveDown(index)}
            onAddSubtask={() => handleAddSubtask(item.id)}
            onSubtaskChange={handleSubtaskChange}
            onSubtaskDone={handleSubtaskDone}
            onDeleteSubtask={handleDeleteSubtask}
            onReorder={handleReorder}
            subItems={item.subItems || []}
            lang={lang}
          />
        ))}
      </div>
    </div>
  );
};

// Separate component for each plan item to handle drag-and-drop
const PlanItemComponent: React.FC<{
  item: PlanItem;
  index: number;
  isEditing: boolean;
  editText: string;
  isExpanded: boolean;
  isRunning: boolean;
  onToggleExpand: () => void;
  onStartEdit: () => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onTextChange: (id: string, text: string) => void;
  onToggleDone: () => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onAddSubtask: () => void;
  onSubtaskChange: (parentId: string, subId: string, text: string) => void;
  onSubtaskDone: (parentId: string, subId: string) => void;
  onDeleteSubtask: (parentId: string, subId: string) => void;
  onReorder: (from: number, to: number) => void;
  subItems: PlanSubItem[];
  lang: Language;
}> = ({
  item,
  index,
  isEditing,
  editText,
  isExpanded,
  isRunning,
  onToggleExpand,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  onTextChange,
  onToggleDone,
  onDelete,
  onMoveUp,
  onMoveDown,
  onAddSubtask,
  onSubtaskChange,
  onSubtaskDone,
  onDeleteSubtask,
  onReorder,
  subItems,
  lang,
}) => {
  const t = {
    edit: lang === 'es' ? 'Editar' : lang === 'de' ? 'Bearbeiten' : 'Edit',
    save: lang === 'es' ? 'Guardar' : lang === 'de' ? 'Speichern' : 'Save',
    cancel: lang === 'es' ? 'Cancelar' : lang === 'de' ? 'Abbrechen' : 'Cancel',
    delete: lang === 'es' ? 'Eliminar' : lang === 'de' ? 'Löschen' : 'Delete',
    addSubtask: lang === 'es' ? 'Agregar subtarea' : lang === 'de' ? 'Teilaufgabe hinzufügen' : 'Add subtask',
    expand: lang === 'es' ? 'Expandir' : lang === 'de' ? 'Aufklappen' : 'Expand',
    collapse: lang === 'es' ? 'Colapsar' : lang === 'de' ? 'Zuklappen' : 'Collapse',
    drag: lang === 'es' ? 'Arrastrar' : lang === 'de' ? 'Ziehen' : 'Drag',
  };

  // --- Drag & drop para reordenar pasos ---
  const dragIndexRef = useRef<number | null>(null);

  const handleDragStart = (e: React.DragEvent) => {
    dragIndexRef.current = index;
    e.dataTransfer.effectAllowed = 'move';
    // Firefox exige datos para que el drag empiece.
    e.dataTransfer.setData('text/plain', String(index));
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const from = dragIndexRef.current ?? Number(e.dataTransfer.getData('text/plain'));
    dragIndexRef.current = null;
    if (Number.isNaN(from)) return;
    // Señal de "insertar antes": el padre ajusta la posición final.
    const rect = e.currentTarget.getBoundingClientRect();
    const after = e.clientY > rect.top + rect.height / 2;
    onReorder(from, after ? index + 1 : index);
  };

  return (
    <div
      className="bg-[var(--nc-bg-main)]/40 border border-[var(--nc-border-light)]/30 rounded p-2 space-y-1.5"
      draggable={!isEditing && !isRunning}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* Main item row */}
      <div className="flex items-center gap-1.5">
        <span
          className="text-[var(--nc-text)]/40 cursor-grab active:cursor-grabbing select-none"
          title={t.drag}
          aria-hidden="true"
        >
          <GripVertical className="w-3.5 h-3.5" />
        </span>

        <input
          type="checkbox"
          checked={item.done}
          onChange={onToggleDone}
          disabled={isRunning}
          className="mt-0.5"
        />

        <div className="flex-1 min-w-0">
          {isEditing ? (
            <input
              type="text"
              value={editText}
              onChange={(e) => onTextChange(item.id, e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onSaveEdit();
                else if (e.key === 'Escape') onCancelEdit();
              }}
              className="w-full bg-[var(--nc-bg-deep)] text-white border border-[var(--nc-border-light)] px-2 py-1 text-xs font-mono outline-none"
              autoFocus
            />
          ) : (
            <span
              className={`text-[11px] text-white truncate block cursor-text ${item.done ? 'line-through text-[var(--nc-text)]/50' : ''}`}
              onDoubleClick={onStartEdit}
              title={isRunning ? undefined : t.edit}
            >
              {item.text || <span className="text-[var(--nc-text)]/40 italic">Sin título</span>}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1">
          {isEditing ? (
            <>
              <button
                type="button"
                onClick={onSaveEdit}
                className="text-[#00ff55] hover:text-[#00ff55]/80 p-0.5"
                title={t.save}
              >
                <Save className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={onCancelEdit}
                className="text-[var(--nc-danger)]/80 hover:text-[var(--nc-danger)] p-0.5"
                title={t.cancel}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={onStartEdit}
              disabled={isRunning}
              className="text-[var(--nc-text-accent)]/60 hover:text-[var(--nc-text-accent)] p-0.5 disabled:opacity-40"
              title={t.edit}
            >
              <Edit2 className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            type="button"
            onClick={onMoveUp}
            disabled={isRunning || index === 0}
            className="text-[var(--nc-text)]/60 hover:text-[var(--nc-text)] p-0.5 disabled:opacity-30"
            title="Mover arriba"
          >
            <ChevronUp className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={onMoveDown}
            disabled={isRunning}
            className="text-[var(--nc-text)]/60 hover:text-[var(--nc-text)] p-0.5 disabled:opacity-30"
            title="Mover abajo"
          >
            <ChevronDown className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={onDelete}
            disabled={isRunning}
            className="text-red-400/60 hover:text-red-400 p-0.5 disabled:opacity-40"
            title={t.delete}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
          {(subItems && subItems.length > 0) && (
            <button
              type="button"
              onClick={onToggleExpand}
              className="text-[var(--nc-text)]/60 hover:text-[var(--nc-text)] p-0.5"
              title={isExpanded ? t.collapse : t.expand}
            >
              <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} />
            </button>
          )}
        </div>
      </div>

      {/* Subtasks */}
      {isExpanded && (
        <div className="ml-6 border-l-2 border-[var(--nc-border-light)]/20 pl-3 space-y-1 mt-1">
          {subItems.map((sub) => (
            <div key={sub.id} className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={sub.done}
                onChange={() => onSubtaskDone(item.id, sub.id)}
                disabled={isRunning}
                className="mt-0.5 w-3.5 h-3.5"
              />
              <input
                type="text"
                value={sub.text}
                onChange={(e) => onSubtaskChange(item.id, sub.id, e.target.value)}
                disabled={isRunning}
                className={`flex-1 bg-transparent border-none outline-none text-[10px] ${sub.done ? 'line-through text-[var(--nc-text)]/50' : 'text-white/80'}`}
                placeholder={lang === 'es' ? 'Subtarea' : lang === 'de' ? 'Teilaufgabe' : 'Subtask'}
              />
              <button
                type="button"
                onClick={() => onDeleteSubtask(item.id, sub.id)}
                disabled={isRunning}
                className="text-red-400/50 hover:text-red-400 p-0.5 disabled:opacity-30"
                title={t.delete}
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={onAddSubtask}
            disabled={isRunning}
            className="text-[var(--nc-text)]/60 hover:text-[var(--nc-text)] text-[10px] px-2 py-1 flex items-center gap-1 disabled:opacity-40"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>{t.addSubtask}</span>
          </button>
        </div>
      )}
    </div>
  );
};

export default PlanEditor;