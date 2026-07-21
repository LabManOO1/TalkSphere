from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import and_, or_
from ..database import get_db
from ..auth import get_current_user
from ..models.user import User
from ..models.room import Room, RoomStatus
from ..models.scheduled_conference import ScheduledConference, ConferenceStatus
from ..models.scheduled_participant import ScheduledParticipant
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, timezone, timedelta
import uuid
import random
import string

schedule_router = APIRouter(prefix="/schedule", tags=["Schedule"])

class CreateScheduleRequest(BaseModel):
    title: str
    description: Optional[str] = None
    scheduled_start: datetime
    scheduled_end: Optional[datetime] = None
    timezone: Optional[str] = "UTC"
    participant_ids: Optional[List[str]] = []


class UpdateScheduleRequest(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    scheduled_start: Optional[datetime] = None
    scheduled_end: Optional[datetime] = None
    timezone: Optional[str] = None
    participant_ids: Optional[List[str]] = []


class ScheduleResponse(BaseModel):
    id: str
    room_id: Optional[str] = None
    room_invite_code: Optional[str] = None
    title: str
    description: Optional[str] = None
    scheduled_start: str
    scheduled_end: Optional[str] = None  # теперь необязательно
    timezone: str
    status: str
    created_by: str
    participants: List[dict] = []


def generate_invite_code():
    return "".join(random.choices(string.ascii_uppercase + string.digits, k=6))


@schedule_router.post("/", response_model=ScheduleResponse, summary="Создать запланированную встречу")
async def create_scheduled_conference(
        request: CreateScheduleRequest,
        db: Session = Depends(get_db),
        current_user: User = Depends(get_current_user)
):
    if request.scheduled_start < datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="Нельзя планировать встречу в прошлом")

    if request.scheduled_end is not None and request.scheduled_start >= request.scheduled_end:
        raise HTTPException(status_code=400, detail="Время окончания должно быть позже времени начала")

    invite_code = generate_invite_code()
    while db.query(Room).filter(Room.invite_code == invite_code).first():
        invite_code = generate_invite_code()

    room = Room(
        title=request.title,
        invite_code=invite_code,
        created_by=current_user.id,
        status=RoomStatus.active
    )
    db.add(room)
    db.flush()

    scheduled = ScheduledConference(
        room_id=room.id,
        created_by=current_user.id,
        title=request.title,
        description=request.description,
        scheduled_start=request.scheduled_start,
        scheduled_end=request.scheduled_end,
        timezone=request.timezone,
        status=ConferenceStatus.scheduled
    )
    db.add(scheduled)
    db.flush()

    participant_objects = []
    for user_id_str in request.participant_ids:
        try:
            user_id = uuid.UUID(user_id_str)
            user = db.query(User).filter(User.id == user_id).first()
            if user:
                sp = ScheduledParticipant(
                    scheduled_conference_id=scheduled.id,
                    user_id=user_id
                )
                db.add(sp)
                participant_objects.append(user)
        except ValueError:
            pass

    db.commit()
    db.refresh(room)
    db.refresh(scheduled)

    return ScheduleResponse(
        id=str(scheduled.id),
        room_id=str(room.id),
        room_invite_code=room.invite_code,
        title=scheduled.title,
        description=scheduled.description,
        scheduled_start=scheduled.scheduled_start.isoformat(),
        scheduled_end=scheduled.scheduled_end.isoformat() if scheduled.scheduled_end else None,
        timezone=scheduled.timezone,
        status=scheduled.status.value,
        created_by=current_user.username,
        participants=[
            {
                "user_id": str(u.id),
                "username": u.username,
                "email": u.email
            }
            for u in participant_objects
        ]
    )


@schedule_router.get("/", summary="Получить список запланированных встреч")
async def get_scheduled_conferences(
        start_date: Optional[datetime] = Query(None, description="Начало периода (ISO)"),
        end_date: Optional[datetime] = Query(None, description="Конец периода (ISO)"),
        status: Optional[str] = Query(None, description="Фильтр по статусу"),
        db: Session = Depends(get_db),
        current_user: User = Depends(get_current_user)
):
    query = db.query(ScheduledConference).filter(
        ScheduledConference.created_by == current_user.id
    )

    if start_date:
        query = query.filter(ScheduledConference.scheduled_start >= start_date)
    if end_date:
        query = query.filter(ScheduledConference.scheduled_start <= end_date)
    if status:
        try:
            query = query.filter(ScheduledConference.status == ConferenceStatus(status))
        except ValueError:
            pass

    scheduled_list = query.order_by(ScheduledConference.scheduled_start).all()

    result = []
    for s in scheduled_list:
        room = db.query(Room).filter(Room.id == s.room_id).first()
        result.append({
            "id": str(s.id),
            "room_id": str(s.room_id) if s.room_id else None,
            "invite_code": room.invite_code if room else None,
            "title": s.title,
            "description": s.description,
            "scheduled_start": s.scheduled_start.isoformat(),
            "scheduled_end": s.scheduled_end.isoformat() if s.scheduled_end else None,
            "timezone": s.timezone,
            "status": s.status.value,
            "created_at": s.created_at.isoformat() if s.created_at else None
        })

    return {
        "total": len(result),
        "conferences": result
    }


@schedule_router.get("/calendar", summary="Получить встречи для календаря (день/неделя/месяц)")
async def get_calendar_view(
        start_date: datetime = Query(..., description="Начало периода (ISO)"),
        end_date: datetime = Query(..., description="Конец периода (ISO)"),
        db: Session = Depends(get_db),
        current_user: User = Depends(get_current_user)
):
    created = db.query(ScheduledConference).filter(
        ScheduledConference.created_by == current_user.id,
        ScheduledConference.scheduled_start < end_date,
        or_(
            ScheduledConference.scheduled_end > start_date,
            ScheduledConference.scheduled_end.is_(None)
        )
    ).all()

    participant_ids = db.query(ScheduledParticipant.scheduled_conference_id).filter(
        ScheduledParticipant.user_id == current_user.id
    ).subquery()

    invited = db.query(ScheduledConference).filter(
        ScheduledConference.id.in_(participant_ids),
        ScheduledConference.scheduled_start < end_date,
        or_(
            ScheduledConference.scheduled_end > start_date,
            ScheduledConference.scheduled_end.is_(None)
        )
    ).all()

    all_meetings = {str(m.id): m for m in created}
    for m in invited:
        if str(m.id) not in all_meetings:
            all_meetings[str(m.id)] = m

    result = []
    for m in all_meetings.values():
        room = db.query(Room).filter(Room.id == m.room_id).first()
        result.append({
            "id": str(m.id),
            "room_id": str(m.room_id) if m.room_id else None,
            "invite_code": room.invite_code if room else None,
            "title": m.title,
            "description": m.description,
            "scheduled_start": m.scheduled_start.isoformat(),
            "scheduled_end": m.scheduled_end.isoformat() if m.scheduled_end else None,
            "timezone": m.timezone,
            "status": m.status.value,
            "is_creator": str(m.created_by) == str(current_user.id)
        })

    return {
        "start_date": start_date.isoformat(),
        "end_date": end_date.isoformat(),
        "total": len(result),
        "conferences": result
    }


@schedule_router.get("/{schedule_id}", summary="Получить детали запланированной встречи")
async def get_scheduled_conference(
        schedule_id: str,
        db: Session = Depends(get_db),
        current_user: User = Depends(get_current_user)
):
    try:
        sched_uuid = uuid.UUID(schedule_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Неверный ID")

    scheduled = db.query(ScheduledConference).filter(
        ScheduledConference.id == sched_uuid
    ).first()

    if not scheduled:
        raise HTTPException(status_code=404, detail="Встреча не найдена")

    if scheduled.created_by != current_user.id:
        is_participant = db.query(ScheduledParticipant).filter(
            ScheduledParticipant.scheduled_conference_id == scheduled.id,
            ScheduledParticipant.user_id == current_user.id
        ).first()
        if not is_participant:
            raise HTTPException(status_code=403, detail="Нет доступа к этой встрече")

    room = db.query(Room).filter(Room.id == scheduled.room_id).first()

    participants = db.query(ScheduledParticipant, User).join(
        User, ScheduledParticipant.user_id == User.id
    ).filter(
        ScheduledParticipant.scheduled_conference_id == scheduled.id
    ).all()

    return {
        "id": str(scheduled.id),
        "room_id": str(scheduled.room_id) if scheduled.room_id else None,
        "invite_code": room.invite_code if room else None,
        "title": scheduled.title,
        "description": scheduled.description,
        "scheduled_start": scheduled.scheduled_start.isoformat(),
        "scheduled_end": scheduled.scheduled_end.isoformat() if scheduled.scheduled_end else None,
        "timezone": scheduled.timezone,
        "status": scheduled.status.value,
        "created_at": scheduled.created_at.isoformat() if scheduled.created_at else None,
        "created_by": current_user.username,
        "participants": [
            {
                "user_id": str(p.user_id),
                "username": u.username,
                "email": u.email
            }
            for p, u in participants
        ]
    }


@schedule_router.put("/{schedule_id}", summary="Обновить запланированную встречу")
async def update_scheduled_conference(
        schedule_id: str,
        request: UpdateScheduleRequest,
        db: Session = Depends(get_db),
        current_user: User = Depends(get_current_user)
):
    try:
        sched_uuid = uuid.UUID(schedule_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Неверный ID")

    scheduled = db.query(ScheduledConference).filter(
        ScheduledConference.id == sched_uuid
    ).first()

    if not scheduled:
        raise HTTPException(status_code=404, detail="Встреча не найдена")

    if scheduled.created_by != current_user.id:
        raise HTTPException(status_code=403, detail="Только создатель может редактировать встречу")

    if scheduled.status == ConferenceStatus.cancelled:
        raise HTTPException(status_code=400, detail="Нельзя редактировать отменённую встречу")

    if request.title is not None:
        scheduled.title = request.title
        if scheduled.room_id:
            room = db.query(Room).filter(Room.id == scheduled.room_id).first()
            if room:
                room.title = request.title

    if request.description is not None:
        scheduled.description = request.description

    if request.scheduled_start is not None:
        if request.scheduled_start < datetime.now(timezone.utc):
            raise HTTPException(status_code=400, detail="Нельзя переносить встречу в прошлое")
        scheduled.scheduled_start = request.scheduled_start

    if request.scheduled_end is not None:
        scheduled.scheduled_end = request.scheduled_end

    if request.timezone is not None:
        scheduled.timezone = request.timezone

    # Обновляем участников
    if request.participant_ids is not None:
        db.query(ScheduledParticipant).filter(
            ScheduledParticipant.scheduled_conference_id == scheduled.id
        ).delete()

        for user_id_str in request.participant_ids:
            try:
                user_id = uuid.UUID(user_id_str)
                user = db.query(User).filter(User.id == user_id).first()
                if user:
                    sp = ScheduledParticipant(
                        scheduled_conference_id=scheduled.id,
                        user_id=user_id
                    )
                    db.add(sp)
            except ValueError:
                pass

    db.commit()

    return {
        "message": "Встреча обновлена",
        "id": str(scheduled.id)
    }


@schedule_router.delete("/{schedule_id}", summary="Отменить запланированную встречу")
async def cancel_scheduled_conference(
        schedule_id: str,
        db: Session = Depends(get_db),
        current_user: User = Depends(get_current_user)
):
    try:
        sched_uuid = uuid.UUID(schedule_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Неверный ID")

    scheduled = db.query(ScheduledConference).filter(
        ScheduledConference.id == sched_uuid
    ).first()

    if not scheduled:
        raise HTTPException(status_code=404, detail="Встреча не найдена")

    if scheduled.created_by != current_user.id:
        raise HTTPException(status_code=403, detail="Только создатель может отменить встречу")

    if scheduled.status == ConferenceStatus.cancelled:
        raise HTTPException(status_code=400, detail="Встреча уже отменена")

    scheduled.status = ConferenceStatus.cancelled

    if scheduled.room_id:
        room = db.query(Room).filter(Room.id == scheduled.room_id).first()
        if room and room.status == RoomStatus.active:
            room.status = RoomStatus.ended
            room.ended_at = datetime.now(timezone.utc)

    db.commit()

    return {
        "message": f"Встреча {scheduled.title} отменена",
        "id": str(scheduled.id)
    }