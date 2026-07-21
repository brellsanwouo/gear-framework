from __future__ import annotations

import uuid
from dataclasses import dataclass

from flask import g, session

from gear_sdk.store import BuildStore


@dataclass(frozen=True)
class ParticipantIdentity:
    user_id: str
    session_id: str


def ensure_participant(store_path: str) -> ParticipantIdentity:
    """Return the signed-cookie identity and persist its server-side record."""
    user_id = session.get("gear_user_id")
    session_id = session.get("gear_session_id")
    if not isinstance(user_id, str) or not user_id.startswith("participant-"):
        user_id = f"participant-{uuid.uuid4()}"
        session["gear_user_id"] = user_id
    if not isinstance(session_id, str) or not session_id.startswith("session-"):
        session_id = f"session-{uuid.uuid4()}"
        session["gear_session_id"] = session_id
    session.permanent = True
    identity = ParticipantIdentity(user_id=user_id, session_id=session_id)
    BuildStore(store_path).touch_participant(identity.user_id, identity.session_id)
    g.gear_participant = identity
    return identity


def current_participant() -> ParticipantIdentity:
    identity = getattr(g, "gear_participant", None)
    if not isinstance(identity, ParticipantIdentity):
        raise RuntimeError("Participant identity was not initialized for this request.")
    return identity
