import uuid
from sqlalchemy import Column, String, DateTime, UUID, Enum as SQLEnum
from sqlalchemy.sql import func
from ..database import Base
import enum

class RoomStatus(str, enum.Enum):
    active = "active"
    ended = "ended"
    archived = "archived"

class Room(Base):
    __tablename__ = "rooms"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    title = Column(String(255), nullable=False)
    invite_code = Column(String(20), nullable=False, unique=True)
    created_by = Column(UUID(as_uuid = True), nullable=False)
    created_at = Column(DateTime, server_default=func.now())
    ended_at = Column(DateTime, nullable=True)
    status = Column(SQLEnum(RoomStatus), default=RoomStatus.active)