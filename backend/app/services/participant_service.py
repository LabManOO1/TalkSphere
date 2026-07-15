from sqlalchemy.orm import Session
from ..models.participant import RoomParticipant, ParticipantRole
from ..models.user import User
from ..models.room import Room
from datetime import datetime
import uuid


class ParticipantService:

    @staticmethod
    def add_participant(db: Session, room_id: uuid.UUID, user_id: uuid.UUID,
                        role: ParticipantRole = ParticipantRole.speaker) -> RoomParticipant:
        existing = db.query(RoomParticipant).filter(
            RoomParticipant.room_id == room_id,
            RoomParticipant.user_id == user_id,
            RoomParticipant.left_at.is_(None)
        ).first()

        if existing:
            return existing

        participant = RoomParticipant(
            room_id=room_id,
            user_id=user_id,
            role=role
        )
        db.add(participant)
        db.commit()
        db.refresh(participant)
        return participant

    @staticmethod
    def remove_participant(db: Session, room_id: uuid.UUID, user_id: uuid.UUID):
        participant = db.query(RoomParticipant).filter(
            RoomParticipant.room_id == room_id,
            RoomParticipant.user_id == user_id,
            RoomParticipant.left_at.is_(None)
        ).first()

        if participant:
            participant.left_at = datetime.utcnow()
            db.commit()
            return True
        return False

    @staticmethod
    def get_participants(db: Session, room_id: uuid.UUID):
        return db.query(RoomParticipant).filter(
            RoomParticipant.room_id == room_id,
            RoomParticipant.left_at.is_(None)
        ).all()

    @staticmethod
    def get_participants_with_users(db: Session, room_id: uuid.UUID):
        participants = db.query(RoomParticipant, User).join(
            User, RoomParticipant.user_id == User.id
        ).filter(
            RoomParticipant.room_id == room_id,
            RoomParticipant.left_at.is_(None)
        ).all()

        return participants