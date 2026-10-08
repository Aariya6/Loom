from __future__ import annotations

import hashlib
import json
import os
import secrets
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from pathlib import Path
from typing import Any, Iterable

import numpy as np
from argon2 import PasswordHasher
from fastapi import Cookie, Depends, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Index, Integer, LargeBinary, String, Text, UniqueConstraint, create_engine, select
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, relationship, sessionmaker

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
DB_URL = os.getenv("DATABASE_URL", f"sqlite:///{ROOT / 'loom.db'}")
if DB_URL.startswith("postgres://"):
    DB_URL = DB_URL.replace("postgres://", "postgresql+psycopg://", 1)
elif DB_URL.startswith("postgresql://") and "+psycopg" not in DB_URL:
    DB_URL = DB_URL.replace("postgresql://", "postgresql+psycopg://", 1)

connect_args = {"check_same_thread": False} if DB_URL.startswith("sqlite") else {}
engine = create_engine(DB_URL, future=True, connect_args=connect_args, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, expire_on_commit=False, class_=Session)
ph = PasswordHasher(time_cost=3, memory_cost=65536, parallelism=2)

class Base(DeclarativeBase):
    pass

class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(512))
    display_name: Mapped[str] = mapped_column(String(120))
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    projects: Mapped[list["Project"]] = relationship(back_populates="owner", cascade="all, delete-orphan")

class AuthSession(Base):
    __tablename__ = "sessions"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    csrf_token: Mapped[str] = mapped_column(String(128))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)

class Project(Base):
    __tablename__ = "projects"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(160))
    bpm: Mapped[float] = mapped_column(Float, default=96)
    state_json: Mapped[str] = mapped_column(Text, default="{}")
    revision: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))
    owner: Mapped[User] = relationship(back_populates="projects")
    versions: Mapped[list["ProjectVersion"]] = relationship(back_populates="project", cascade="all, delete-orphan")
    audio: Mapped[list["AudioAsset"]] = relationship(back_populates="project", cascade="all, delete-orphan")
    collaborators: Mapped[list["Collaborator"]] = relationship(cascade="all, delete-orphan")
    shares: Mapped[list["ShareLink"]] = relationship(cascade="all, delete-orphan")
    activity: Mapped[list["Activity"]] = relationship(cascade="all, delete-orphan")
    __table_args__ = (Index("ix_projects_owner_updated", "owner_id", "updated_at"),)

class ProjectVersion(Base):
    __tablename__ = "project_versions"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    revision: Mapped[int] = mapped_column(Integer)
    state_json: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True)
    project: Mapped[Project] = relationship(back_populates="versions")

class AudioAsset(Base):
    """Uploaded or recorded audio (vocals, loops). Bytes live in the database so a project is portable between devices."""
    __tablename__ = "audio_assets"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(200))
    kind: Mapped[str] = mapped_column(String(16))
    size: Mapped[int] = mapped_column(Integer)
    data: Mapped[bytes] = mapped_column(LargeBinary)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    project: Mapped[Project] = relationship(back_populates="audio")


class Collaborator(Base):
    """A signed-up user who may open and edit someone else's project."""
    __tablename__ = "collaborators"
    __table_args__ = (UniqueConstraint("project_id", "user_id", name="uq_collab"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class Activity(Base):
    """Who saved which revision (for 'saved by' and live-sync messages)."""
    __tablename__ = "project_activity"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    revision: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class ShareLink(Base):
    """A public, read-only page for a snapshot of a project, optionally with a recorded walkthrough."""
    __tablename__ = "share_links"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), unique=True, index=True)
    token: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    title: Mapped[str] = mapped_column(String(160))
    allow_comments: Mapped[bool] = mapped_column(Boolean, default=True)
    state_json: Mapped[str] = mapped_column(Text)
    walkthrough_asset_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    transcript_json: Mapped[str] = mapped_column(Text, default="[]")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    comments: Mapped[list["ShareComment"]] = relationship(cascade="all, delete-orphan")
    reactions: Mapped[list["ShareReaction"]] = relationship(cascade="all, delete-orphan")


class ShareComment(Base):
    __tablename__ = "share_comments"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    share_id: Mapped[int] = mapped_column(ForeignKey("share_links.id", ondelete="CASCADE"), index=True)
    author: Mapped[str] = mapped_column(String(40))
    body: Mapped[str] = mapped_column(String(500))
    at: Mapped[float] = mapped_column(Float)
    kind: Mapped[str] = mapped_column(String(8))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class ShareReaction(Base):
    __tablename__ = "share_reactions"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    share_id: Mapped[int] = mapped_column(ForeignKey("share_links.id", ondelete="CASCADE"), index=True)
    emoji: Mapped[str] = mapped_column(String(8))
    at: Mapped[float] = mapped_column(Float)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class Note(Base):
    __tablename__ = "notes"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    body: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

class AuditEvent(Base):
    __tablename__ = "audit_events"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    event: Mapped[str] = mapped_column(String(100), index=True)
    detail_json: Mapped[str] = mapped_column(Text, default="{}")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True)

Base.metadata.create_all(engine)

ATTEMPTS: dict[str, list[float]] = {}


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def token_hash(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def rate_limit(key: str, *, window: int = 900, maximum: int = 12) -> None:
    now = time.monotonic()
    recent = [t for t in ATTEMPTS.get(key, []) if now - t < window]
    if len(recent) >= maximum:
        raise HTTPException(429, "Too many attempts. Try again later.")
    recent.append(now)
    ATTEMPTS[key] = recent


def cookie_options() -> dict[str, Any]:
    return {
        "httponly": True,
        "samesite": "lax",
        "secure": os.getenv("COOKIE_SECURE", "0") == "1",
        "max_age": 60 * 60 * 24 * 14,
    }


def db_dependency():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def get_session(request: Request, db: Session) -> tuple[User, AuthSession]:
    raw = request.cookies.get("loom_session")
    if not raw:
        raise HTTPException(401, "Authentication required")
    session = db.scalar(select(AuthSession).where(AuthSession.token_hash == token_hash(raw)))
    if session is None:
        raise HTTPException(401, "Session expired")
    expires = session.expires_at if session.expires_at.tzinfo else session.expires_at.replace(tzinfo=timezone.utc)
    if expires < utc_now():
        db.delete(session)
        db.commit()
        raise HTTPException(401, "Session expired")
    user = db.get(User, session.user_id)
    if user is None or not user.active:
        raise HTTPException(401, "Account unavailable")
    return user, session


def require_csrf(request: Request, session: AuthSession) -> None:
    supplied = request.headers.get("X-CSRF-Token", "")
    if not supplied or not secrets.compare_digest(supplied, session.csrf_token):
        raise HTTPException(403, "CSRF validation failed")


def create_session(response: Response, db: Session, user_id: int) -> str:
    raw = secrets.token_urlsafe(32)
    session = AuthSession(
        token_hash=token_hash(raw),
        user_id=user_id,
        csrf_token=secrets.token_urlsafe(32),
        expires_at=utc_now() + timedelta(days=14),
    )
    db.add(session)
    db.commit()
    response.set_cookie("loom_session", raw, **cookie_options())
    return session.csrf_token


def audit(db: Session, user_id: int, event: str, detail: dict[str, Any] | None = None) -> None:
    db.add(AuditEvent(user_id=user_id, event=event, detail_json=json.dumps(detail or {}, separators=(",", ":"))))


@dataclass(frozen=True)
class PatternStats:
    note_count: int
    pitch_min: int | None
    pitch_max: int | None
    density_mean: float
    duration_mean: float
    velocity_mean: float


@lru_cache(maxsize=128)
def _pitch_name(pc: int) -> str:
    names = ("C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B")
    return names[pc % 12]


def analyze_notes(notes: Iterable[dict[str, Any]], bars: int = 8) -> dict[str, Any]:
    notes = list(notes)
    if not notes:
        return {"stats": PatternStats(0, None, None, 0.0, 0.0, 0.0).__dict__, "density": [], "pitch_profile": [0] * 12, "velocity_profile": [], "novelty": [], "pc_2d": []}
    starts = np.asarray([float(n.get("start", 0.0)) for n in notes], dtype=np.float64)
    durations = np.asarray([max(0.01, float(n.get("duration", 0.25))) for n in notes], dtype=np.float64)
    pitches = np.asarray([int(n.get("pitch", 60)) for n in notes], dtype=np.int16)
    velocity = np.asarray([np.clip(float(n.get("velocity", 0.7)), 0, 1) for n in notes], dtype=np.float64)
    bars = int(np.clip(bars, 1, 128))
    bar_index = np.floor(starts / 4.0).astype(np.int16)
    density = []
    for b in range(bars):
        mask = bar_index == b
        density.append({"bar": b + 1, "notes": int(mask.sum()), "energy": round(float(velocity[mask].mean()) if np.any(mask) else 0.0, 3)})
    pitch_profile = np.bincount(np.mod(pitches, 12), minlength=12).astype(int).tolist()
    velocity_hist, _ = np.histogram(velocity, bins=8, range=(0, 1))
    order = np.argsort(starts, kind="stable")
    ordered_pc = np.mod(pitches[order], 12)
    novelty = [{"t": round(float(starts[idx]), 3), "value": 0.25 if j == 0 else (1.0 if ordered_pc[j] != ordered_pc[j - 1] else 0.1)} for j, idx in enumerate(order)]
    # Fast analytical 2-D embedding: normalized pitch and time/velocity, no black-box service dependency.
    x = (starts - starts.mean()) / (starts.std() + 1e-9)
    y = (pitches.astype(np.float64) - pitches.mean()) / (pitches.std() + 1e-9)
    pc_2d = [[round(float(xi), 4), round(float(yi), 4)] for xi, yi in zip(x, y)]
    stats = PatternStats(
        len(notes), int(pitches.min()), int(pitches.max()), float(len(notes) / max(1, bars)), float(durations.mean()), float(velocity.mean())
    )
    return {
        "stats": stats.__dict__,
        "density": density,
        "pitch_profile": pitch_profile,
        "velocity_profile": velocity_hist.tolist(),
        "novelty": novelty,
        "pc_2d": pc_2d,
        "pitch_labels": [_pitch_name(i) for i in range(12)],
    }
