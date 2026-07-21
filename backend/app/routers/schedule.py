import random
import string
import uuid
from datetime import datetime, timedelta, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import or_
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..database import get_db
from ..models.room import (
    Room,
    RoomStatus,
    SCREEN_SHARE_CREATOR_ONLY,
    SCREEN_SHARE_EVERYONE,
    VALID_SCREEN_SHARE_POLICIES,
)
from ..models.scheduled_conference import ConferenceStatus, ScheduledConference
from ..models.scheduled_participant import ScheduledParticipant
from ..models.user import User
from ..websocket.chat import chat_rooms
from ..websocket.signal import rooms as ws_rooms

schedule_router = APIRouter(prefix="/schedule", tags=["Schedule"])


class CreateScheduleRequest(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    description: Optional[str] = Field(default=None, max_length=3000)
    scheduled_start: datetime
    scheduled_end: Optional[datetime] = None
    timezone: str = Field(default="UTC", max_length=50)
    participant_ids: List[str] = Field(default_factory=list)
    participant_emails: List[EmailStr] = Field(default_factory=list)
    camera_on_join: bool = True
    microphone_on_join: bool = True
    screen_share_policy: str = SCREEN_SHARE_EVERYONE


class UpdateScheduleRequest(BaseModel):
    title: Optional[str] = Field(default=None, min_length=1, max_length=255)
    description: Optional[str] = Field(default=None, max_length=3000)
    scheduled_start: Optional[datetime] = None
    scheduled_end: Optional[datetime] = None
    timezone: Optional[str] = Field(default=None, max_length=50)
    participant_ids: Optional[List[str]] = None
    participant_emails: Optional[List[EmailStr]] = None
    camera_on_join: Optional[bool] = None
    microphone_on_join: Optional[bool] = None
    screen_share_policy: Optional[str] = None


class ScheduleResponse(BaseModel):
    id: str
    room_id: Optional[str] = None
    room_invite_code: Optional[str] = None
    title: str
    description: Optional[str] = None
    scheduled_start: str
    scheduled_end: Optional[str] = None
    timezone: str
    status: str
    created_by: str
    created_by_id: str
    participants: List[dict] = Field(default_factory=list)
    camera_on_join: bool
    microphone_on_join: bool
    screen_share_policy: str


def _aware(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _policy(value: str) -> str:
    normalized = str(value).strip().lower()
    if normalized not in VALID_SCREEN_SHARE_POLICIES:
        raise HTTPException(status_code=400, detail="Неизвестная политика демонстрации экрана")
    return normalized


def _invite_code() -> str:
    return "".join(random.choices(string.ascii_uppercase + string.digits, k=6))


def _unique_invite_code(db: Session) -> str:
    code = _invite_code()
    while db.query(Room).filter(Room.invite_code == code).first():
        code = _invite_code()
    return code


def _resolve_participants(
    db: Session,
    creator_id: uuid.UUID,
    participant_ids: list[str] | None,
    participant_emails: list[EmailStr] | None,
) -> list[User]:
    resolved: dict[str, User] = {}

    for value in participant_ids or []:
        try:
            user_id = uuid.UUID(str(value))
        except (ValueError, TypeError):
            continue
        user = db.query(User).filter(User.id == user_id).first()
        if user and user.id != creator_id:
            resolved[str(user.id)] = user

    for value in participant_emails or []:
        email = str(value).strip().lower()
        user = db.query(User).filter(User.email == email).first()
        if user and user.id != creator_id:
            resolved[str(user.id)] = user

    return list(resolved.values())


def _participants(db: Session, scheduled_id: uuid.UUID) -> list[dict]:
    rows = db.query(ScheduledParticipant, User).join(
        User, ScheduledParticipant.user_id == User.id,
    ).filter(
        ScheduledParticipant.scheduled_conference_id == scheduled_id,
    ).all()
    return [
        {"user_id": str(participant.user_id), "username": user.username, "email": user.email}
        for participant, user in rows
    ]


def _serialize(db: Session, scheduled: ScheduledConference, current_user_id: uuid.UUID | None = None) -> dict:
    room = db.query(Room).filter(Room.id == scheduled.room_id).first() if scheduled.room_id else None
    creator = db.query(User).filter(User.id == scheduled.created_by).first()
    participants = _participants(db, scheduled.id)
    return {
        "id": str(scheduled.id),
        "room_id": str(scheduled.room_id) if scheduled.room_id else None,
        "room_invite_code": room.invite_code if room else None,
        "invite_code": room.invite_code if room else None,
        "title": scheduled.title,
        "description": scheduled.description,
        "scheduled_start": scheduled.scheduled_start.isoformat(),
        "scheduled_end": scheduled.scheduled_end.isoformat() if scheduled.scheduled_end else None,
        "timezone": scheduled.timezone,
        "status": scheduled.status.value,
        "created_at": scheduled.created_at.isoformat() if scheduled.created_at else None,
        "created_by": creator.username if creator else "Неизвестный",
        "created_by_id": str(scheduled.created_by),
        "is_creator": current_user_id is not None and scheduled.created_by == current_user_id,
        "participants": participants,
        "participants_count": len(participants),
        "camera_on_join": bool(scheduled.camera_on_join),
        "microphone_on_join": bool(scheduled.microphone_on_join),
        "screen_share_policy": scheduled.screen_share_policy or SCREEN_SHARE_EVERYONE,
    }


async def _close_sockets(invite_code: str, reason: str) -> None:
    clients = list(ws_rooms.pop(invite_code, [])) + list(chat_rooms.pop(invite_code, []))
    for client in clients:
        try:
            await client["ws"].close(code=1000, reason=reason)
        except Exception:
            pass


@schedule_router.post("/", response_model=ScheduleResponse)
async def create_scheduled_conference(
    request: CreateScheduleRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    start = _aware(request.scheduled_start)
    end = _aware(request.scheduled_end) if request.scheduled_end else start + timedelta(hours=1)
    now = datetime.now(timezone.utc)
    if start < now - timedelta(minutes=1):
        raise HTTPException(status_code=400, detail="Нельзя планировать встречу в прошлом")
    if end <= start:
        raise HTTPException(status_code=400, detail="Время окончания должно быть позже времени начала")
    if end - start > timedelta(hours=24):
        raise HTTPException(status_code=400, detail="Длительность встречи не может превышать 24 часа")

    screen_share_policy = _policy(request.screen_share_policy)
    room = Room(
        title=request.title.strip(),
        invite_code=_unique_invite_code(db),
        created_by=current_user.id,
        status=RoomStatus.active,
        camera_on_join=request.camera_on_join,
        microphone_on_join=request.microphone_on_join,
        screen_share_policy=screen_share_policy,
    )
    db.add(room)
    db.flush()

    scheduled = ScheduledConference(
        room_id=room.id,
        created_by=current_user.id,
        title=request.title.strip(),
        description=request.description.strip() if request.description else None,
        scheduled_start=start,
        scheduled_end=end,
        timezone=request.timezone or "UTC",
        status=ConferenceStatus.scheduled,
        camera_on_join=request.camera_on_join,
        microphone_on_join=request.microphone_on_join,
        screen_share_policy=screen_share_policy,
    )
    db.add(scheduled)
    db.flush()

    for user in _resolve_participants(
        db,
        current_user.id,
        request.participant_ids,
        request.participant_emails,
    ):
        db.add(ScheduledParticipant(scheduled_conference_id=scheduled.id, user_id=user.id))

    db.commit()
    db.refresh(scheduled)
    data = _serialize(db, scheduled, current_user.id)
    return ScheduleResponse(**data)


@schedule_router.get("/")
async def get_scheduled_conferences(
    start_date: Optional[datetime] = Query(None),
    end_date: Optional[datetime] = Query(None),
    status: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    invited_ids = db.query(ScheduledParticipant.scheduled_conference_id).filter(
        ScheduledParticipant.user_id == current_user.id,
    )
    query = db.query(ScheduledConference).filter(
        or_(
            ScheduledConference.created_by == current_user.id,
            ScheduledConference.id.in_(invited_ids),
        )
    )
    if start_date:
        query = query.filter(ScheduledConference.scheduled_start >= _aware(start_date))
    if end_date:
        query = query.filter(ScheduledConference.scheduled_start < _aware(end_date))
    if status:
        try:
            query = query.filter(ScheduledConference.status == ConferenceStatus(status))
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="Неизвестный статус встречи") from exc

    meetings = query.order_by(ScheduledConference.scheduled_start).all()
    return {"total": len(meetings), "conferences": [_serialize(db, item, current_user.id) for item in meetings]}


@schedule_router.get("/calendar")
async def get_calendar_view(
    start_date: datetime = Query(...),
    end_date: datetime = Query(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    start = _aware(start_date)
    end = _aware(end_date)
    if end <= start:
        raise HTTPException(status_code=400, detail="Конец периода должен быть позже начала")

    invited_ids = db.query(ScheduledParticipant.scheduled_conference_id).filter(
        ScheduledParticipant.user_id == current_user.id,
    )
    meetings = db.query(ScheduledConference).filter(
        or_(
            ScheduledConference.created_by == current_user.id,
            ScheduledConference.id.in_(invited_ids),
        ),
        ScheduledConference.scheduled_start < end,
        or_(
            ScheduledConference.scheduled_end > start,
            ScheduledConference.scheduled_end.is_(None),
        ),
    ).order_by(ScheduledConference.scheduled_start).all()

    return {
        "start_date": start.isoformat(),
        "end_date": end.isoformat(),
        "total": len(meetings),
        "conferences": [_serialize(db, item, current_user.id) for item in meetings],
    }


@schedule_router.get("/{schedule_id}")
async def get_scheduled_conference(
    schedule_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        sched_uuid = uuid.UUID(schedule_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Неверный ID") from exc

    scheduled = db.query(ScheduledConference).filter(ScheduledConference.id == sched_uuid).first()
    if not scheduled:
        raise HTTPException(status_code=404, detail="Встреча не найдена")
    is_participant = db.query(ScheduledParticipant).filter(
        ScheduledParticipant.scheduled_conference_id == scheduled.id,
        ScheduledParticipant.user_id == current_user.id,
    ).first()
    if scheduled.created_by != current_user.id and not is_participant:
        raise HTTPException(status_code=403, detail="Нет доступа к этой встрече")
    return _serialize(db, scheduled, current_user.id)


@schedule_router.put("/{schedule_id}")
async def update_scheduled_conference(
    schedule_id: str,
    request: UpdateScheduleRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        sched_uuid = uuid.UUID(schedule_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Неверный ID") from exc

    scheduled = db.query(ScheduledConference).filter(ScheduledConference.id == sched_uuid).first()
    if not scheduled:
        raise HTTPException(status_code=404, detail="Встреча не найдена")
    if scheduled.created_by != current_user.id:
        raise HTTPException(status_code=403, detail="Только создатель может редактировать встречу")
    if scheduled.status == ConferenceStatus.cancelled:
        raise HTTPException(status_code=400, detail="Нельзя редактировать отменённую встречу")

    room = db.query(Room).filter(Room.id == scheduled.room_id).first() if scheduled.room_id else None
    if request.title is not None:
        scheduled.title = request.title.strip()
        if room:
            room.title = scheduled.title
    if request.description is not None:
        scheduled.description = request.description.strip() or None
    if request.scheduled_start is not None:
        scheduled.scheduled_start = _aware(request.scheduled_start)
    if request.scheduled_end is not None:
        scheduled.scheduled_end = _aware(request.scheduled_end)
    if scheduled.scheduled_end and scheduled.scheduled_end <= scheduled.scheduled_start:
        raise HTTPException(status_code=400, detail="Время окончания должно быть позже времени начала")
    if request.timezone is not None:
        scheduled.timezone = request.timezone
    if request.camera_on_join is not None:
        scheduled.camera_on_join = request.camera_on_join
        if room:
            room.camera_on_join = request.camera_on_join
    if request.microphone_on_join is not None:
        scheduled.microphone_on_join = request.microphone_on_join
        if room:
            room.microphone_on_join = request.microphone_on_join
    if request.screen_share_policy is not None:
        policy = _policy(request.screen_share_policy)
        scheduled.screen_share_policy = policy
        if room:
            room.screen_share_policy = policy

    if request.participant_ids is not None or request.participant_emails is not None:
        db.query(ScheduledParticipant).filter(
            ScheduledParticipant.scheduled_conference_id == scheduled.id,
        ).delete(synchronize_session=False)
        for user in _resolve_participants(
            db,
            current_user.id,
            request.participant_ids or [],
            request.participant_emails or [],
        ):
            db.add(ScheduledParticipant(scheduled_conference_id=scheduled.id, user_id=user.id))

    db.commit()
    db.refresh(scheduled)
    return _serialize(db, scheduled, current_user.id)


@schedule_router.delete("/{schedule_id}")
async def cancel_scheduled_conference(
    schedule_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        sched_uuid = uuid.UUID(schedule_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Неверный ID") from exc

    scheduled = db.query(ScheduledConference).filter(ScheduledConference.id == sched_uuid).first()
    if not scheduled:
        raise HTTPException(status_code=404, detail="Встреча не найдена")
    if scheduled.created_by != current_user.id:
        raise HTTPException(status_code=403, detail="Только создатель может отменить встречу")
    if scheduled.status == ConferenceStatus.cancelled:
        raise HTTPException(status_code=400, detail="Встреча уже отменена")

    scheduled.status = ConferenceStatus.cancelled
    room = db.query(Room).filter(Room.id == scheduled.room_id).first() if scheduled.room_id else None
    if room and room.status == RoomStatus.active:
        room.status = RoomStatus.ended
        room.ended_at = datetime.now(timezone.utc)
        await _close_sockets(room.invite_code, "Запланированная встреча отменена")
    db.commit()
    return {"message": f"Встреча {scheduled.title} отменена", "id": str(scheduled.id)}
