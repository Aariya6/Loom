from __future__ import annotations

import json
import os
import re
import secrets
import time
from pathlib import Path
from typing import Any, Literal

from fastapi import Depends, FastAPI, File, Form, HTTPException, Request, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, EmailStr, Field, field_validator
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from .core import (
    Activity, AudioAsset, AuthSession, Base, Collaborator, Project, ShareComment, ShareLink, ShareReaction, ProjectVersion, SessionLocal, User, audit, analyze_notes, create_session, db_dependency,
    engine, get_session, ph, rate_limit, require_csrf, token_hash, utc_now,
)

ROOT = Path(__file__).resolve().parents[1]
FRONTEND = ROOT / "frontend"
DATA = ROOT / "data"

app = FastAPI(title="LOOM", version="10.0.0")
app.add_middleware(CORSMiddleware, allow_origins=[x.strip() for x in os.getenv("CORS_ORIGINS", "http://127.0.0.1:8000,http://localhost:8000").split(",") if x.strip()], allow_credentials=True, allow_methods=["GET", "POST", "PUT", "DELETE"], allow_headers=["Content-Type", "X-CSRF-Token"])
app.mount("/assets", StaticFiles(directory=FRONTEND / "assets"), name="assets")

class SignupIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=10, max_length=128)
    display_name: str = Field(min_length=2, max_length=80)
    @field_validator("display_name")
    @classmethod
    def normalize_name(cls, value: str) -> str:
        return " ".join(value.strip().split())

class LoginIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)

MAX_STATE_BYTES = 1_000_000

def _bounded_state(value: dict[str, Any] | None) -> dict[str, Any] | None:
    if value is not None and len(json.dumps(value, separators=(",", ":"))) > MAX_STATE_BYTES:
        raise ValueError(f"Project state is larger than {MAX_STATE_BYTES // 1000} KB.")
    return value

class ProjectIn(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    bpm: float = Field(default=96, ge=30, le=240)
    state: dict[str, Any] = Field(default_factory=dict)
    _check_state = field_validator("state")(_bounded_state)

class ProjectPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=160)
    bpm: float | None = Field(default=None, ge=30, le=240)
    state: dict[str, Any] | None = None
    base_revision: int | None = None            # the revision this edit was made on; a mismatch means someone else saved first
    _check_state = field_validator("state")(_bounded_state)

class TranscriptSeg(BaseModel):
    t: float = Field(ge=0, le=7200)
    text: str = Field(min_length=1, max_length=300)

class ShareIn(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    allow_comments: bool = True
    walkthrough_asset_id: int | None = None
    transcript: list[TranscriptSeg] = Field(default_factory=list, max_length=2000)
    state: dict[str, Any]
    _check_state = field_validator("state")(_bounded_state)

class CommentIn(BaseModel):
    name: str = Field(default="Guest", max_length=40)
    body: str = Field(min_length=1, max_length=500)
    at: float = Field(ge=0, le=36000)
    kind: Literal["video", "song"] = "song"

class ReactionIn(BaseModel):
    emoji: str = Field(min_length=1, max_length=8)
    at: float = Field(ge=0, le=36000)

class CollabIn(BaseModel):
    email: EmailStr

class NoteIn(BaseModel):
    body: str = Field(min_length=1, max_length=6000)

class AnalyzeIn(BaseModel):
    notes: list[dict[str, Any]] = Field(default_factory=list, max_length=10000)
    bars: int = Field(default=8, ge=1, le=128)


def user_payload(user: User) -> dict[str, Any]:
    return {"id": user.id, "email": user.email, "display_name": user.display_name}

@app.get("/api/health")
def health() -> dict[str, Any]:
    with SessionLocal() as db:
        db.execute(select(1))
    return {"status": "ok", "service": "loom", "version": app.version, "database": "postgresql" if "postgresql" in str(engine.url) else "sqlite", "time": utc_now().isoformat()}

@app.get("/api/auth/bootstrap")
def auth_bootstrap(response: Response) -> dict[str, str]:
    token = os.urandom(32).hex()
    response.set_cookie("loom_csrf", token, httponly=False, samesite="lax", secure=os.getenv("COOKIE_SECURE", "0") == "1", max_age=3600)
    return {"csrf_token": token}

@app.post("/api/auth/signup")
def signup(payload: SignupIn, request: Request, response: Response, db: Session = Depends(db_dependency)):
    rate_limit(f"signup:{request.client.host if request.client else 'unknown'}", maximum=8)
    cookie_token = request.cookies.get("loom_csrf", "")
    header_token = request.headers.get("X-CSRF-Token", "")
    if not cookie_token or not header_token or not __import__('secrets').compare_digest(cookie_token, header_token):
        raise HTTPException(403, "CSRF validation failed")
    email = str(payload.email).strip().lower()
    if db.scalar(select(User).where(User.email == email)):
        raise HTTPException(409, "An account with that email already exists.")
    local = email.split("@", 1)[0]
    if any(bad in payload.password.lower() for bad in ("password", "123456", local)):
        raise HTTPException(400, "Choose a password that is not based on your email or a common password.")
    user = User(email=email, password_hash=ph.hash(payload.password), display_name=payload.display_name)
    db.add(user); db.commit(); db.refresh(user)
    csrf = create_session(response, db, user.id)
    return {"user": user_payload(user), "csrf_token": csrf}

@app.post("/api/auth/login")
def login(payload: LoginIn, request: Request, response: Response, db: Session = Depends(db_dependency)):
    rate_limit(f"login:{request.client.host if request.client else 'unknown'}", maximum=12)
    cookie_token = request.cookies.get("loom_csrf", "")
    header_token = request.headers.get("X-CSRF-Token", "")
    if not cookie_token or not header_token or not __import__('secrets').compare_digest(cookie_token, header_token):
        raise HTTPException(403, "CSRF validation failed")
    user = db.scalar(select(User).where(User.email == str(payload.email).strip().lower()))
    if user is None:
        raise HTTPException(401, "Incorrect email or password.")
    try:
        ph.verify(user.password_hash, payload.password)
    except Exception:
        raise HTTPException(401, "Incorrect email or password.")
    csrf = create_session(response, db, user.id)
    return {"user": user_payload(user), "csrf_token": csrf}

@app.post("/api/auth/logout")
def logout(request: Request, response: Response, db: Session = Depends(db_dependency)):
    raw = request.cookies.get("loom_session")
    if raw:
        session = db.scalar(select(AuthSession).where(AuthSession.token_hash == token_hash(raw)))
        if session:
            require_csrf(request, session)
            db.delete(session); db.commit()
    response.delete_cookie("loom_session")
    return {"ok": True}

@app.get("/api/auth/me")
def me(request: Request, db: Session = Depends(db_dependency)):
    user, session = get_session(request, db)
    return {"user": user_payload(user), "csrf_token": session.csrf_token}

@app.get("/api/projects")
def list_projects(request: Request, db: Session = Depends(db_dependency)):
    user, _ = get_session(request, db)
    shared_ids = select(Collaborator.project_id).where(Collaborator.user_id == user.id)
    projects = db.scalars(select(Project).where(or_(Project.owner_id == user.id, Project.id.in_(shared_ids))).order_by(Project.updated_at.desc())).all()
    owners = {u.id: u.display_name for u in db.scalars(select(User).where(User.id.in_({p.owner_id for p in projects} or {0}))).all()}
    return [{"id": p.id, "name": p.name, "bpm": p.bpm, "state": json.loads(p.state_json), "revision": p.revision, "updated_at": p.updated_at.isoformat(),
             "shared": p.owner_id != user.id, "owner_name": owners.get(p.owner_id, "")} for p in projects]

@app.post("/api/projects")
def create_project(payload: ProjectIn, request: Request, db: Session = Depends(db_dependency)):
    user, session = get_session(request, db); require_csrf(request, session)
    project = Project(owner_id=user.id, name=payload.name.strip(), bpm=payload.bpm, state_json=json.dumps(payload.state, separators=(",", ":")))
    db.add(project); db.flush()
    db.add(ProjectVersion(project_id=project.id, revision=1, state_json=project.state_json)); db.add(Activity(project_id=project.id, user_id=user.id, revision=1))
    audit(db, user.id, "project.create", {"project_id": project.id})
    db.commit(); db.refresh(project)
    return {"id": project.id, "name": project.name, "bpm": project.bpm, "state": payload.state, "revision": project.revision}

@app.get("/api/projects/{project_id}")
def get_project(project_id: int, request: Request, db: Session = Depends(db_dependency)):
    user, _ = get_session(request, db)
    project = owned_project(db, user, project_id)
    return {"id": project.id, "name": project.name, "bpm": project.bpm, "state": json.loads(project.state_json), "revision": project.revision, "updated_at": project.updated_at.isoformat(),
            "shared": project.owner_id != user.id}

@app.put("/api/projects/{project_id}")
def update_project(project_id: int, payload: ProjectPatch, request: Request, db: Session = Depends(db_dependency)):
    user, session = get_session(request, db); require_csrf(request, session)
    project = owned_project(db, user, project_id)
    if payload.base_revision is not None and payload.base_revision != project.revision:
        last = db.scalar(select(Activity).where(Activity.project_id == project.id).order_by(Activity.id.desc()))
        who = db.get(User, last.user_id) if last else None
        return JSONResponse(status_code=409, content={"detail": "conflict", "revision": project.revision, "saved_by": who.display_name if who else "someone"})
    if payload.name is not None: project.name = payload.name.strip()
    if payload.bpm is not None: project.bpm = payload.bpm
    if payload.state is not None:
        project.revision += 1
        project.state_json = json.dumps(payload.state, separators=(",", ":"))
        db.add(ProjectVersion(project_id=project.id, revision=project.revision, state_json=project.state_json))
        # Keep history bounded to the latest 40 snapshots to prevent unbounded storage.
        versions = db.scalars(select(ProjectVersion).where(ProjectVersion.project_id == project.id).order_by(ProjectVersion.created_at.desc())).all()
        for old in versions[40:]: db.delete(old)
        db.add(Activity(project_id=project.id, user_id=user.id, revision=project.revision))
    audit(db, user.id, "project.update", {"project_id": project.id, "revision": project.revision})
    db.commit()
    return {"ok": True, "revision": project.revision}

@app.get("/api/projects/{project_id}/versions")
def project_versions(project_id: int, request: Request, db: Session = Depends(db_dependency)):
    user, _ = get_session(request, db)
    project = owned_project(db, user, project_id)
    by = {a.revision: a.user_id for a in db.scalars(select(Activity).where(Activity.project_id == project.id)).all()}
    names = {u.id: u.display_name for u in db.scalars(select(User).where(User.id.in_(set(by.values()) or {0}))).all()}
    return [{"id": v.id, "revision": v.revision, "created_at": v.created_at.isoformat(), "by": names.get(by.get(v.revision, -1), "")}
            for v in db.scalars(select(ProjectVersion).where(ProjectVersion.project_id == project.id).order_by(ProjectVersion.revision.desc())).all()]


@app.get("/api/projects/{project_id}/versions/{revision}")
def project_version_state(project_id: int, revision: int, request: Request, db: Session = Depends(db_dependency)):
    user, _ = get_session(request, db); project = owned_project(db, user, project_id)
    v = db.scalar(select(ProjectVersion).where(ProjectVersion.project_id == project.id, ProjectVersion.revision == revision))
    if not v: raise HTTPException(404, "Revision not found")
    return {"revision": v.revision, "state": json.loads(v.state_json)}

@app.post("/api/projects/{project_id}/versions/{revision}/restore")
def restore_project(project_id: int, revision: int, request: Request, db: Session = Depends(db_dependency)):
    user, session = get_session(request, db); require_csrf(request, session)
    project = owned_project(db, user, project_id)
    version = db.scalar(select(ProjectVersion).where(ProjectVersion.project_id == project.id, ProjectVersion.revision == revision))
    if not version: raise HTTPException(404, "Revision not found")
    project.revision += 1
    project.state_json = version.state_json
    db.add(ProjectVersion(project_id=project.id, revision=project.revision, state_json=project.state_json)); db.add(Activity(project_id=project.id, user_id=user.id, revision=project.revision))
    audit(db, user.id, "project.restore", {"project_id": project.id, "from_revision": revision, "new_revision": project.revision})
    db.commit()
    return {"ok": True, "revision": project.revision, "state": json.loads(project.state_json)}

@app.delete("/api/projects/{project_id}")
def delete_project(project_id: int, request: Request, db: Session = Depends(db_dependency)):
    user, session = get_session(request, db); require_csrf(request, session)
    project = owned_project(db, user, project_id, owner_only=True)
    db.delete(project); audit(db, user.id, "project.delete", {"project_id": project_id}); db.commit()
    return {"ok": True}

@app.post("/api/projects/{project_id}/notes")
def add_note(project_id: int, payload: NoteIn, request: Request, db: Session = Depends(db_dependency)):
    user, session = get_session(request, db); require_csrf(request, session)
    project = owned_project(db, user, project_id)
    note = __import__('backend.core', fromlist=['Note']).Note(owner_id=user.id, project_id=project_id, body=payload.body.strip())
    db.add(note); db.commit(); db.refresh(note)
    return {"id": note.id, "body": note.body, "created_at": note.created_at.isoformat()}

@app.post("/api/analyze")
def analyze(payload: AnalyzeIn) -> dict[str, Any]:
    return analyze_notes(payload.notes, payload.bars)

MAX_AUDIO_BYTES = 12 * 1024 * 1024
MAX_PROJECT_AUDIO_BYTES = 60 * 1024 * 1024
MAX_PROJECT_AUDIO_FILES = 40
MAX_VIDEO_BYTES = 48 * 1024 * 1024
MAX_PROJECT_VIDEO_BYTES = 150 * 1024 * 1024
MAX_PROJECT_VIDEO_FILES = 6
VIDEO_KINDS = ("webmv", "mp4v")


def sniff_audio(head: bytes) -> str | None:
    """Identify an audio container from its first bytes; anything else is refused."""
    if head[:4] == b"RIFF" and head[8:12] == b"WAVE": return "wav"
    if head[:3] == b"ID3" or (len(head) > 1 and head[0] == 0xFF and head[1] & 0xE0 == 0xE0): return "mp3"
    if head[:4] == b"OggS": return "ogg"
    if head[:4] == b"fLaC": return "flac"
    if head[4:8] == b"ftyp": return "m4a"
    if head[:4] == bytes([0x1A, 0x45, 0xDF, 0xA3]): return "webm"
    return None


def owned_project(db: Session, user: User, project_id: int, owner_only: bool = False) -> Project:
    """The project if `user` owns it or (unless owner_only) was invited to it. Anything else looks like a missing project."""
    project = db.get(Project, project_id)
    if project is not None:
        if project.owner_id == user.id: return project
        if not owner_only and db.scalar(select(Collaborator.id).where(Collaborator.project_id == project_id, Collaborator.user_id == user.id)): return project
    raise HTTPException(404, "Project not found")


@app.get("/api/projects/{project_id}/audio")
def list_audio(project_id: int, request: Request, db: Session = Depends(db_dependency)):
    user, _ = get_session(request, db); owned_project(db, user, project_id)
    rows = db.execute(select(AudioAsset.id, AudioAsset.name, AudioAsset.kind, AudioAsset.size).where(AudioAsset.project_id == project_id).order_by(AudioAsset.id)).all()
    return [{"id": r.id, "name": r.name, "kind": r.kind, "size": r.size} for r in rows]


@app.post("/api/projects/{project_id}/audio")
async def upload_audio(project_id: int, request: Request, file: UploadFile = File(...), video: bool = Form(False), db: Session = Depends(db_dependency)):
    user, session = get_session(request, db); require_csrf(request, session)
    owned_project(db, user, project_id)
    limit = MAX_VIDEO_BYTES if video else MAX_AUDIO_BYTES
    data = await file.read(limit + 1)
    if not data: raise HTTPException(400, "Empty file.")
    if len(data) > limit: raise HTTPException(413, f"{'Walkthrough videos' if video else 'Audio files'} are limited to {limit // (1024 * 1024)} MB.")
    kind = sniff_audio(data[:16])
    if video:
        if kind not in ("webm", "m4a"): raise HTTPException(415, "Walkthroughs must be WebM or MP4 video.")
        kind = "webmv" if kind == "webm" else "mp4v"
        count, used = db.execute(select(func.count(AudioAsset.id), func.coalesce(func.sum(AudioAsset.size), 0)).where(AudioAsset.project_id == project_id, AudioAsset.kind.in_(VIDEO_KINDS))).one()
        if count >= MAX_PROJECT_VIDEO_FILES or used + len(data) > MAX_PROJECT_VIDEO_BYTES:
            raise HTTPException(413, "This project has reached its walkthrough storage limit (150 MB / 6 videos). Delete an older one first.")
    else:
        if not kind: raise HTTPException(415, "Unsupported audio format. Use WAV, MP3, OGG, FLAC, M4A or WebM.")
        count, used = db.execute(select(func.count(AudioAsset.id), func.coalesce(func.sum(AudioAsset.size), 0)).where(AudioAsset.project_id == project_id, AudioAsset.kind.notin_(VIDEO_KINDS))).one()
        if count >= MAX_PROJECT_AUDIO_FILES or used + len(data) > MAX_PROJECT_AUDIO_BYTES:
            raise HTTPException(413, "This project has reached its audio storage limit (60 MB / 40 files).")
    name = " ".join((file.filename or "audio").split())[:200] or "audio"
    asset = AudioAsset(owner_id=user.id, project_id=project_id, name=name, kind=kind, size=len(data), data=data)
    db.add(asset); audit(db, user.id, "audio.upload", {"project_id": project_id, "bytes": len(data)}); db.commit(); db.refresh(asset)
    return {"id": asset.id, "name": asset.name, "kind": asset.kind, "size": asset.size}


@app.get("/api/projects/{project_id}/audio/{asset_id}")
def get_audio(project_id: int, asset_id: int, request: Request, db: Session = Depends(db_dependency)):
    user, _ = get_session(request, db); owned_project(db, user, project_id)
    asset = db.scalar(select(AudioAsset).where(AudioAsset.id == asset_id, AudioAsset.project_id == project_id))
    if not asset: raise HTTPException(404, "Audio not found")
    # Served as opaque bytes (the page decodes them with Web Audio), never as a document the browser might render.
    return Response(asset.data, media_type="application/octet-stream", headers={"X-Content-Type-Options": "nosniff", "Cache-Control": "private, max-age=3600"})


@app.delete("/api/projects/{project_id}/audio/{asset_id}")
def delete_audio(project_id: int, asset_id: int, request: Request, db: Session = Depends(db_dependency)):
    user, session = get_session(request, db); require_csrf(request, session); owned_project(db, user, project_id)
    asset = db.scalar(select(AudioAsset).where(AudioAsset.id == asset_id, AudioAsset.project_id == project_id))
    if not asset: raise HTTPException(404, "Audio not found")
    db.delete(asset); db.commit()
    return {"ok": True}


# ------------------------------------------------------------------ live status, presence, collaborators
PRESENCE: dict[int, dict[int, tuple[str, float]]] = {}


@app.get("/api/projects/{project_id}/status")
def project_status(project_id: int, request: Request, db: Session = Depends(db_dependency)):
    user, _ = get_session(request, db); project = owned_project(db, user, project_id)
    now = time.monotonic(); room = PRESENCE.setdefault(project_id, {})
    room[user.id] = (user.display_name, now)
    for uid_, (_, seen) in list(room.items()):
        if now - seen > 25: del room[uid_]
    last = db.scalar(select(Activity).where(Activity.project_id == project_id).order_by(Activity.id.desc()))
    who = db.get(User, last.user_id) if last else None
    collabs = db.scalar(select(func.count(Collaborator.id)).where(Collaborator.project_id == project_id)) or 0
    return {"revision": project.revision, "updated_at": project.updated_at.isoformat(), "saved_by": who.display_name if who else "", "saved_by_me": bool(last and last.user_id == user.id),
            "presence": [{"name": n, "me": u == user.id} for u, (n, _) in room.items()], "collaborators": collabs}


@app.get("/api/projects/{project_id}/collaborators")
def list_collaborators(project_id: int, request: Request, db: Session = Depends(db_dependency)):
    user, _ = get_session(request, db); project = owned_project(db, user, project_id)
    rows = db.execute(select(User.id, User.display_name, User.email).join(Collaborator, Collaborator.user_id == User.id).where(Collaborator.project_id == project_id)).all()
    owner = db.get(User, project.owner_id); is_owner = project.owner_id == user.id
    return {"owner": {"id": owner.id, "display_name": owner.display_name}, "is_owner": is_owner,
            "collaborators": [{"user_id": r.id, "display_name": r.display_name, **({"email": r.email} if is_owner else {})} for r in rows]}


@app.post("/api/projects/{project_id}/collaborators")
def add_collaborator(project_id: int, payload: CollabIn, request: Request, db: Session = Depends(db_dependency)):
    user, session = get_session(request, db); require_csrf(request, session)
    rate_limit(f"invite:{user.id}", maximum=20)
    project = owned_project(db, user, project_id, owner_only=True)
    target = db.scalar(select(User).where(User.email == str(payload.email).strip().lower()))
    if target is None: raise HTTPException(404, "No LOOM account uses that email. Ask them to sign up first, then invite them.")
    if target.id == project.owner_id: raise HTTPException(400, "That is you — you already own this project.")
    if not db.scalar(select(Collaborator.id).where(Collaborator.project_id == project_id, Collaborator.user_id == target.id)):
        db.add(Collaborator(project_id=project_id, user_id=target.id)); audit(db, user.id, "collab.add", {"project_id": project_id, "user_id": target.id}); db.commit()
    return {"ok": True, "user_id": target.id, "display_name": target.display_name}


@app.delete("/api/projects/{project_id}/collaborators/{user_id}")
def remove_collaborator(project_id: int, user_id: int, request: Request, db: Session = Depends(db_dependency)):
    user, session = get_session(request, db); require_csrf(request, session)
    project = owned_project(db, user, project_id)
    if project.owner_id != user.id and user_id != user.id: raise HTTPException(403, "Only the owner can remove other people.")
    row = db.scalar(select(Collaborator).where(Collaborator.project_id == project_id, Collaborator.user_id == user_id))
    if row: db.delete(row); db.commit()
    return {"ok": True}


# ------------------------------------------------------------------ sharing: public listen page, walkthrough, comments, reactions
EMOJI = {"👍", "🔥", "❤️", "😮", "👏", "🎵"}
MAX_COMMENTS_PER_SHARE = 300
MAX_REACTIONS_PER_SHARE = 3000
CONTROL_CHARS = re.compile(r"[\x00-\x08\x0b-\x1f\x7f]")


def clean_text(value: str, limit: int) -> str:
    return " ".join(CONTROL_CHARS.sub("", value).split())[:limit]


def share_payload(share: ShareLink, db: Session) -> dict[str, Any]:
    comments = db.scalars(select(ShareComment).where(ShareComment.share_id == share.id).order_by(ShareComment.at, ShareComment.id)).all()
    counts: dict[str, int] = {}
    for emoji, n in db.execute(select(ShareReaction.emoji, func.count(ShareReaction.id)).where(ShareReaction.share_id == share.id).group_by(ShareReaction.emoji)).all(): counts[emoji] = n
    return {"exists": True, "token": share.token, "url": f"/share/{share.token}", "title": share.title, "allow_comments": share.allow_comments,
            "walkthrough_asset_id": share.walkthrough_asset_id, "updated_at": share.updated_at.isoformat(), "transcript": json.loads(share.transcript_json or "[]"),
            "comments": [{"id": c.id, "author": c.author, "body": c.body, "at": c.at, "kind": c.kind, "created_at": c.created_at.isoformat()} for c in comments], "reactions": counts}


@app.get("/api/projects/{project_id}/share")
def get_share(project_id: int, request: Request, db: Session = Depends(db_dependency)):
    user, _ = get_session(request, db); owned_project(db, user, project_id, owner_only=True)
    share = db.scalar(select(ShareLink).where(ShareLink.project_id == project_id))
    return share_payload(share, db) if share else {"exists": False}


@app.put("/api/projects/{project_id}/share")
def put_share(project_id: int, payload: ShareIn, request: Request, db: Session = Depends(db_dependency)):
    user, session = get_session(request, db); require_csrf(request, session)
    owned_project(db, user, project_id, owner_only=True)
    if payload.walkthrough_asset_id is not None and not db.scalar(select(AudioAsset.id).where(AudioAsset.id == payload.walkthrough_asset_id, AudioAsset.project_id == project_id, AudioAsset.kind.in_(VIDEO_KINDS))):
        raise HTTPException(400, "That walkthrough video does not belong to this project.")
    share = db.scalar(select(ShareLink).where(ShareLink.project_id == project_id))
    if share is None:
        share = ShareLink(project_id=project_id, token=secrets.token_urlsafe(24), title="", state_json="{}"); db.add(share)
    share.title = clean_text(payload.title, 120) or "Untitled"; share.allow_comments = payload.allow_comments
    share.state_json = json.dumps(payload.state, separators=(",", ":")); share.walkthrough_asset_id = payload.walkthrough_asset_id
    share.transcript_json = json.dumps([{"t": round(s.t, 2), "text": clean_text(s.text, 300)} for s in payload.transcript if clean_text(s.text, 300)], separators=(",", ":"))
    share.updated_at = utc_now(); audit(db, user.id, "share.publish", {"project_id": project_id}); db.commit(); db.refresh(share)
    return share_payload(share, db)


@app.delete("/api/projects/{project_id}/share")
def revoke_share(project_id: int, request: Request, db: Session = Depends(db_dependency)):
    user, session = get_session(request, db); require_csrf(request, session); owned_project(db, user, project_id, owner_only=True)
    share = db.scalar(select(ShareLink).where(ShareLink.project_id == project_id))
    if share: db.delete(share); audit(db, user.id, "share.revoke", {"project_id": project_id}); db.commit()
    return {"ok": True}


@app.delete("/api/projects/{project_id}/share/comments/{comment_id}")
def delete_comment(project_id: int, comment_id: int, request: Request, db: Session = Depends(db_dependency)):
    user, session = get_session(request, db); require_csrf(request, session); owned_project(db, user, project_id, owner_only=True)
    share = db.scalar(select(ShareLink).where(ShareLink.project_id == project_id))
    row = share and db.scalar(select(ShareComment).where(ShareComment.id == comment_id, ShareComment.share_id == share.id))
    if row: db.delete(row); db.commit()
    return {"ok": True}


def share_by_token(db: Session, token: str) -> ShareLink:
    share = db.scalar(select(ShareLink).where(ShareLink.token == token)) if re.fullmatch(r"[A-Za-z0-9_-]{8,64}", token or "") else None
    if share is None: raise HTTPException(404, "This share link does not exist or was turned off.")
    return share


def shared_asset_ids(share: ShareLink) -> set[int]:
    ids: set[int] = set()
    try:
        for t in json.loads(share.state_json).get("tracks", []):
            for c in t.get("clips", []) or []:
                if isinstance(c, dict) and isinstance(c.get("asset"), int): ids.add(c["asset"])
    except (ValueError, AttributeError):
        pass
    return ids


@app.get("/api/public/{token}")
def public_share(token: str, db: Session = Depends(db_dependency)):
    share = share_by_token(db, token); project = db.get(Project, share.project_id); owner = db.get(User, project.owner_id) if project else None
    wt = None
    if share.walkthrough_asset_id:
        a = db.scalar(select(AudioAsset).where(AudioAsset.id == share.walkthrough_asset_id))
        if a: wt = {"asset_id": a.id, "kind": a.kind}
    return JSONResponse({"title": share.title, "author": owner.display_name if owner else "", "allow_comments": share.allow_comments, "state": json.loads(share.state_json),
                         "transcript": json.loads(share.transcript_json or "[]"), "walkthrough": wt, "updated_at": share.updated_at.isoformat()}, headers={"Cache-Control": "no-cache", "Referrer-Policy": "no-referrer"})


def ranged_response(data: bytes, request: Request, media_type: str, headers: dict[str, str]) -> Response:
    """Serve bytes with HTTP Range support so <video> can seek."""
    size = len(data); header = request.headers.get("range", ""); m = re.fullmatch(r"bytes=(\d*)-(\d*)", header.strip())
    base = {**headers, "Accept-Ranges": "bytes"}
    if m and (m.group(1) or m.group(2)):
        start = int(m.group(1)) if m.group(1) else max(0, size - int(m.group(2))); end = int(m.group(2)) if m.group(1) and m.group(2) else size - 1
        end = min(end, size - 1)
        if start >= size or end < start: return Response(status_code=416, headers={**base, "Content-Range": f"bytes */{size}"})
        return Response(data[start:end + 1], status_code=206, media_type=media_type, headers={**base, "Content-Range": f"bytes {start}-{end}/{size}"})
    return Response(data, media_type=media_type, headers=base)


@app.get("/api/public/{token}/media/{asset_id}")
def public_media(token: str, asset_id: int, request: Request, db: Session = Depends(db_dependency)):
    share = share_by_token(db, token)
    if asset_id != share.walkthrough_asset_id and asset_id not in shared_asset_ids(share): raise HTTPException(404, "Media not found")
    asset = db.scalar(select(AudioAsset).where(AudioAsset.id == asset_id, AudioAsset.project_id == share.project_id))
    if not asset: raise HTTPException(404, "Media not found")
    media = {"webmv": "video/webm", "mp4v": "video/mp4"}.get(asset.kind, "application/octet-stream")
    return ranged_response(asset.data, request, media, {"X-Content-Type-Options": "nosniff", "Cache-Control": "public, max-age=300", "Content-Disposition": "inline"})


@app.get("/api/public/{token}/comments")
def public_comments(token: str, db: Session = Depends(db_dependency)):
    share = share_by_token(db, token)
    comments = db.scalars(select(ShareComment).where(ShareComment.share_id == share.id).order_by(ShareComment.at, ShareComment.id)).all()
    reactions = db.execute(select(ShareReaction.emoji, ShareReaction.at).where(ShareReaction.share_id == share.id).order_by(ShareReaction.id.desc()).limit(500)).all()
    return {"allow_comments": share.allow_comments, "comments": [{"id": c.id, "author": c.author, "body": c.body, "at": c.at, "kind": c.kind, "created_at": c.created_at.isoformat()} for c in comments],
            "reactions": [{"emoji": r.emoji, "at": r.at} for r in reactions]}


@app.post("/api/public/{token}/comments")
def public_add_comment(token: str, payload: CommentIn, request: Request, db: Session = Depends(db_dependency)):
    share = share_by_token(db, token)
    if not share.allow_comments: raise HTTPException(403, "Comments are turned off for this page.")
    rate_limit(f"cmt:{share.id}:{request.client.host if request.client else 'unknown'}", maximum=8)
    if (db.scalar(select(func.count(ShareComment.id)).where(ShareComment.share_id == share.id)) or 0) >= MAX_COMMENTS_PER_SHARE: raise HTTPException(429, "This page has reached its comment limit.")
    body = clean_text(payload.body, 500)
    if not body: raise HTTPException(422, "Write something first.")
    row = ShareComment(share_id=share.id, author=clean_text(payload.name, 40) or "Guest", body=body, at=round(payload.at, 2), kind=payload.kind)
    db.add(row); db.commit(); db.refresh(row)
    return {"id": row.id, "author": row.author, "body": row.body, "at": row.at, "kind": row.kind, "created_at": row.created_at.isoformat()}


@app.post("/api/public/{token}/reactions")
def public_add_reaction(token: str, payload: ReactionIn, request: Request, db: Session = Depends(db_dependency)):
    share = share_by_token(db, token)
    if payload.emoji not in EMOJI: raise HTTPException(422, "Unsupported reaction.")
    rate_limit(f"rx:{share.id}:{request.client.host if request.client else 'unknown'}", maximum=40)
    if (db.scalar(select(func.count(ShareReaction.id)).where(ShareReaction.share_id == share.id)) or 0) >= MAX_REACTIONS_PER_SHARE: raise HTTPException(429, "Reaction limit reached.")
    db.add(ShareReaction(share_id=share.id, emoji=payload.emoji, at=round(payload.at, 2))); db.commit()
    return {"ok": True}


@app.get("/api/beats")
def beats() -> Any:
    return json.loads((DATA / "beats.json").read_text(encoding="utf-8"))


@app.get("/api/genres")
def genres() -> Any:
    return json.loads((DATA / "genres.json").read_text(encoding="utf-8"))


@app.get("/api/styles")
def styles() -> Any:
    return json.loads((DATA / "style_recipes.json").read_text(encoding="utf-8"))

@app.get("/api/archive")
def archive() -> Any:
    return json.loads((DATA / "mutopia_snapshot.json").read_text(encoding="utf-8"))

@app.get("/api/data-manifest")
def data_manifest() -> Any:
    return json.loads((DATA / "source_manifest.json").read_text(encoding="utf-8"))

@app.get("/{page:path}")
def pages(page: str):
    clean = page.strip("/")
    if not clean: target = FRONTEND / "index.html"
    elif clean in {"auth", "studio", "learn", "library", "about"}: target = FRONTEND / f"{clean}.html"
    elif re.fullmatch(r"share/[A-Za-z0-9_-]{8,64}", clean): target = FRONTEND / "share.html"
    else: target = FRONTEND / "404.html"
    return FileResponse(target)
