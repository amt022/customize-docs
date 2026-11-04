"""The assistant's tool loop, driven by a scripted stand-in for the Claude API
(no network or API key needed). Verifies that tool calls reach the real engine."""
import importlib
from pathlib import Path
from types import SimpleNamespace as NS

import pytest
from fastapi.testclient import TestClient

from pdfmaster.engine.render import page_text

FIX = Path(__file__).parent / "fixtures"


class FakeClaude:
    """Returns the scripted responses in order and records what it was sent."""

    def __init__(self, script):
        self.script = list(script)
        self.calls = []
        self.beta = NS(messages=NS(create=self._create))

    def _create(self, **kw):
        self.calls.append({**kw, "messages": list(kw["messages"])})  # snapshot: the loop keeps appending
        return self.script.pop(0)


def tool(name, **inp):
    return NS(type="tool_use", id=f"tu_{name}_{len(inp)}", name=name, input=inp)


def text(t):
    return NS(type="text", text=t)


def resp(*blocks, stop="tool_use"):
    return NS(content=list(blocks), stop_reason=stop)


@pytest.fixture()
def app(tmp_path, monkeypatch):
    monkeypatch.setenv("PDFMASTER_DATA", str(tmp_path))
    import pdfmaster.api as api

    importlib.reload(api)
    c = TestClient(api.app)
    r = c.post("/api/v1/documents", files={"file": ("b.pdf", (FIX / "browser.pdf").read_bytes(), "application/pdf")})
    return c, api, r.json()["data"]["id"]


def test_chat_replaces_text_through_engine(app):
    c, api, did = app
    fake = FakeClaude([
        resp(tool("search_text", query="25,000.00")),
        resp(tool("replace_text", find="25,000.00", replace_with="35,000.00")),
        resp(text("Changed ₹25,000.00 to ₹35,000.00 on page 1."), stop="end_turn"),
    ])
    api.assistant._client = fake
    r = c.post(f"/api/v1/documents/{did}/assistant", json={"message": "Change 25,000 to 35,000"}).json()["data"]
    assert r["changed"] and r["version"] == 1
    assert [a["tool"] for a in r["actions"]] == ["replace_text"]
    assert "35,000.00" in page_text(api.service.data(did), 0)
    # tool results were sent back to the model, with the search hit details
    second = fake.calls[1]["messages"]
    assert second[-1]["content"][0]["type"] == "tool_result"
    assert '"count": 1' in second[-1]["content"][0]["content"]
    assert fake.calls[0]["model"] == "claude-opus-5-5"


def test_conversation_continues_and_edit_line(app):
    c, api, did = app
    api.assistant._client = FakeClaude([
        resp(tool("read_page", page=1)),
        resp(text("Page 1 is an invoice."), stop="end_turn"),
    ])
    r1 = c.post(f"/api/v1/documents/{did}/assistant", json={"message": "What is this?"}).json()["data"]
    assert not r1["changed"]
    line = next(l for l in api.service.page_model(did, 1)["lines"] if l["text"].startswith("Billed"))
    fake = FakeClaude([
        resp(tool("edit_line", page=1, line=line["id"], old_text="Lucknow", new_text="Kanpur")),
        resp(text("Done."), stop="end_turn"),
    ])
    api.assistant._client = fake
    r2 = c.post(f"/api/v1/documents/{did}/assistant",
                json={"message": "Change the city to Kanpur", "conversationId": r1["conversationId"]}).json()["data"]
    assert r2["conversationId"] == r1["conversationId"] and r2["changed"]
    assert "Kanpur" in page_text(api.service.data(did), 0)
    assert len(fake.calls[0]["messages"]) == 5  # earlier turn kept: user, assistant(tool), user(result), assistant, user


def test_tool_errors_are_reported_to_the_model(app):
    c, api, did = app
    fake = FakeClaude([
        resp(tool("edit_line", page=1, line=0, old_text="does-not-exist", new_text="x")),
        resp(tool("highlight_text", query="Total")),
        resp(tool("pages", op="rotate", pages=[1], degrees=90)),
        resp(tool("undo")),
        resp(text("ok"), stop="end_turn"),
    ])
    api.assistant._client = fake
    r = c.post(f"/api/v1/documents/{did}/assistant", json={"message": "x"}).json()["data"]
    assert fake.calls[1]["messages"][-1]["content"][0]["is_error"] is True
    assert [a["ok"] for a in r["actions"]] == [False, True, True, True]
    # highlight -> v1, rotate -> v2, undo -> back to v1 (highlight kept)
    assert len(api.service.annotations(did, 1)) == 1 and r["version"] == 1


def test_missing_credentials_reported(app, monkeypatch):
    c, api, did = app
    import anthropic

    class NoKey:
        def __init__(self):
            self.beta = NS(messages=NS(create=self.create))

        def create(self, **kw):
            raise anthropic.AuthenticationError("no key", response=NS(status_code=401, headers={}, request=None), body=None)

    api.assistant._client = NoKey()
    r = c.post(f"/api/v1/documents/{did}/assistant", json={"message": "hi"})
    assert r.status_code == 503 and r.json()["assistantUnavailable"]
