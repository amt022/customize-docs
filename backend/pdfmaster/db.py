"""Metadata database: SQLite file (desktop / single server) or PostgreSQL (hosted).

PDFMASTER_DATABASE_URL=postgresql://user:pass@host:5432/formeasy switches to PostgreSQL; otherwise
<data>/pdfmaster.db is used. SQL in the service is written with "?" placeholders and plain types that
both understand; this module translates the few differences.
"""
from __future__ import annotations

import sqlite3
from pathlib import Path


class _Conn:
    """`with db.connect() as c:` runs one transaction and always gives the connection back."""

    def __init__(self, raw, release, pg: bool):
        self.raw, self._release, self.pg = raw, release, pg

    def execute(self, sql: str, params=()):
        if self.pg:  # psycopg placeholders are %s, so a literal % (LIKE 'u:%') must be doubled
            return self.raw.execute(sql.replace("%", "%%").replace("?", "%s"), params)
        return self.raw.execute(sql, params)

    def __enter__(self):
        if not self.pg:
            self.raw.execute("BEGIN")
        return self

    def __exit__(self, exc_type, *_):
        try:
            if self.pg:
                self.raw.rollback() if exc_type else self.raw.commit()
            else:
                self.raw.execute("ROLLBACK" if exc_type else "COMMIT")
        finally:
            self._release(self.raw)


class Database:
    def __init__(self, url: str = "", sqlite_path: Path | None = None):
        self.pg = url.startswith(("postgres://", "postgresql://"))
        if self.pg:
            from psycopg.rows import dict_row
            from psycopg_pool import ConnectionPool

            self._pool = ConnectionPool(url, min_size=1, max_size=10, kwargs={"row_factory": dict_row}, open=True)
        elif url:
            raise RuntimeError("PDFMASTER_DATABASE_URL must start with postgresql://")
        else:
            self.path = Path(sqlite_path)

    def connect(self) -> _Conn:
        if self.pg:
            return _Conn(self._pool.getconn(), self._pool.putconn, True)
        raw = sqlite3.connect(self.path, isolation_level=None, timeout=30)
        raw.row_factory = sqlite3.Row
        raw.execute("PRAGMA foreign_keys = ON")
        return _Conn(raw, lambda c: c.close(), False)

    def init(self, schema: str, columns: dict[str, list[tuple[str, str]]]) -> None:
        """Create tables, then add columns that older databases lack."""
        if self.pg:
            schema = schema.replace("INTEGER PRIMARY KEY AUTOINCREMENT", "BIGSERIAL PRIMARY KEY")
        with self.connect() as c:
            for stmt in filter(str.strip, schema.split(";")):
                c.execute(stmt)
            for table, cols in columns.items():
                if self.pg:
                    for name, decl in cols:
                        c.execute(f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS {name} {decl}")
                else:
                    have = {r["name"] for r in c.execute(f"PRAGMA table_info({table})")}
                    for name, decl in cols:
                        if name not in have:
                            c.execute(f"ALTER TABLE {table} ADD COLUMN {name} {decl}")

    def close(self) -> None:
        if self.pg:
            self._pool.close()
