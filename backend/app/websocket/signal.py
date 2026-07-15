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
    target_user_id: Optional[str] = None,
):
    clients = list(rooms.get(invite_code, []))

    for client in clients:
        client_ws = client.get("ws")
        client_user_id = str(client.get("user_id"))

        if exclude_ws is not None and client_ws is exclude_ws:
            continue

        if (
            target_user_id is not None
            and client_user_id != str(target_user_id)
        ):
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


@signal_router.websocket("/ws/signal/{invite_code}")
async def signal_endpoint(
    websocket: WebSocket,
    invite_code: str,
    token: Optional[str] = None,
):
    user = None
    room_id = None
    connection_registered = False

    if not token:
        await websocket.close(
            code=1008,
            reason="Token required",
        )
        return

    try:
        user = await get_current_user_ws(token)
    except HTTPException:
        await websocket.close(
            code=1008,
            reason="Invalid token",
        )
        return

    db = SessionLocal()

    try:
        room = (
            db.query(Room)
            .filter(Room.invite_code == invite_code)
            .first()
        )

        if room is None:
            await websocket.close(
                code=1008,
                reason="Комната не найдена",
            )
            return

        if room.status != RoomStatus.active:
            await websocket.close(
                code=1008,
                reason="Конференция уже завершена",
            )
            return

        room_id = room.id
    except Exception as error:
        print(f"Ошибка поиска комнаты: {error}")

        await websocket.close(
            code=1011,
            reason="Ошибка при поиске комнаты",
        )
        return
    finally:
        db.close()

    await websocket.accept()

    room_clients = rooms.setdefault(invite_code, [])

    # При повторном подключении аккаунта новое соединение
    # заменяет старое. Одновременно двух одинаковых
    # пользователей в комнате не остаётся.
    old_connections = [
        client
        for client in room_clients
        if str(client.get("user_id")) == str(user.id)
    ]

    for old_client in old_connections:
        try:
            await old_client["ws"].close(
                code=4001,
                reason="Открыто новое подключение",
            )
        except Exception:
            pass

    room_clients[:] = [
        client
        for client in room_clients
        if str(client.get("user_id")) != str(user.id)
    ]

    existing_participants = [
        {
            "user_id": str(client.get("user_id")),
            "username": client.get("username", "Участник"),
        }
        for client in room_clients
    ]

    current_client = {
        "ws": websocket,
        "user_id": user.id,
        "username": user.username,
    }

    room_clients.append(current_client)
    connection_registered = True

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

    # Сообщаем новому пользователю, кто уже подключён.
    await websocket.send_text(
        json.dumps(
            {
                "type": "room_state",
                "participants": existing_participants,
            }
        )
    )

    # Сообщаем остальным о новом пользователе.
    await broadcast(
        invite_code,
        {
            "type": "participant_joined",
            "user_id": str(user.id),
            "username": user.username,
        },
        exclude_ws=websocket,
    )

    try:
        while True:
            raw_data = await websocket.receive_text()

            try:
                payload = json.loads(raw_data)
            except json.JSONDecodeError:
                continue

            payload["from_user_id"] = str(user.id)
            payload["from_username"] = user.username

            target_user_id = payload.get("target_user_id")

            await broadcast(
                invite_code,
                payload,
                exclude_ws=websocket,
                target_user_id=target_user_id,
            )

    except WebSocketDisconnect:
        # Нормальная ситуация при закрытии вкладки,
        # обновлении страницы или переходе по маршруту.
        pass

    except Exception as error:
        print(
            f"Ошибка WebSocket пользователя "
            f"{user.username}: {error}"
        )

    finally:
        if not connection_registered:
            return

        remaining_clients = remove_connection(
            invite_code,
            websocket,
        )

        # Если старое соединение было заменено новым,
        # пользователь всё ещё находится в комнате.
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

        await broadcast(
            invite_code,
            {
                "type": "participant_left",
                "user_id": str(user.id),
                "username": user.username,
            },
        )