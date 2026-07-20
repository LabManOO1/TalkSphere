import json
import uuid
from typing import Dict, List, Any, Optional
from fastapi import WebSocket, WebSocketDisconnect, APIRouter, HTTPException
from ..auth import get_current_user_ws
from ..database import SessionLocal
from ..models.room import Room, RoomStatus
from ..services.chat_service import ChatService

chat_router = APIRouter()

chat_rooms: Dict[str, List[Dict[str, Any]]] = {}


@chat_router.websocket("/ws/chat/{invite_code}")
async def chat_endpoint(
        websocket: WebSocket,
        invite_code: str,
        token: Optional[str] = None,
):
    if not token:
        await websocket.close(code=1008, reason="Token required")
        return

    try:
        user = await get_current_user_ws(token)
    except HTTPException:
        await websocket.close(code=1008, reason="Invalid token")
        return

    db = SessionLocal()
    try:
        room = db.query(Room).filter(Room.invite_code == invite_code).first()
        if not room:
            await websocket.close(code=1008, reason="Комната не найдена")
            return
        if room.status != RoomStatus.active:
            await websocket.close(code=1008, reason="Конференция уже завершена")
            return
        room_id = room.id
    except Exception as e:
        print(f"Ошибка поиска комнаты: {e}")
        await websocket.close(code=1011, reason="Ошибка при поиске комнаты")
        return
    finally:
        db.close()

    await websocket.accept()

    if invite_code not in chat_rooms:
        chat_rooms[invite_code] = []

    client_info = {
        "ws": websocket,
        "user_id": user.id,
        "username": user.username
    }
    chat_rooms[invite_code].append(client_info)

    db = SessionLocal()
    try:
        messages_with_users = ChatService.get_messages_with_users(db, room_id)
        history = []
        for message, msg_user in messages_with_users:
            history.append({
                "id": str(message.id),
                "user_id": str(msg_user.id),
                "username": msg_user.username,
                "content": message.content,
                "sent_at": message.sent_at.isoformat() if message.sent_at else None
            })

        await websocket.send_text(json.dumps({
            "type": "history",
            "messages": history
        }))
    except Exception as e:
        print(f"Ошибка загрузки истории: {e}")
    finally:
        db.close()

    await broadcast_chat(invite_code, {
        "type": "user_joined",
        "user_id": str(user.id),
        "username": user.username
    }, exclude_ws=websocket)

    try:
        while True:
            raw_data = await websocket.receive_text()

            try:
                payload = json.loads(raw_data)
            except json.JSONDecodeError:
                continue

            message_type = payload.get("type")

            if message_type == "delete_message":
                message_id = payload.get("message_id")
                if not message_id:
                    continue

                db = SessionLocal()
                try:
                    success = ChatService.delete_message(db, uuid.UUID(message_id), user.id)
                    if success:
                        await broadcast_chat(invite_code, {
                            "type": "message_deleted",
                            "message_id": message_id
                        }, exclude_ws=None)
                except Exception as e:
                    print(f"Ошибка удаления сообщения: {e}")
                finally:
                    db.close()
                continue

            content = payload.get("content", "").strip()
            if not content:
                continue

            db = SessionLocal()
            try:
                message = ChatService.save_message(db, room_id, user.id, content)

                await broadcast_chat(invite_code, {
                    "type": "message",
                    "id": str(message.id),
                    "user_id": str(user.id),
                    "username": user.username,
                    "content": message.content,
                    "sent_at": message.sent_at.isoformat() if message.sent_at else None
                }, exclude_ws=None)

            except Exception as e:
                print(f"Ошибка сохранения сообщения: {e}")
            finally:
                db.close()

    except WebSocketDisconnect:
        pass
    except Exception as e:
        print(f"Ошибка WebSocket чата: {e}")

    finally:
        if invite_code in chat_rooms:
            chat_rooms[invite_code] = [
                c for c in chat_rooms[invite_code]
                if c["ws"] != websocket
            ]
            if not chat_rooms[invite_code]:
                del chat_rooms[invite_code]

        await broadcast_chat(invite_code, {
            "type": "user_left",
            "user_id": str(user.id),
            "username": user.username
        }, exclude_ws=None)


async def broadcast_chat(invite_code: str, payload: dict, exclude_ws: Optional[WebSocket] = None):
    clients = chat_rooms.get(invite_code, [])
    for client in clients:
        if exclude_ws is not None and client["ws"] == exclude_ws:
            continue
        try:
            await client["ws"].send_text(json.dumps(payload))
        except Exception:
            pass