from sqlalchemy import Column, DateTime, Boolean, UUID, ForeignKey, Enum as SQLEnum
from sqlalchemy.sql import func
from ..database import Base
import uuid
import enum


class ParticipantRole(str, enum.Enum):
    speaker = "speaker"
    moderator = "moderator"
    viewer = "viewer"


class RoomParticipant(Base):
    __tablename__ = "room_participants"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    room_id = Column(UUID(as_uuid=True), ForeignKey("rooms.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)

    joined_at = Column(DateTime, server_default=func.now())
    left_at = Column(DateTime, nullable=True)

    is_muted = Column(Boolean, default=False)
    is_video_off = Column(Boolean, default=False)
    is_screen_sharing = Column(Boolean, default=False)
    role = Column(SQLEnum(ParticipantRole), default=ParticipantRole.speaker)