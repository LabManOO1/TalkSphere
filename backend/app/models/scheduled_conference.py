from sqlalchemy import Column, DateTime, String, Text, UUID, ForeignKey, Enum as SQLEnum
from sqlalchemy.sql import func
from ..database import Base
import uuid
import enum


class ConferenceStatus(str, enum.Enum):
    scheduled = "scheduled"
    active = "active"
    ended = "ended"
    cancelled = "cancelled"


class ScheduledConference(Base):
    __tablename__ = "scheduled_conferences"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    room_id = Column(UUID(as_uuid=True), ForeignKey("rooms.id", ondelete="CASCADE"), nullable=True)
    created_by = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    scheduled_start = Column(DateTime, nullable=False)
    scheduled_end = Column(DateTime, nullable=True)
    timezone = Column(String(50), default="UTC")
    status = Column(SQLEnum(ConferenceStatus), default=ConferenceStatus.scheduled)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())