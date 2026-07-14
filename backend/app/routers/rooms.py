from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from ..database import get_db
from ..models.room import Room, RoomStatus
from ..auth import get_current_user
from ..services.participant_service import ParticipantService
from ..models.user import User
from pydantic import BaseModel
from typing import Optional
from datetime import datetime, timezone
from ..websocket.signal import rooms as ws_rooms
import random
import string

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