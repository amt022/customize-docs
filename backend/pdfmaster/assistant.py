"""AI document assistant: a chat that reads the PDF and makes changes through the
same verified engine the editor uses (every change is a new, undoable version).

Uses the Claude API with a manual tool loop so each tool call can be recorded
and reported back to the UI as an action.
"""
from __future__ import annotations

import json
import logging
import threading
import uuid
from typing import Any, Callable, Optional

import anthropic

from .engine.editor import Edit, EditError

log = logging.getLogger(__name__)

MODEL = "claude-opus-5-5"
MAX_STEPS = 16
MAX_PAGE_CHARS = 12000

SYSTEM = """You are the assistant inside PDF Master, an editor that changes the text of existing PDFs \
in place while keeping the original fonts, positions and layout. You help one user with the document \
that is open in the editor.

You can read the document and change it with the tools provided. Every change creates a new version \
that the user can undo, and each text change is verified by the editor (fonts, positions, pixels).

How to work:
- Read before you change: use search_text or read_page to find the exact text first. Never guess \
text you have not seen.
- To change every occurrence of something, use replace_text. To change one specific occurrence, \
use edit_line with the page and line number from read_page or search_text.
- Keep replacements the same kind of value the user asked for; do not reformat other text.
- Before deleting pages, or before a replacement that would change more than 25 places, tell the user \
what will happen and ask them to confirm, unless they already said to go ahead.
- After making changes, say briefly what you changed (page and old -> new) and mention any warnings \
the tools reported, such as text that no longer fits or a substituted font.
- Questions about the document (summaries, finding values, explanations, translations) are answered \
from the text you read; you do not need to change anything for those.
- Scanned pages are edited through their recognised text; if a page has no text yet, say that the \
user needs to run "Recognise text" on it first.
Answer in the user's language. Keep replies short and concrete."""


def _tool(name: str, description: str, props: dict, required: list[str]) -> dict:
    return {
        "name": name,
        "description": description,
        "input_schema": {"type": "object", "properties": props, "required": required, "additionalProperties": False},
    }


TOOLS = [
    _tool("get_document_info", "Page count, file name, current version and recent change history.", {}, []),
    _tool("read_page", "Read the text of one page as numbered lines (line ids are used by edit_line).",
          {"page": {"type": "integer", "description": "1-based page number"}}, ["page"]),
    _tool("search_text", "Find text across the document. Returns page, line id, the match and the full line.",
          {"query": {"type": "string"}, "match_case": {"type": "boolean"}, "whole_word": {"type": "boolean"}}, ["query"]),
    _tool("replace_text", "Replace every occurrence of a text in the whole document, keeping original formatting and layout.",
          {"find": {"type": "string"}, "replace_with": {"type": "string", "description": "May be empty to delete the text"},
           "match_case": {"type": "boolean"}, "whole_word": {"type": "boolean"}}, ["find", "replace_with"]),
    _tool("edit_line", "Replace one occurrence of `old_text` inside a specific line (from read_page/search_text).",
          {"page": {"type": "integer"}, "line": {"type": "integer"}, "old_text": {"type": "string"},
           "new_text": {"type": "string"},
           "occurrence": {"type": "integer", "description": "1-based occurrence within the line, default 1"}},
          ["page", "line", "old_text", "new_text"]),
    _tool("highlight_text", "Highlight (or underline / strike out) every occurrence of a text.",
          {"query": {"type": "string"}, "style": {"type": "string", "enum": ["highlight", "underline", "strikeout"]},
           "color": {"type": "string", "description": "#rrggbb, optional"}, "page": {"type": "integer", "description": "optional: only this page"}},
          ["query"]),
    _tool("add_note", "Add a comment note on a page, next to the first occurrence of `near_text` if given.",
          {"page": {"type": "integer"}, "text": {"type": "string"}, "near_text": {"type": "string"}}, ["page", "text"]),
    _tool("watermark", "Add a diagonal watermark to every page, or remove one added earlier.",
          {"text": {"type": "string"}, "remove": {"type": "boolean"}}, []),
    _tool("pages", "Page operations: rotate, delete, move, or insert a blank page.",
          {"op": {"type": "string", "enum": ["rotate", "delete", "move", "insert-blank"]},
           "pages": {"type": "array", "items": {"type": "integer"}, "description": "for rotate/delete"},
           "degrees": {"type": "integer", "description": "rotate: 90, 180 or -90"},
           "from": {"type": "integer"}, "to": {"type": "integer"},
           "after": {"type": "integer", "description": "insert-blank: insert after this page"}},
          ["op"]),
    _tool("undo", "Undo the most recent change to the document.", {}, []),
]


class AssistantUnavailable(Exception):
    pass


class Assistant:
    def __init__(self, service):
        self.service = service
        self._conversations: dict[str, dict] = {}
        self._lock = threading.Lock()
        self._client: Optional[anthropic.Anthropic] = None

    def _anthropic(self) -> anthropic.Anthropic:
        if self._client is None:
            try:
                self._client = anthropic.Anthropic()
            except anthropic.AnthropicError as exc:
                raise AssistantUnavailable(str(exc)) from exc
        return self._client

    # ------------------------------------------------------------------ chat
    def chat(self, doc_id: str, message: str, conversation_id: Optional[str] = None) -> dict:
        self.service.get(doc_id)  # 404 for unknown documents
        with self._lock:
            conv = self._conversations.get(conversation_id or "")
            if conv is None or conv["doc"] != doc_id:
                conversation_id = uuid.uuid4().hex
                conv = {"doc": doc_id, "messages": []}
                self._conversations[conversation_id] = conv
        messages: list = conv["messages"]
        rollback = len(messages)  # on an API failure the whole turn is undone, keeping history consistent
        messages.append({"role": "user", "content": message})
        actions: list[dict] = []
        start_version = self.service.get(doc_id)["current_version"]
        reply = ""
        client = self._anthropic()
        for _ in range(MAX_STEPS):
            try:
                response = client.beta.messages.create(
                    model=MODEL,
                    max_tokens=16000,
                    system=SYSTEM,
                    tools=TOOLS,
                    messages=messages,
                    output_config={"effort": "medium"},
                    betas=["server-side-fallback-2026-07-01"],
                    fallbacks="default",
                )
            except anthropic.AuthenticationError as exc:
                del messages[rollback:]
                raise AssistantUnavailable("The Claude API rejected the credentials. Check ANTHROPIC_API_KEY.") from exc
            except anthropic.RateLimitError as exc:
                del messages[rollback:]
                raise AssistantUnavailable("The Claude API is rate limiting requests; try again in a moment.") from exc
            except anthropic.APIConnectionError as exc:
                del messages[rollback:]
                raise AssistantUnavailable("Could not reach the Claude API. Check the internet connection.") from exc
            except anthropic.AnthropicError as exc:
                del messages[rollback:]
                raise AssistantUnavailable(str(exc)) from exc
            except TypeError as exc:
                # the SDK raises TypeError when no credential can be resolved at all
                if "auth" not in str(exc).lower():
                    raise
                del messages[rollback:]
                raise AssistantUnavailable("No Claude API key is configured. Set ANTHROPIC_API_KEY and restart the server.") from exc
            # append the full content (thinking/fallback blocks included) unchanged
            messages.append({"role": "assistant", "content": response.content})
            if response.stop_reason == "refusal":
                reply = "I can't help with that request."
                break
            if response.stop_reason == "pause_turn":
                continue
            tool_uses = [b for b in response.content if b.type == "tool_use"]
            if response.stop_reason != "tool_use" or not tool_uses:
                reply = "\n".join(b.text for b in response.content if b.type == "text").strip()
                if response.stop_reason == "max_tokens":
                    reply += "\n\n(Reply was cut off.)"
                break
            results = []
            for tu in tool_uses:
                content, is_error, action = self._run_tool(doc_id, tu.name, tu.input or {})
                if action:
                    actions.append(action)
                results.append({"type": "tool_result", "tool_use_id": tu.id, "content": content, "is_error": is_error})
            messages.append({"role": "user", "content": results})
        else:
            reply = "I stopped after many steps without finishing. Tell me how to continue."
        doc = self.service.get(doc_id)
        return {
            "conversationId": conversation_id,
            "reply": reply or "Done.",
            "actions": actions,
            "version": doc["current_version"],
            "changed": doc["current_version"] != start_version,
        }

    def reset(self, conversation_id: str) -> None:
        with self._lock:
            self._conversations.pop(conversation_id, None)

    # ----------------------------------------------------------------- tools
    def _run_tool(self, doc_id: str, name: str, args: dict) -> tuple[str, bool, Optional[dict]]:
        handler: Optional[Callable[[str, dict], tuple[Any, Optional[str]]]] = getattr(self, f"_t_{name.replace('-', '_')}", None)
        if handler is None:
            return f"Unknown tool {name}", True, None
        try:
            result, summary = handler(doc_id, args)
            action = {"tool": name, "summary": summary, "ok": True} if summary else None
            return json.dumps(result, ensure_ascii=False, default=str)[:20000], False, action
        except (EditError, ValueError, KeyError, IndexError) as exc:
            msg = str(exc) or exc.__class__.__name__
            return f"Error: {msg}", True, {"tool": name, "summary": f"Failed: {msg}", "ok": False}
        except Exception as exc:  # report, don't break the conversation
            log.exception("assistant tool %s failed", name)
            return f"Error: {exc}", True, {"tool": name, "summary": f"Failed: {exc}", "ok": False}

    def _t_get_document_info(self, doc_id, _):
        d = self.service.get(doc_id)
        return {"name": d["original_name"], "pages": d["page_count"], "version": d["current_version"],
                "history": [h["summary"] for h in (d.get("history") or []) if h["applied"]][-10:]}, None

    def _t_read_page(self, doc_id, a):
        page = int(a["page"])
        m = self.service.page_model(doc_id, page)
        lines = [{"line": l["id"], "text": l["text"]} for l in m["lines"]]
        out = {"page": page, "type": m.get("source") or m["type"], "lines": lines}
        if m["type"] == "scanned" and m.get("source") != "ocr":
            out["note"] = "Scanned page without recognised text; the user must run 'Recognise text' first."
        text = json.dumps(out, ensure_ascii=False)
        if len(text) > MAX_PAGE_CHARS:
            out["lines"] = lines[: max(1, len(lines) * MAX_PAGE_CHARS // len(text))]
            out["truncated"] = True
        return out, None

    def _t_search_text(self, doc_id, a):
        hits = self.service.find(doc_id, a["query"], bool(a.get("match_case")), bool(a.get("whole_word")))
        out = []
        for h in hits[:60]:
            line = self.service.page_model(doc_id, h["page"])["lines"][h["line"]]["text"]
            out.append({"page": h["page"], "line": h["line"], "match": h["text"], "line_text": line})
        return {"count": len(hits), "hits": out}, None

    def _t_replace_text(self, doc_id, a):
        res = self.service.find_replace(doc_id, a["find"], a["replace_with"], bool(a.get("match_case")),
                                        bool(a.get("whole_word")), "auto", "auto", None, False)
        warnings = sorted({w for r in res["reports"] for w in r.get("warnings", [])})
        result = {"matches": res["matches"], "replaced": res["replaced"], "pages": res["pages"],
                  "skipped": res["skipped"], "layoutVerified": res["verification"]["layoutPreserved"], "warnings": warnings}
        summary = f"Replaced '{a['find']}' → '{a['replace_with']}' ({res['replaced']}×)" if res["replaced"] else None
        return result, summary

    def _t_edit_line(self, doc_id, a):
        page, line_id = int(a["page"]), int(a["line"])
        m = self.service.page_model(doc_id, page)
        if not 0 <= line_id < len(m["lines"]):
            raise EditError(f"Page {page} has no line {line_id}")
        line = m["lines"][line_id]
        old, n = a["old_text"], max(1, int(a.get("occurrence") or 1))
        text = line["text"].replace(" ", " ")
        pos = -1
        for _ in range(n):
            pos = text.find(old, pos + 1)
            if pos < 0:
                raise EditError(f"'{old}' (occurrence {n}) not found in line {line_id}: {line['text']!r}")
        glyphs = sorted({i for i in line["map"][pos:pos + len(old)] if i >= 0})
        if not glyphs:
            raise EditError("Nothing editable at that position")
        res = self.service.replace_text(doc_id, page, [Edit(glyphs, a["new_text"], "auto", "auto")], None, False)
        r = res["reports"][0]
        return {"ok": True, "fits": r["fits"], "strategy": r["strategy"], "warnings": r["warnings"],
                "layoutVerified": res["verification"]["layoutPreserved"]}, f"Page {page}: '{old}' → '{a['new_text']}'"

    def _t_highlight_text(self, doc_id, a):
        hits = self.service.find(doc_id, a["query"], False, False)
        if a.get("page"):
            hits = [h for h in hits if h["page"] == int(a["page"])]
        if not hits:
            return {"highlighted": 0}, None
        style = a.get("style") or "highlight"
        for h in hits[:200]:
            spec = {"type": style, "glyphs": h["glyphs"]}
            if a.get("color"):
                spec["color"] = a["color"]
            self.service.annotate(doc_id, h["page"], spec, None)
        return {"highlighted": min(len(hits), 200)}, f"{style.title()} '{a['query']}' ({min(len(hits), 200)}×)"

    def _t_add_note(self, doc_id, a):
        page = int(a["page"])
        m = self.service.page_model(doc_id, page)
        x0, y0, x1, y1 = m["box"]
        x, y = x1 - 40, y1 - 40
        if a.get("near_text"):
            hit = next((h for h in self.service.find(doc_id, a["near_text"], False, False) if h["page"] == page), None)
            if hit:
                b = [m["glyphs"][i]["b"] for i in hit["glyphs"]]
                x, y = min(max(b[-1][2] + 4, x0), x1 - 22), max(b[-1][3] + 4, y0 + 22)
        self.service.annotate(doc_id, page, {"type": "note", "x": x, "y": y, "text": a["text"]}, None)
        return {"ok": True}, f"Note on page {page}"

    def _t_watermark(self, doc_id, a):
        if a.get("remove"):
            self.service.watermark(doc_id, {"remove": True}, None)
            return {"ok": True}, "Removed watermark"
        if not a.get("text"):
            raise EditError("Watermark text is required")
        self.service.watermark(doc_id, {"text": a["text"]}, None)
        return {"ok": True}, f"Watermark '{a['text']}'"

    def _t_pages(self, doc_id, a):
        op = a["op"]
        params = {k: v for k, v in a.items() if k != "op"}
        d = self.service.page_operation(doc_id, op, params, None)
        return {"ok": True, "pages": d["page_count"]}, d["history"][-1]["summary"] if d.get("history") else op

    def _t_undo(self, doc_id, _):
        d = self.service.undo(doc_id)
        return {"ok": True, "version": d["current_version"]}, "Undid the last change"
