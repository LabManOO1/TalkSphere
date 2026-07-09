from fastapi import WebSocket, WebSocketDisconnect, APIRouter
from typing import Dict, List

signal_router = APIRouter()

rooms: Dict[str, List[WebSocket]] = {}


@signal_router.websocket("/ws/signal/{room_id}")
async def signal_endpoint(websocket: WebSocket, room_id: str):
    await websocket.accept()
    print(f"Клиент подключился к комнате {room_id}")

    if room_id not in rooms:
        rooms[room_id] = []
    rooms[room_id].append(websocket)

    try:
        while True:
            data = await websocket.receive_text()
            print(f"Получено сообщение в комнате {room_id}: {data[:100]}...")

            for client in rooms[room_id]:
                if client != websocket:
                    try:
                        await client.send_text(data)
                    except Exception as e:
                        print(f"Ошибка отправки клиенту: {e}")

    except WebSocketDisconnect:
        print(f"Клиент отключился из комнаты {room_id}")
        if room_id in rooms:
            rooms[room_id].remove(websocket)
            if not rooms[room_id]:
                del rooms[room_id]
                print(f"Комната {room_id} удалена")

    except Exception as e:
        print(f"Ошибка в WebSocket: {e}")