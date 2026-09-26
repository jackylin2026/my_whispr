import { history, historyKeymap, standardKeymap } from "@codemirror/commands";
import { MergeView } from "@codemirror/merge";
import { Annotation, EditorState, StateEffect, StateField, Transaction } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  keymap,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { compareTranscriptWords } from "../../shared/transcript-comparison";

export interface PracticeTranscriptComparisonHandle {
  getCorrectedTranscript(): string;
  scrollToFirstChange(): number;
  refreshLayout(): void;
}

interface Props {
  rawTranscript: string;
  correctedTranscript: string;
  onChange(text: string): void;
}

const setComparisonDecorations = StateEffect.define<DecorationSet>();
const externalDocumentUpdate = Annotation.define<boolean>();
const comparisonDecorations = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update: (decorations, transaction) => {
    let next = decorations.map(transaction.changes);
    for (const effect of transaction.effects) {
      if (effect.is(setComparisonDecorations)) next = effect.value;
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});

const editorTheme = EditorView.theme({
  "&": { height: "100%", backgroundColor: "transparent" },
  ".cm-content": {
    padding: "14px 16px",
    fontFamily: "inherit",
    lineHeight: "1.65",
    caretColor: "var(--accent)",
  },
  ".cm-scroller": { fontFamily: "inherit", overflow: "visible" },
  ".cm-focused": { outline: "none" },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
    backgroundColor: "rgb(89 157 207 / 28%)",
  },
});

export const PracticeTranscriptComparison = forwardRef<
  PracticeTranscriptComparisonHandle,
  Props
>(function PracticeTranscriptComparison(
  { rawTranscript, correctedTranscript, onChange },
  forwardedRef,
) {
  const parent = useRef<HTMLDivElement>(null);
  const merge = useRef<MergeView | undefined>(undefined);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useImperativeHandle(forwardedRef, () => ({
    getCorrectedTranscript: () => merge.current?.b.state.doc.toString() ?? correctedTranscript,
    refreshLayout: () => {
      merge.current?.a.requestMeasure();
      merge.current?.b.requestMeasure();
    },
    scrollToFirstChange: () => {
      const current = merge.current;
      if (!current) return 0;
      const changes = compareTranscriptWords(
        current.a.state.doc.toString(),
        current.b.state.doc.toString(),
      );
      const first = changes[0];
      if (first) {
        const view = first.corrected ? current.b : current.a;
        const position = first.corrected?.from ?? first.raw?.from ?? 0;
        view.dispatch({ effects: EditorView.scrollIntoView(position, { y: "center" }) });
      }
      return changes.length;
    },
  }), [correctedTranscript]);

  useEffect(() => {
    if (!parent.current) return;
    let destroyed = false;
    let refreshQueued = false;
    const queueRefresh = (): void => {
      if (refreshQueued) return;
      refreshQueued = true;
      queueMicrotask(() => {
        refreshQueued = false;
        if (!destroyed) refreshDecorations(view);
      });
    };
    const correctedUpdate = (update: ViewUpdate): void => {
      if (!update.docChanged) return;
      if (!update.transactions.some((transaction) => transaction.annotation(externalDocumentUpdate))) {
        onChangeRef.current(update.state.doc.toString());
      }
      queueRefresh();
    };
    const view = new MergeView({
      parent: parent.current,
      a: {
        doc: rawTranscript,
        extensions: [
          EditorState.readOnly.of(true),
          EditorView.editable.of(false),
          EditorView.contentAttributes.of({ "aria-label": "Raw Transcript" }),
          EditorView.lineWrapping,
          editorTheme,
          comparisonDecorations,
        ],
      },
      b: {
        doc: correctedTranscript,
        extensions: [
          EditorView.contentAttributes.of({ "aria-label": "Corrected Transcript" }),
          EditorView.lineWrapping,
          editorTheme,
          comparisonDecorations,
          history(),
          keymap.of([...standardKeymap, ...historyKeymap]),
          EditorView.updateListener.of(correctedUpdate),
        ],
      },
      orientation: "a-b",
      highlightChanges: false,
      gutter: false,
    });
    merge.current = view;
    refreshDecorations(view);
    return () => {
      destroyed = true;
      merge.current = undefined;
      view.destroy();
    };
  }, []);

  useEffect(() => {
    const view = merge.current;
    if (!view) return;
    replaceDocument(view.a, rawTranscript);
    replaceDocument(view.b, correctedTranscript);
    refreshDecorations(view);
  }, [rawTranscript, correctedTranscript]);

  return <div className="practice-merge-editor" ref={parent} />;
});

function replaceDocument(view: EditorView, text: string): void {
  if (view.state.doc.toString() === text) return;
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: text },
    annotations: [Transaction.addToHistory.of(false), externalDocumentUpdate.of(true)],
  });
}

function refreshDecorations(view: MergeView): void {
  const changes = compareTranscriptWords(
    view.a.state.doc.toString(),
    view.b.state.doc.toString(),
  );
  const removed = Decoration.mark({ class: "cm-transcript-removed" });
  const added = Decoration.mark({ class: "cm-transcript-added" });
  const rawRanges = changes.flatMap((change) =>
    change.raw ? [removed.range(change.raw.from, change.raw.to)] : [],
  );
  const correctedRanges = changes.flatMap((change) =>
    change.corrected ? [added.range(change.corrected.from, change.corrected.to)] : [],
  );
  view.a.dispatch({
    effects: setComparisonDecorations.of(Decoration.set(rawRanges, true)),
  });
  view.b.dispatch({
    effects: setComparisonDecorations.of(Decoration.set(correctedRanges, true)),
  });
}
