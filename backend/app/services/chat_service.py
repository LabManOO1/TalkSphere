from sqlalchemy.orm import Session
from ..models.chat_message import ChatMessage
from ..models.user import User
import uuid


class ChatService:

    @staticmethod
    def save_message(db: Session, room_id: uuid.UUID, user_id: uuid.UUID, content: str) -> ChatMessage:
        message = ChatMessage(
            room_id=room_id,
            user_id=user_id,
            content=content
        )
        db.add(message)
        db.commit()
        db.refresh(message)
        return message

    @staticmethod
    def get_messages(db: Session, room_id: uuid.UUID, limit: int = 100, offset: int = 0):
        return db.query(ChatMessage).filter(
            ChatMessage.room_id == room_id,
            ChatMessage.is_deleted == False
        ).order_by(ChatMessage.sent_at.desc()).offset(offset).limit(limit).all()

    @staticmethod
    def get_messages_with_users(db: Session, room_id: uuid.UUID, limit: int = 100):
        messages = db.query(ChatMessage, User).join(
            User, ChatMessage.user_id == User.id
        ).filter(
            ChatMessage.room_id == room_id,
            ChatMessage.is_deleted == False
        ).order_by(ChatMessage.sent_at.desc()).limit(limit).all()

        return list(reversed(messages))

    @staticmethod
    def delete_message(db: Session, message_id: uuid.UUID, user_id: uuid.UUID) -> bool:
        message = db.query(ChatMessage).filter(
            ChatMessage.id == message_id,
            ChatMessage.user_id == user_id
        ).first()

        if message:
            message.is_deleted = True
            db.commit()
            return True
        return False