from fastapi import APIRouter
from . import rooms, root

main_router = APIRouter()

main_router.include_router(rooms.rooms_router)
main_router.include_router(root.root_router)