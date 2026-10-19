/**
 * Ghost-text de autocompletado IA para CodeMirror 6 (P0 #2).
 *
 * `@codemirror/autocomplete` instalado no expone `inlineCompletion`, así que
 * implementamos la sugerencia con una decoración propia:
 *   • `setGhostSuggestion` (StateEffect) publica/limpia la sugerencia.
 *   • Un `StateField` la dibuja como widget e la invalida al editar/mover.
 *   • `Tab` acepta (inserta) y `Escape` descarta (con máxima precedencia).
 */
import { Prec, StateEffect, StateField, type EditorState } from '@codemirror/state';
import { Decoration, EditorView, WidgetType, keymap } from '@codemirror/view';

export interface GhostSuggestion {
  /** Posición del cursor donde se insertaría. */
  from: number;
  /** Texto sugerido (normalmente una sola línea). */
  text: string;
}

/** Efecto para publicar (`{from,text}`) o limpiar (`null`) la sugerencia. */
export const setGhostSuggestion = StateEffect.define<GhostSuggestion | null>();

class GhostWidget extends WidgetType {
  constructor(readonly text: string) {
    super();
  }

  eq(other: GhostWidget): boolean {
    return other.text === this.text;
  }

  toDOM(): HTMLElement {
    const span = document.createElement('span');
    span.className = 'cm-ai-ghost';
    span.textContent = this.text;
    span.setAttribute('aria-hidden', 'true');
    return span;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

const ghostField = StateField.define<GhostSuggestion | null>({
  create: () => null,
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setGhostSuggestion)) return effect.value;
    }
    // Cualquier edición o movimiento del cursor invalida la sugerencia.
    if (tr.docChanged || tr.selection) return null;
    return value;
  },
  provide: (field) =>
    EditorView.decorations.from(field, (value) => {
      if (!value || !value.text) return Decoration.none;
      const widget = Decoration.widget({ widget: new GhostWidget(value.text), side: 1 });
      return Decoration.set([widget.range(value.from)]);
    }),
});

/** Sugerencia activa (o null). */
export function ghostFieldValue(state: EditorState): GhostSuggestion | null {
  return state.field(ghostField, false) ?? null;
}

/** Inserta la sugerencia activa. Devuelve false si no había nada que aceptar. */
export function acceptGhost(view: EditorView): boolean {
  const suggestion = ghostFieldValue(view.state);
  if (!suggestion || !suggestion.text) return false;
  view.dispatch({
    changes: { from: suggestion.from, insert: suggestion.text },
    selection: { anchor: suggestion.from + suggestion.text.length },
    effects: setGhostSuggestion.of(null),
  });
  return true;
}

/** Descarta la sugerencia activa. Devuelve false si no había ninguna. */
export function dismissGhost(view: EditorView): boolean {
  if (!ghostFieldValue(view.state)) return false;
  view.dispatch({ effects: setGhostSuggestion.of(null) });
  return true;
}

/** Tab acepta; si no hay sugerencia, cae al `indentWithTab` normal. */
const ghostKeymap = Prec.highest(
  keymap.of([
    { key: 'Tab', run: (view) => acceptGhost(view) },
    { key: 'Escape', run: (view) => dismissGhost(view) },
  ])
);

/** Extensiones a registrar SIEMPRE (el disparo lo decide el llamador). */
export const ghostExtension = [ghostField, ghostKeymap];
