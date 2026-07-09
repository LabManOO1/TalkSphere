from fastapi import APIRouter
from . import rooms, root, auth

rest_router = APIRouter()

rest_router.include_router(rooms.rooms_router)
rest_router.include_router(root.root_router)
rest_router.include_router(auth.auth_router)