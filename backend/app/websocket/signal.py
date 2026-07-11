from fastapi import WebSocket, WebSocketDisconnect, APIRouter, HTTPException, status
from typing import Dict, List
from ..auth import get_current_user_ws

signal_router = APIRouter()
rooms: Dict[str, List[WebSocket]] = {}


@signal_router.websocket("/ws/signal/{room_id}")
async def signal_endpoint(
        websocket: WebSocket,
        room_id: str,
        token: str = None
):
    if token is None:
        await websocket.close(code=1008, reason="Token required")
        return

    try:
        user = await get_current_user_ws(token)
        print(f"Пользователь {user.username} подключается к комнате {room_id}")
    except HTTPException:
        await websocket.close(code=1008, reason="Invalid token")
        return

    await websocket.accept()
    print(f"Пользователь {user.username} подключился к комнате {room_id}")

    if room_id not in rooms:
        rooms[room_id] = []
    rooms[room_id].append(websocket)

    try:
        while True:
            data = await websocket.receive_text()
            print(f"Сообщение от {user.username} в комнате {room_id}")

            for client in rooms[room_id]:
                if client != websocket:
                    try:
                        await client.send_text(data)
                    except Exception as e:
                        print(f"Ошибка отправки: {e}")

    except WebSocketDisconnect:
        print(f"{user.username} отключился из комнаты {room_id}")
        if room_id in rooms:
            rooms[room_id].remove(websocket)
            if not rooms[room_id]:
                del rooms[room_id]
                print(f"Комната {room_id} удалена")
    except Exception as e:
        print(f"Ошибка в WebSocket: {e}")