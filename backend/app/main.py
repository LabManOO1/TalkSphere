from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .routers import rest_router
from .websocket import signal

app = FastAPI(
    title="TalsSphere API",
    description="Бэкенд для платформы видеоконференций",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(rest_router)
app.include_router(signal.signal_router)
