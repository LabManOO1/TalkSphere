from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from ..database import get_db
from ..models.room import Room, RoomStatus
from pydantic import BaseModel
from typing import Optional
import random
import string
import uuid

rooms_router = APIRouter(prefix="/rooms", tags=["Rooms"])

class CreateRoomRequest(BaseModel):
    title: str

class RoomResponse(BaseModel):
    room_id: str
    invite_code: str
    title: str
    created_at: str
    status: Optional[str] = None

def generate_invite_code():
    return "".join(random.choices(string.ascii_uppercase + string.digits, k=6))

@rooms_router.post("/create", response_model=RoomResponse, summary="Создать комнату")
async def create_room(request: CreateRoomRequest, db: Session = Depends(get_db)):
    invite_code = generate_invite_code()

    while db.query(Room).filter(Room.invite_code == invite_code).first():
        invite_code = generate_invite_code()

    room = Room(title=request.title, invite_code=invite_code, created_by=uuid.uuid4())

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
        raise HTTPException(status_code=404, detail="Room not found")

    return RoomResponse(
        room_id=str(room.id),
        invite_code=room.invite_code,
        title=room.title,
        created_at=room.created_at.isoformat() if room.created_at else "",
        status=room.status.value if room.status else ""
    )