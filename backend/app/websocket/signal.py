import json
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect

from app.auth import get_current_user_ws
from app.database import SessionLocal
from app.models.participant import ParticipantRole
from app.models.room import Room, RoomStatus
from app.services.participant_service import ParticipantService


signal_router = APIRouter()

# {
#     "INVITE_CODE": [
#         {
#             "ws": WebSocket,
#             "user_id": UUID,
#             "username": str,
#             "client_id": str | None,
#             "is_muted": bool,
#             "is_video_off": bool,
#             "is_screen_sharing": bool,
#         }
#     ]
# }
rooms: Dict[str, List[Dict[str, Any]]] = {}


async def send_payload(client: Dict[str, Any], payload: dict) -> bool:
    websocket = client.get("ws")

    if websocket is None:
        return False

    try:
        await websocket.send_text(json.dumps(payload))
        return True
    except Exception as error:
        print(f"Ошибка отправки WebSocket-сообщения: {error}")
        return False


async def broadcast(
    invite_code: str,
    payload: dict,
    exclude_ws: Optional[WebSocket] = None,
    target_client_id: Optional[str] = None,
    target_user_id: Optional[str] = None,
):
    clients = list(rooms.get(invite_code, []))

    for client in clients:
        client_ws = client.get("ws")
        client_id = client.get("client_id")
        client_user_id = str(client.get("user_id"))

        if exclude_ws is not None and client_ws is exclude_ws:
            continue

        if target_client_id is not None and str(client_id) != str(target_client_id):
            continue

        if target_user_id is not None and client_user_id != str(target_user_id):
            continue

        await send_payload(client, payload)


def remove_connection(invite_code: str, websocket: WebSocket):
    current_clients = rooms.get(invite_code, [])

    remaining_clients = [
        client
        for client in current_clients
        if client.get("ws") is not websocket
    ]

    if remaining_clients:
        rooms[invite_code] = remaining_clients
    else:
        rooms.pop(invite_code, None)

    return remaining_clients


def serialize_participant(client: Dict[str, Any]) -> Dict[str, Any]:
    user_id = str(client.get("user_id"))
    client_id = client.get("client_id")

    return {
        "clientId": client_id,
        "client_id": client_id,
        "userId": user_id,
        "user_id": user_id,
        "username": client.get("username", "Участник"),
        "isMuted": bool(client.get("is_muted", False)),
        "is_muted": bool(client.get("is_muted", False)),
        "isVideoOff": bool(client.get("is_video_off", False)),
        "is_video_off": bool(client.get("is_video_off", False)),
        "isScreenSharing": bool(client.get("is_screen_sharing", False)),
        "is_screen_sharing": bool(client.get("is_screen_sharing", False)),
    }


@signal_router.websocket("/ws/signal/{invite_code}")
async def signal_endpoint(
    websocket: WebSocket,
    invite_code: str,
    token: Optional[str] = None,
):
    user = None
    room_id = None
    connection_registered = False
    current_client: Optional[Dict[str, Any]] = None

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
        room = (
            db.query(Room)
            .filter(Room.invite_code == invite_code)
            .first()
        )

        if room is None:
            await websocket.close(code=1008, reason="Комната не найдена")
            return

        if room.status != RoomStatus.active:
            await websocket.close(code=1008, reason="Конференция уже завершена")
            return

        room_id = room.id
    except Exception as error:
        print(f"Ошибка поиска комнаты: {error}")
        await websocket.close(code=1011, reason="Ошибка при поиске комнаты")
        return
    finally:
        db.close()

    await websocket.accept()

    room_clients = rooms.setdefault(invite_code, [])

    # Новое подключение той же учетной записи заменяет старое, но перед
    # закрытием старый клиент получает понятное событие для интерфейса.
    old_connections = [
        client
        for client in room_clients
        if str(client.get("user_id")) == str(user.id)
    ]

    room_clients[:] = [
        client
        for client in room_clients
        if str(client.get("user_id")) != str(user.id)
    ]

    existing_participants = [serialize_participant(client) for client in room_clients]

    current_client = {
        "ws": websocket,
        "user_id": user.id,
        "username": user.username,
        "client_id": None,
        "is_muted": False,
        "is_video_off": False,
        "is_screen_sharing": False,
    }

    room_clients.append(current_client)
    connection_registered = True

    # Новое соединение уже зарегистрировано, поэтому finally старого сокета
    # увидит замену и не удалит участника из комнаты/БД.
    for old_client in old_connections:
        try:
            await send_payload(
                old_client,
                {
                    "type": "duplicate-session",
                    "userId": str(user.id),
                    "user_id": str(user.id),
                    "username": user.username,
                },
            )
            await old_client["ws"].close(
                code=4001,
                reason="Открыто новое подключение",
            )
        except Exception:
            pass

    db = SessionLocal()

    try:
        ParticipantService.add_participant(
            db,
            room_id=room_id,
            user_id=user.id,
            role=ParticipantRole.speaker,
        )
    except Exception as error:
        print(f"Ошибка сохранения участника: {error}")
    finally:
        db.close()

    await websocket.send_text(
        json.dumps(
            {
                "type": "room_state",
                "participants": existing_participants,
            }
        )
    )

    try:
        while True:
            raw_data = await websocket.receive_text()

            try:
                payload = json.loads(raw_data)
            except json.JSONDecodeError:
                continue

            if not isinstance(payload, dict):
                continue

            incoming_client_id = (
                payload.get("from")
                or payload.get("clientId")
                or payload.get("client_id")
            )

            if incoming_client_id:
                current_client["client_id"] = str(incoming_client_id)

            client_id = current_client.get("client_id") or str(user.id)
            message_type = payload.get("type")

            # Сервер не доверяет идентификаторам пользователя из браузера и
            # всегда записывает канонические значения в обоих форматах полей.
            payload["from"] = client_id
            payload["clientId"] = client_id
            payload["client_id"] = client_id
            payload["userId"] = str(user.id)
            payload["user_id"] = str(user.id)
            payload["from_user_id"] = str(user.id)
            payload["username"] = user.username
            payload["from_username"] = user.username

            target_client_id = payload.get("target") or payload.get("target_client_id")
            target_user_id = payload.get("target_user_id")

            if target_client_id is not None:
                payload["target"] = str(target_client_id)
                payload["target_client_id"] = str(target_client_id)

            if message_type == "media-status":
                current_client["is_muted"] = bool(
                    payload.get("isMuted", payload.get("is_muted", False))
                )
                current_client["is_video_off"] = bool(
                    payload.get("isVideoOff", payload.get("is_video_off", False))
                )
                current_client["is_screen_sharing"] = bool(
                    payload.get(
                        "isScreenSharing",
                        payload.get("is_screen_sharing", False),
                    )
                )

                payload["isMuted"] = current_client["is_muted"]
                payload["is_muted"] = current_client["is_muted"]
                payload["isVideoOff"] = current_client["is_video_off"]
                payload["is_video_off"] = current_client["is_video_off"]
                payload["isScreenSharing"] = current_client["is_screen_sharing"]
                payload["is_screen_sharing"] = current_client["is_screen_sharing"]

            await broadcast(
                invite_code,
                payload,
                exclude_ws=websocket,
                target_client_id=(
                    str(target_client_id) if target_client_id is not None else None
                ),
                target_user_id=(
                    str(target_user_id) if target_user_id is not None else None
                ),
            )

    except WebSocketDisconnect:
        pass
    except Exception as error:
        print(f"Ошибка WebSocket пользователя {user.username}: {error}")
    finally:
        if not connection_registered:
            return

        remaining_clients = remove_connection(invite_code, websocket)

        same_user_still_connected = any(
            str(client.get("user_id")) == str(user.id)
            for client in remaining_clients
        )

        if same_user_still_connected:
            return

        db = SessionLocal()

        try:
            ParticipantService.remove_participant(
                db,
                room_id=room_id,
                user_id=user.id,
            )
        except Exception as error:
            print(f"Ошибка удаления участника: {error}")
        finally:
            db.close()

        client_id = (
            current_client.get("client_id")
            if current_client is not None
            else None
        ) or str(user.id)

        leave_payload = {
            "type": "leave",
            "from": client_id,
            "clientId": client_id,
            "client_id": client_id,
            "userId": str(user.id),
            "user_id": str(user.id),
            "username": user.username,
        }
        await broadcast(invite_code, leave_payload)
