from sqlalchemy import Column, UUID, ForeignKey
from ..database import Base
import uuid


class ScheduledParticipant(Base):
    __tablename__ = "scheduled_participants"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    scheduled_conference_id = Column(UUID(as_uuid=True), ForeignKey("scheduled_conferences.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)