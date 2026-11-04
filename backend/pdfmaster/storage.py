"""Where document bytes live: a local folder (desktop) or S3-compatible object storage (hosted).

Keys look like "docs/<id>/v3-<random>.pdf" and "docs/<id>/ocr/<page key>.json". PDF version blobs are
immutable (every write gets a new random name), so the S3 store can keep a local read cache safely.

Choose with PDFMASTER_STORAGE=s3 plus PDFMASTER_S3_BUCKET (and optionally PDFMASTER_S3_PREFIX,
PDFMASTER_S3_ENDPOINT for Cloudflare R2 / Backblaze B2 / MinIO, PDFMASTER_S3_REGION). Credentials come
from the usual AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY variables or the instance role.
"""
from __future__ import annotations

import os
import threading
from collections import OrderedDict
from pathlib import Path
from typing import Optional


def _check(key: str) -> str:
    parts = key.split("/")
    if not key or key.startswith("/") or any(p in ("", ".", "..") for p in parts) or "\\" in key or ":" in key:
        raise ValueError(f"Bad storage key {key!r}")
    return key


class LocalStore:
    def __init__(self, root: Path):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)

    def _path(self, key: str) -> Path:
        return self.root / _check(key)

    def put(self, key: str, data: bytes) -> None:
        p = self._path(key)
        p.parent.mkdir(parents=True, exist_ok=True)
        tmp = p.with_name(p.name + ".tmp")
        tmp.write_bytes(data)
        os.replace(tmp, p)  # readers never see half a file

    def get(self, key: str) -> Optional[bytes]:
        p = self._path(key)
        return p.read_bytes() if p.is_file() else None

    def delete(self, key: str) -> None:
        self._path(key).unlink(missing_ok=True)

    def delete_prefix(self, prefix: str) -> None:
        import shutil

        shutil.rmtree(self._path(prefix.rstrip("/")), ignore_errors=True)


class S3Store:
    """S3 / R2 / B2 / MinIO. Objects are encrypted at rest by the provider (SSE-S3 requested explicitly)."""

    def __init__(self, bucket: str, prefix: str = "", client=None, cache_bytes: int = 256 * 1024 * 1024):
        if client is None:
            import boto3

            client = boto3.client("s3", endpoint_url=os.environ.get("PDFMASTER_S3_ENDPOINT") or None,
                                  region_name=os.environ.get("PDFMASTER_S3_REGION") or None)
        self.s3, self.bucket = client, bucket
        self.prefix = prefix.strip("/") + "/" if prefix.strip("/") else ""
        self.sse = os.environ.get("PDFMASTER_S3_SSE", "AES256")  # "" for providers that reject the header
        self._cache: OrderedDict[str, bytes] = OrderedDict()  # immutable PDF versions only
        self._cache_size, self._cache_max = 0, cache_bytes
        self._lock = threading.Lock()

    def _key(self, key: str) -> str:
        return self.prefix + _check(key)

    def put(self, key: str, data: bytes) -> None:
        extra = {"ServerSideEncryption": self.sse} if self.sse else {}
        self.s3.put_object(Bucket=self.bucket, Key=self._key(key), Body=data, **extra)
        with self._lock:
            self._drop(key)

    def get(self, key: str) -> Optional[bytes]:
        with self._lock:
            if key in self._cache:
                self._cache.move_to_end(key)
                return self._cache[key]
        try:
            data = self.s3.get_object(Bucket=self.bucket, Key=self._key(key))["Body"].read()
        except self.s3.exceptions.NoSuchKey:
            return None
        if key.endswith(".pdf") and len(data) <= self._cache_max // 4:
            with self._lock:
                self._drop(key)
                self._cache[key] = data
                self._cache_size += len(data)
                while self._cache_size > self._cache_max:
                    self._drop(next(iter(self._cache)))
        return data

    def _drop(self, key: str) -> None:
        data = self._cache.pop(key, None)
        if data is not None:
            self._cache_size -= len(data)

    def delete(self, key: str) -> None:
        self.s3.delete_object(Bucket=self.bucket, Key=self._key(key))
        with self._lock:
            self._drop(key)

    def delete_prefix(self, prefix: str) -> None:
        full = self._key(prefix.rstrip("/")) + "/"
        for page in self.s3.get_paginator("list_objects_v2").paginate(Bucket=self.bucket, Prefix=full):
            keys = [{"Key": o["Key"]} for o in page.get("Contents", [])]
            if keys:
                self.s3.delete_objects(Bucket=self.bucket, Delete={"Objects": keys, "Quiet": True})
        with self._lock:
            for k in [k for k in self._cache if k.startswith(prefix)]:
                self._drop(k)


def from_env(data_root: Path):
    kind = os.environ.get("PDFMASTER_STORAGE", "local").lower()
    if kind == "s3":
        bucket = os.environ.get("PDFMASTER_S3_BUCKET")
        if not bucket:
            raise RuntimeError("PDFMASTER_STORAGE=s3 needs PDFMASTER_S3_BUCKET")
        return S3Store(bucket, os.environ.get("PDFMASTER_S3_PREFIX", ""))
    if kind != "local":
        raise RuntimeError(f"Unknown PDFMASTER_STORAGE {kind!r} (use local or s3)")
    return LocalStore(data_root)
