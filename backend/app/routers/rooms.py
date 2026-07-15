from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from ..database import get_db
from ..models.room import Room, RoomStatus
from ..models.participant import RoomParticipant
from ..auth import get_current_user
from ..services.participant_service import ParticipantService
from ..models.user import User
from pydantic import BaseModel
from typing import Optional
from datetime import datetime, timezone
from ..websocket.signal import rooms as ws_rooms
import random
import string
import json

rooms_router = APIRouter(prefix="/rooms", tags=["Rooms"])

class CreateRoomRequest(BaseModel):
    title: str

class RoomResponse(BaseModel):
    room_id: str
    invite_code: str
    title: str
    created_at: str
    status: Optional[str] = None
    participants: list = []
    participants_count: int = 0

def generate_invite_code():
    return "".join(random.choices(string.ascii_uppercase + string.digits, k=6))

@rooms_router.post("/create", response_model=RoomResponse, summary="Создать комнату")
async def create_room(request: CreateRoomRequest, db: Session = Depends(get_db),
                      current_user: User = Depends(get_current_user)):
    invite_code = generate_invite_code()

    while db.query(Room).filter(Room.invite_code == invite_code).first():
        invite_code = generate_invite_code()

    room = Room(title=request.title, invite_code=invite_code, created_by=current_user.id)

    db.add(room)
    db.commit()
    db.refresh(room)

    return RoomResponse(
        room_id=str(room.id),
        invite_code=room.invite_code,
        title=room.title,
        created_at=room.created_at.isoformat() if room.created_at else "",
    )

@rooms_router.get("/{invite_code}", response_model=RoomResponse, summary="Получить данные о комнате по invite-коду")
async def get_room(invite_code: str, db: Session = Depends(get_db)):
    room = db.query(Room).filter(Room.invite_code == invite_code).first()
    if not room:
        raise HTTPException(status_code=404, detail="Комната не найдена")

    participants_data = ParticipantService.get_participants_with_users(db, room.id)

    participants_list = []
    for participant, user in participants_data:
        participants_list.append({
            "user_id": str(user.id),
            "username": user.username,
            "joined_at": participant.joined_at.isoformat() if participant.joined_at else None,
            "is_muted": participant.is_muted,
            "is_video_off": participant.is_video_off,
            "is_screen_sharing": participant.is_screen_sharing,
            "role": participant.role.value if participant.role else "speaker"
        })

    return RoomResponse(
        room_id=str(room.id),
        invite_code=room.invite_code,
        title=room.title,
        created_at=room.created_at.isoformat() if room.created_at else "",
        status=room.status.value if room.status else "",
        participants=participants_list,
        participants_count=len(participants_list)
    )


@rooms_router.delete("/{invite_code}", summary="Удалить комнату (только для создателя)")
async def delete_room(
        invite_code: str,
        db: Session = Depends(get_db),
        current_user: User = Depends(get_current_user)
):
    room = db.query(Room).filter(Room.invite_code == invite_code).first()
    if not room:
        raise HTTPException(status_code=404, detail="Комната не найдена")

    if room.created_by != current_user.id:
        raise HTTPException(
            status_code=403,
            detail="Только создатель может удалить комнату"
        )

    if room.status == RoomStatus.ended:
        raise HTTPException(status_code=400, detail="Комната уже завершена")

    if invite_code in ws_rooms:
        clients = ws_rooms[invite_code]

        for client in clients:
            try:
                await client.close(code=1000, reason="Комната завершена создателем")
            except Exception as e:
                print(f"Ошибка при закрытии соединения: {e}")

        del ws_rooms[invite_code]
        print(f"WebSocket-комната {invite_code} удалена из памяти")

    participants = ParticipantService.get_participants(db, room.id)
    for participant in participants:
        ParticipantService.remove_participant(db, room.id, participant.user_id)

    room.status = RoomStatus.ended
    room.ended_at = datetime.now(timezone.utc)
    db.commit()

    return {
        "message": f"Комната {invite_code} успешно завершена",
        "room_id": str(room.id),
        "status": room.status.value
    }


@rooms_router.post("/{invite_code}/leave", summary="Выход из комнаты")
async def leave_room(
        invite_code: str,
        db: Session = Depends(get_db),
        current_user: User = Depends(get_current_user)
):
    room = db.query(Room).filter(Room.invite_code == invite_code).first()
    if not room:
        raise HTTPException(status_code=404, detail="Комната не найдена")

    if room.status != RoomStatus.active:
        raise HTTPException(status_code=400, detail="Комната не активна")

    participant = db.query(RoomParticipant).filter(
        RoomParticipant.room_id == room.id,
        RoomParticipant.user_id == current_user.id,
        RoomParticipant.left_at.is_(None)
    ).first()

    if not participant:
        raise HTTPException(status_code=404, detail="Вы не находитесь в этой комнате")

    ParticipantService.remove_participant(db, room.id, current_user.id)

    if invite_code in ws_rooms:
        ws_rooms[invite_code] = [
            ws_info for ws_info in ws_rooms[invite_code]
            if ws_info["user_id"] != current_user.id
        ]

        if not ws_rooms[invite_code]:
            for ws_info in ws_rooms[invite_code]:
                try:
                    await ws_info["ws"].close(code=1000, reason="Комната опустела")
                except Exception as e:
                    print(f"Ошибка при закрытии соединения: {e}")

            del ws_rooms[invite_code]
            print(f"WebSocket-комната {invite_code} удалена из памяти")

            room.status = RoomStatus.ended
            room.ended_at = datetime.now(timezone.utc)
            db.commit()
            print(f"Комната {invite_code} завершена в БД (статус ended)")

    return {
        "message": f"Вы вышли из комнаты {invite_code}",
        "room_id": str(room.id),
        "room_status": room.status.value
    }


class UpdateParticipantStatusRequest(BaseModel):
    is_muted: Optional[bool] = None
    is_video_off: Optional[bool] = None
    is_screen_sharing: Optional[bool] = None


@rooms_router.patch("/{invite_code}/participants/status", summary="Обновление статуса участника")
async def update_participant_status(
        invite_code: str,
        request: UpdateParticipantStatusRequest,
        db: Session = Depends(get_db),
        current_user: User = Depends(get_current_user)
):
    room = db.query(Room).filter(Room.invite_code == invite_code).first()
    if not room:
        raise HTTPException(status_code=404, detail="Комната не найдена")

    if room.status != RoomStatus.active:
        raise HTTPException(status_code=400, detail="Комната не активна")

    participant = db.query(RoomParticipant).filter(
        RoomParticipant.room_id == room.id,
        RoomParticipant.user_id == current_user.id,
        RoomParticipant.left_at.is_(None)
    ).first()

    if not participant:
        raise HTTPException(status_code=404, detail="Пользователь не находится в этой комнате")

    if request.is_muted is not None:
        participant.is_muted = request.is_muted
    if request.is_video_off is not None:
        participant.is_video_off = request.is_video_off
    if request.is_screen_sharing is not None:
        participant.is_screen_sharing = request.is_screen_sharing

    db.commit()

    if invite_code in ws_rooms:
        status_update = {
            "type": "status_update",
            "user_id": str(current_user.id),
            "username": current_user.username,
            "is_muted": participant.is_muted,
            "is_video_off": participant.is_video_off,
            "is_screen_sharing": participant.is_screen_sharing
        }

        for ws_info in ws_rooms[invite_code]:
            if ws_info["user_id"] != current_user.id:
                try:
                    await ws_info["ws"].send_text(json.dumps(status_update))
                except Exception as e:
                    print(f"Ошибка отправки статуса: {e}")

    return {
        "message": "Статус участника обновлён",
        "status": {
            "is_muted": participant.is_muted,
            "is_video_off": participant.is_video_off,
            "is_screen_sharing": participant.is_screen_sharing
        }
    }

@rooms_router.get("/", summary="Получить список всех активных комнат")
async def get_rooms(
        db: Session = Depends(get_db)
):

    rooms_list = db.query(Room).filter(Room.status == RoomStatus.active).all()

    result = []
    for room in rooms_list:
        creator = db.query(User).filter(User.id == room.created_by).first()
        creator_name = creator.username if creator else "Неизвестный"

        participants = ParticipantService.get_participants(db, room.id)
        participants_count = len(participants)

        result.append({
            "room_id": str(room.id),
            "invite_code": room.invite_code,
            "title": room.title,
            "created_by": creator_name,
            "created_at": room.created_at.isoformat() if room.created_at else None,
            "participants_count": participants_count,
            "status": room.status.value
        })

    return {
        "total": len(result),
        "rooms": result
    }