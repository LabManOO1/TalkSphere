from fastapi import WebSocket, WebSocketDisconnect, APIRouter, HTTPException
from typing import Dict, List
from app.auth import get_current_user_ws
from app.database import SessionLocal
from app.models.room import Room
from app.models.participant import RoomParticipant, ParticipantRole
from app.services.participant_service import ParticipantService

signal_router = APIRouter()
rooms: Dict[str, List[WebSocket]] = {}


@signal_router.websocket("/ws/signal/{invite_code}")
async def signal_endpoint(
    websocket: WebSocket,
    invite_code: str,
    token: str = None
):
    if token is None:
        await websocket.close(code=1008, reason="Token required")
        return

    try:
        user = await get_current_user_ws(token)
        print(f"Пользователь {user.username} подключается")
    except HTTPException:
        await websocket.close(code=1008, reason="Invalid token")
        return

    db = SessionLocal()
    try:
        room = db.query(Room).filter(Room.invite_code == invite_code).first()
        if not room:
            await websocket.close(code=1008, reason="Комната не найдена")
            return
        room_id = room.id
        print(f"Найдена комната {invite_code} с UUID {room_id}")
    except Exception as e:
        await websocket.close(code=1008, reason="Ошибка при поиске комнаты")
        return
    finally:
        db.close()

    await websocket.accept()

    db = SessionLocal()
    try:
        participant = ParticipantService.add_participant(
            db,
            room_id=room_id,
            user_id=user.id,
            role=ParticipantRole.speaker
        )
        print(f"{user.username} сохранён в БД")
    except Exception as e:
        print(f"Ошибка при сохранении участника в БД: {e}")
    finally:
        db.close()

    if invite_code not in rooms:
        rooms[invite_code] = []
    rooms[invite_code].append(websocket)

    try:
        while True:
            data = await websocket.receive_text()
            print(f"📩 Сообщение от {user.username} в комнате {invite_code}")

            for client in rooms[invite_code]:
                if client != websocket:
                    try:
                        await client.send_text(data)
                    except Exception as e:
                        print(f"Ошибка отправки: {e}")

    except WebSocketDisconnect:
        print(f"{user.username} отключился")

        db = SessionLocal()
        try:
            ParticipantService.remove_participant(db, room_id=room_id, user_id=user.id)
            print(f"{user.username} удалён из БД")
        except Exception as e:
            print(f"Ошибка при удалении участника из БД: {e}")
        finally:
            db.close()

        if invite_code in rooms:
            rooms[invite_code].remove(websocket)
            if not rooms[invite_code]:
                del rooms[invite_code]
                print(f"Комната {invite_code} удалена")

    except Exception as e:
        print(f"Ошибка в WebSocket: {e}")