import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { PageViewport } from "pdfjs-dist";
import type { EditResponse, FontInfo, GlyphInfo } from "../types";
import { cssFontFamily, toViewRect, unionBox } from "../pdf";
import CheckSummary from "./CheckSummary";

interface Props {
  viewport: PageViewport;
  glyphs: GlyphInfo[];
  ids: number[];
  font: FontInfo | undefined;
  initial: string;
  preview: EditResponse | null;
  previewError: string | null;
  checking: boolean;
  onChange: (text: string) => void;
  onApply: (text: string) => void;
  onCancel: () => void;
}

export default function InlineEditor({ viewport, glyphs, ids, font, initial, preview, previewError, checking, onChange, onApply, onCancel }: Props) {
  const [text, setText] = useState(initial);
  const inputRef = useRef<HTMLInputElement>(null);
  const rect = toViewRect(viewport, unionBox(glyphs, ids));
  const g = glyphs[ids[0]];
  const fontPx = g.s * viewport.scale;

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  useEffect(() => {
    onChange(text);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  return (
    <div className="inline-editor" style={{ left: rect.left - 4, top: rect.top - 4 }} onClick={(e) => e.stopPropagation()}>
      <input
        ref={inputRef}
        value={text}
        spellCheck={false}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onApply(text);
          if (e.key === "Escape") onCancel();
        }}
        style={{
          fontSize: fontPx,
          height: Math.max(rect.height, fontPx * 1.25) + 8,
          minWidth: rect.width + 8,
          width: `calc(${Math.max(text.length, 3)}ch + 24px)`,
          fontFamily: cssFontFamily(font?.name ?? ""),
          fontWeight: font?.bold ? 700 : 400,
          fontStyle: font?.italic ? "italic" : "normal",
          color: g.col,
        }}
      />
      {createPortal(
      <div className="edit-dock" onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.preventDefault()}>
        <span className="dock-label">Editing</span>
        <CheckSummary preview={preview} error={previewError} checking={checking} compact />
        <div className="inline-actions">
          <span className="kbd-hint">Enter to apply · Esc to cancel</span>
          <button className="btn small" onClick={onCancel}>Cancel</button>
          <button className="btn small primary" disabled={!!previewError} onClick={() => onApply(text)}>Apply</button>
        </div>
      </div>, document.body)}
    </div>
  );
}
