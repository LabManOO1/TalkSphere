from fastapi import APIRouter
from . import rooms, root, auth

main_router = APIRouter()

main_router.include_router(rooms.rooms_router)
main_router.include_router(root.root_router)
main_router.include_router(auth.auth_router)